import type { SupabaseClient } from "@supabase/supabase-js";
import { diffBriefActions, type BriefAction } from "@/lib/engine/daily-brief";

const engineVersion = "war-v0.1-daily-brief";

export class DailyBriefError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "DailyBriefError"; }
}

export type DailyBriefResult = { leagueId: string; briefsWritten: number; changesFound: number; baselinesFound: number };

function isBriefAction(value: unknown): value is BriefAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.recommendationId === "string" && typeof row.kind === "string"
    && typeof row.subjectPlayerId === "string"
    && (row.alternativePlayerId === null || typeof row.alternativePlayerId === "string")
    && typeof row.score === "number" && Number.isFinite(row.score)
    && typeof row.headline === "string" && Array.isArray(row.evidenceIds)
    && row.evidenceIds.every((id) => typeof id === "string") && typeof row.computedAt === "string";
}

export async function materializeDailyBriefForLeague(
  client: SupabaseClient,
  leagueId: string,
  asOf = new Date(),
): Promise<DailyBriefResult> {
  const league = await client.from("leagues").select("id, season, current_week").eq("id", leagueId).single();
  if (league.error || !league.data) throw new DailyBriefError("brief_league_unavailable");
  const members = await client.from("league_memberships").select("user_id")
    .eq("league_id", leagueId).limit(65);
  if (members.error) throw new DailyBriefError("brief_memberships_unavailable");
  if ((members.data || []).length > 64) throw new DailyBriefError("brief_memberships_too_large");
  const asOfISO = asOf.toISOString();
  let briefsWritten = 0;
  let changesFound = 0;
  let baselinesFound = 0;
  for (const member of members.data || []) {
    const userId = String(member.user_id);
    const [recommendations, previous] = await Promise.all([
      client.from("recommendations")
        .select("id, kind, subject_player_id, alternative_player_id, score, headline, evidence_ids, computed_at, fresh_until")
        .eq("league_id", leagueId).or(`user_id.is.null,user_id.eq.${userId}`)
        .gt("fresh_until", asOfISO).order("score", { ascending: false }).limit(101),
      client.from("daily_briefs").select("computed_at, payload")
        .eq("league_id", leagueId).eq("user_id", userId)
        .lt("computed_at", asOfISO).order("computed_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (recommendations.error || previous.error) throw new DailyBriefError("brief_source_unavailable");
    if ((recommendations.data || []).length > 100) throw new DailyBriefError("brief_recommendation_limit_exceeded");
    const actions: BriefAction[] = (recommendations.data || []).map((row) => ({
      recommendationId: String(row.id), kind: String(row.kind), subjectPlayerId: String(row.subject_player_id),
      alternativePlayerId: row.alternative_player_id ? String(row.alternative_player_id) : null,
      score: Number(row.score), headline: String(row.headline),
      evidenceIds: Array.isArray(row.evidence_ids) ? row.evidence_ids.map(String) : [],
      computedAt: String(row.computed_at),
    }));
    const oldPayload = previous.data?.payload;
    const oldRecord = oldPayload && typeof oldPayload === "object" && !Array.isArray(oldPayload)
      ? oldPayload as Record<string, unknown> : null;
    const oldActions = oldRecord?.actions;
    if (previous.data && (
      oldRecord?.version !== 1
      || oldRecord.scope !== "materialized_recommendation_changes_only"
      || !Array.isArray(oldActions) || !oldActions.every(isBriefAction)
    )) {
      throw new DailyBriefError("brief_baseline_invalid");
    }
    const hasBaseline = Boolean(previous.data);
    const changes = hasBaseline ? diffBriefActions(oldActions as BriefAction[], actions) : [];
    const briefFreshUntil = Math.min(asOf.getTime() + 24 * 60 * 60_000,
      ...(recommendations.data || []).map((row) => new Date(String(row.fresh_until)).getTime()));
    if (!Number.isFinite(briefFreshUntil) || briefFreshUntil <= asOf.getTime()) {
      throw new DailyBriefError("brief_freshness_invalid");
    }
    const payload = {
      version: 1,
      scope: "materialized_recommendation_changes_only",
      baseline: hasBaseline ? { status: "available", computedAt: String(previous.data!.computed_at) } : { status: "missing" },
      actions,
      changes,
    };
    const result = await client.from("daily_briefs").upsert({
      league_id: leagueId, user_id: userId, season: Number(league.data.season), week: Number(league.data.current_week),
      payload, computed_at: asOfISO, fresh_until: new Date(briefFreshUntil).toISOString(),
      engine_version: engineVersion,
    }, { onConflict: "league_id,user_id,season,week,computed_at" }).select("id");
    if (result.error || result.data?.length !== 1) throw new DailyBriefError("brief_write_failed");
    briefsWritten += 1;
    changesFound += changes.length;
    if (hasBaseline) baselinesFound += 1;
  }
  return { leagueId, briefsWritten, changesFound, baselinesFound };
}
