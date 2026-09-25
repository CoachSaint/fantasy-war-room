import type { SupabaseClient } from "@supabase/supabase-js";
import { scoreYahooOffenseProjection } from "@/lib/engine/yahoo-projection";

const pageSize = 100;
const maxPages = 5;
const batchSize = 50;

export class YahooOutcomeError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "YahooOutcomeError"; }
}

export type YahooOutcomeResult = {
  leagueId: string;
  status: "complete" | "skipped";
  pending: number;
  recorded: number;
  unavailable: number;
  reason?: string;
};

type Pending = { prediction_id: string; player_id: string; target_week: number;
  predicted_mean: number; created_at: string; scoring_snapshot: unknown; game_kickoff_at: string };
type ActualRow = { id: string; player_id: string; week: number; observed_at: string; data: unknown };

function actualStats(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const stats = data.actualStats;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return null;
  const values = Object.entries(stats as Record<string, unknown>);
  if (!values.length || values.some(([, number]) => typeof number !== "number" || !Number.isFinite(number))) return null;
  return stats as Record<string, number>;
}

/** Finalize only forecasts with frozen pregame proof and complete league-scored actual stats. */
export async function reconcileYahooOutcomesForLeague(
  client: SupabaseClient, leagueId: string, asOf = new Date(),
): Promise<YahooOutcomeResult> {
  const league = await client.from("leagues").select("provider, season, current_week, scoring")
    .eq("id", leagueId).single();
  if (league.error || !league.data) throw new YahooOutcomeError("outcome_league_unavailable");
  if (league.data.provider !== "yahoo") return { leagueId, status: "skipped", pending: 0, recorded: 0,
    unavailable: 0, reason: "not_yahoo_league" };
  const season = Number(league.data.season);
  const currentWeek = Number(league.data.current_week);
  if (!Number.isInteger(season) || !Number.isInteger(currentWeek) || currentWeek <= 1) {
    return { leagueId, status: "skipped", pending: 0, recorded: 0, unavailable: 0, reason: "completed_week_unavailable" };
  }
  const cursor = await client.from("yahoo_outcome_cursors").select("after_created_at, after_id")
    .eq("league_id", leagueId).maybeSingle();
  if (cursor.error) throw new YahooOutcomeError("outcome_cursor_unavailable");
  let afterCreatedAt: string | null = cursor.data?.after_created_at || null;
  let afterId: string | null = cursor.data?.after_id || null;
  let pendingCount = 0;
  let recorded = 0;
  let unavailable = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const pendingResult = await client.rpc("pending_yahoo_predictions", {
      p_league_id: leagueId, p_season: season, p_current_week: currentWeek,
      p_after_created_at: afterCreatedAt, p_after_id: afterId,
    });
    if (pendingResult.error) throw new YahooOutcomeError(pendingResult.error.code === "PGRST202"
      ? "outcome_migration_required" : "outcome_prediction_lookup_failed");
    const pending = (pendingResult.data || []) as Pending[];
    if (!pending.length) {
      const reset = await client.from("yahoo_outcome_cursors").upsert({ league_id: leagueId,
        after_created_at: null, after_id: null }, { onConflict: "league_id" });
      if (reset.error) throw new YahooOutcomeError("outcome_cursor_write_failed");
      break;
    }
    pendingCount += pending.length;
    const playerIds = [...new Set(pending.map((row) => row.player_id))];
    const weeks = [...new Set(pending.map((row) => row.target_week))];
    const latest = new Map<string, ActualRow>();
    for (let offset = 0; offset < playerIds.length; offset += batchSize) {
      const result = await client.from("player_snapshots")
        .select("id, player_id, week, observed_at, data")
        .eq("source", "nflverse_stats_player").eq("season", season)
        .in("week", weeks).in("player_id", playerIds.slice(offset, offset + batchSize))
        .lte("observed_at", asOf.toISOString())
        .order("observed_at", { ascending: false }).limit(1001);
      if (result.error || (result.data || []).length > 1000) throw new YahooOutcomeError("outcome_actual_source_unavailable");
      for (const row of result.data || []) {
        const key = `${row.player_id}:${row.week}`;
        if (!latest.has(key)) latest.set(key, row as ActualRow);
      }
    }
    const outcomes = [];
    for (const prediction of pending) {
      const source = latest.get(`${prediction.player_id}:${prediction.target_week}`);
      const stats = actualStats(source?.data);
      const predicted = Number(prediction.predicted_mean);
      const kickoff = new Date(prediction.game_kickoff_at).getTime();
      const frozen = prediction.scoring_snapshot as { statModifiers?: Record<string, unknown> } | null;
      if (!source || !stats || !Number.isFinite(predicted) || !Number.isFinite(kickoff)
        || !frozen?.statModifiers || typeof frozen.statModifiers !== "object"
        || new Date(prediction.created_at).getTime() >= kickoff
        || new Date(String(source.observed_at)).getTime() <= Math.max(new Date(prediction.created_at).getTime(), kickoff)) {
        unavailable += 1;
        continue;
      }
      const score = scoreYahooOffenseProjection({ stats }, frozen.statModifiers);
      if (!score.ok || score.assumedZeroStatIds.length) {
        unavailable += 1;
        continue;
      }
      outcomes.push({
        prediction_id: prediction.prediction_id,
        actual_fantasy_points: score.points,
        prediction_error: Math.round((score.points - predicted) * 100) / 100,
        source_snapshot_id: source.id,
        source_observed_at: source.observed_at,
        scoring_engine_version: "yahoo-actual-v1",
        finalized_at: asOf.toISOString(),
      });
    }
    if (outcomes.length) {
      const written = await client.from("prediction_outcomes")
        .upsert(outcomes, { onConflict: "prediction_id", ignoreDuplicates: true })
        .select("prediction_id");
      if (written.error) throw new YahooOutcomeError("outcome_write_failed");
      recorded += written.data?.length || 0;
    }
    const last = pending.at(-1)!;
    afterCreatedAt = last.created_at;
    afterId = last.prediction_id;
    const saved = await client.from("yahoo_outcome_cursors").upsert({ league_id: leagueId,
      after_created_at: afterCreatedAt, after_id: afterId }, { onConflict: "league_id" });
    if (saved.error) throw new YahooOutcomeError("outcome_cursor_write_failed");
    if (pending.length < pageSize) {
      const reset = await client.from("yahoo_outcome_cursors").upsert({ league_id: leagueId,
        after_created_at: null, after_id: null }, { onConflict: "league_id" });
      if (reset.error) throw new YahooOutcomeError("outcome_cursor_write_failed");
      break;
    }
  }
  return { leagueId, status: unavailable ? "skipped" : "complete", pending: pendingCount, recorded,
    unavailable, ...(unavailable ? { reason: "verified_actual_stats_unavailable" } : {}) };
}
