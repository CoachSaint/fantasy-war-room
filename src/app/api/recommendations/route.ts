import { NextResponse } from "next/server";
import { z } from "zod";
import { demoRecommendations } from "@/lib/demo";
import { authorizeLeagueAccess, hasAdminCredentials } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/security/http";
import type { Evidence, Recommendation } from "@/lib/types";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  leagueId: z.string().uuid().optional(),
  kind: z.enum(["draft", "start", "sit", "add", "drop", "hold", "watch"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  demo: z.enum(["true", "false"]).default("false"),
});

function formatRecommendation(row: Record<string, unknown>): Recommendation {
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload as Record<string, unknown> : {};
  const projectedPoints = payload.projectedPoints && typeof payload.projectedPoints === "object" && !Array.isArray(payload.projectedPoints)
    ? payload.projectedPoints as Record<string, unknown> : null;
  const matchup = payload.teamMatchup && typeof payload.teamMatchup === "object" && !Array.isArray(payload.teamMatchup)
    ? payload.teamMatchup as Record<string, unknown> : null;
  const validMatchup = matchup && typeof matchup.week === "number" && Number.isInteger(matchup.week)
    && matchup.week >= 1 && matchup.week <= 23
    && typeof matchup.ownProjectedPoints === "number" && Number.isFinite(matchup.ownProjectedPoints)
    && matchup.ownProjectedPoints >= 0
    && typeof matchup.opponentProjectedPoints === "number" && Number.isFinite(matchup.opponentProjectedPoints)
    && matchup.opponentProjectedPoints >= 0
    && typeof matchup.observedAt === "string" && Number.isFinite(Date.parse(matchup.observedAt))
    && typeof matchup.status === "string" && matchup.status.length <= 40;
  const availabilitySourceUrl = typeof payload.availabilitySourceUrl === "string" ? payload.availabilitySourceUrl : "";
  const validAvailabilityUrl = availabilitySourceUrl.startsWith("https://fantasysports.yahooapis.com/fantasy/v2/league/");
  const faab = payload.faabRange && typeof payload.faabRange === "object" && !Array.isArray(payload.faabRange)
    ? payload.faabRange as Record<string, unknown> : null;
  const validFaab = faab?.version === "faab-range-v1" && faab.model === "heuristic_no_bid_history"
    && typeof faab.minimumPercent === "number" && typeof faab.recommendedPercent === "number"
    && typeof faab.maximumPercent === "number" && typeof faab.remainingBalance === "number"
    && Number.isFinite(faab.minimumPercent) && Number.isFinite(faab.recommendedPercent)
    && Number.isFinite(faab.maximumPercent) && Number.isFinite(faab.remainingBalance)
    && faab.minimumPercent >= 0 && faab.minimumPercent <= faab.recommendedPercent
    && faab.recommendedPercent <= faab.maximumPercent && faab.maximumPercent <= 100
    && faab.remainingBalance > 0 && typeof faab.observedAt === "string"
    && Number.isFinite(Date.parse(faab.observedAt));
  const requestedWeeks = Array.isArray(payload.forecastOutlookWeeksRequested)
    ? payload.forecastOutlookWeeksRequested.filter((week): week is number =>
      typeof week === "number" && Number.isInteger(week) && week >= 0 && week <= 23).slice(0, 3)
    : [];
  const forecastWeeks = Array.isArray(payload.forecastOutlook)
    ? payload.forecastOutlook.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const row = value as Record<string, unknown>;
      const week = row.week;
      if (typeof week !== "number" || !requestedWeeks.includes(week)
        || typeof row.addPoints !== "number" || !Number.isFinite(row.addPoints)
        || typeof row.dropPoints !== "number" || !Number.isFinite(row.dropPoints)
        || typeof row.edge !== "number" || !Number.isFinite(row.edge)
        || typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt))
        || typeof row.sourceUrl !== "string"
        || !new RegExp(`^https://api\\.sleeper\\.app/v1/projections/nfl/regular/\\d{4}/${week}$`).test(row.sourceUrl)) return [];
      const assumedZeroYahooStatIds = Array.isArray(row.assumedZeroYahooStatIds)
        ? row.assumedZeroYahooStatIds.filter((id): id is string =>
          typeof id === "string" && /^\d{1,4}$/.test(id)).slice(0, 20)
        : [];
      return [{ week, addPoints: row.addPoints, dropPoints: row.dropPoints, edge: row.edge,
        observedAt: row.observedAt, sourceUrl: row.sourceUrl, assumedZeroYahooStatIds }];
    }).slice(0, 3)
    : [];
  return {
    id: String(row.id),
    kind: row.kind as Recommendation["kind"],
    subjectPlayerId: String(row.subject_player_id),
    alternativePlayerId: row.alternative_player_id ? String(row.alternative_player_id) : undefined,
    score: Number(row.score),
    confidence: Number(row.confidence),
    ...(payload.confidenceMeaning === "heuristic_source_coverage_not_outcome_probability"
      ? { confidenceMeaning: payload.confidenceMeaning } : {}),
    ...(projectedPoints && Number.isFinite(projectedPoints.recommended) && Number.isFinite(projectedPoints.current)
      ? { projectedPoints: { recommended: Number(projectedPoints.recommended), current: Number(projectedPoints.current) } } : {}),
    ...(validMatchup && matchup ? { teamMatchup: {
      week: matchup.week as number, ownProjectedPoints: matchup.ownProjectedPoints as number,
      opponentProjectedPoints: matchup.opponentProjectedPoints as number,
      observedAt: matchup.observedAt as string, status: matchup.status as string,
    } } : {}),
    ...(validAvailabilityUrl && typeof payload.availabilityObservedAt === "string" && Number.isFinite(Date.parse(payload.availabilityObservedAt))
      ? { availability: { sourceUrl: availabilitySourceUrl, observedAt: payload.availabilityObservedAt,
          truncated: payload.availabilityTruncated === true } } : {}),
    ...(validFaab && faab ? { faabRange: {
      version: "faab-range-v1", model: "heuristic_no_bid_history" as const,
      minimumPercent: faab.minimumPercent as number,
      recommendedPercent: faab.recommendedPercent as number,
      maximumPercent: faab.maximumPercent as number,
      remainingBalance: faab.remainingBalance as number,
      observedAt: faab.observedAt as string,
    } } : {}),
    ...(requestedWeeks.length && forecastWeeks.length
      ? { forecastOutlook: { requestedWeeks, weeks: forecastWeeks } } : {}),
    headline: String(row.headline),
    reasonCodes: Array.isArray(row.reason_codes) ? row.reason_codes.map(String) : [],
    evidenceIds: Array.isArray(row.evidence_ids) ? row.evidence_ids.map(String) : [],
    computedAt: String(row.computed_at),
    freshUntil: String(row.fresh_until),
    engineVersion: String(row.engine_version),
  };
}

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) {
    return errorResponse("invalid_query", 400, { issues: parsed.error.issues.map((issue) => issue.path.join(".")) });
  }

  const { leagueId, kind, limit, demo } = parsed.data;
  if (demo === "true") {
    let data = [...demoRecommendations];
    if (kind) data = data.filter((recommendation) => recommendation.kind === kind);
    data = data.slice(0, limit);
    return NextResponse.json({ data, count: data.length, demo: true, generatedAt: new Date().toISOString() });
  }

  if (!leagueId) return errorResponse("league_id_required", 400);
  if (!hasAdminCredentials()) return errorResponse("supabase_unavailable", 503);

  const access = await authorizeLeagueAccess(request, leagueId);
  if (!access.ok) return errorResponse(access.error, access.status);

  try {
    const asOf = new Date().toISOString();
    let query = access.auth.adminClient
      .from("recommendations")
      .select("id, kind, subject_player_id, alternative_player_id, score, confidence, headline, reason_codes, evidence_ids, computed_at, fresh_until, engine_version, payload")
      .eq("league_id", leagueId)
      .or(`user_id.is.null,user_id.eq.${access.auth.user.id}`)
      .lte("computed_at", asOf)
      .gt("fresh_until", asOf)
      .order("score", { ascending: false })
      .limit(limit);

    if (kind) query = query.eq("kind", kind);
    const { data, error } = await query;
    if (error) {
      return errorResponse("recommendations_unavailable", 503);
    }

    const formatted = (data || []).map((row) => formatRecommendation(row as Record<string, unknown>));
    const evidenceIds = [...new Set(formatted.flatMap((recommendation) => recommendation.evidenceIds))].slice(0, 200);
    let evidence: Evidence[] = [];
    if (evidenceIds.length) {
      const evidenceResult = await access.auth.adminClient
        .from("evidence")
        .select("id, player_id, type, source, source_url, observed_at, published_at, confidence, summary, fingerprint")
        .in("id", evidenceIds);
      if (evidenceResult.error) return errorResponse("recommendations_unavailable", 503);
      evidence = (evidenceResult.data || []).map((row) => ({
        id: String(row.id),
        playerId: row.player_id ? String(row.player_id) : "",
        type: row.type as Evidence["type"],
        source: String(row.source),
        sourceUrl: row.source_url ? String(row.source_url) : undefined,
        observedAt: String(row.observed_at),
        publishedAt: row.published_at ? String(row.published_at) : undefined,
        confidence: Number(row.confidence) / 100,
        summary: String(row.summary),
        fingerprint: String(row.fingerprint),
      }));
    }
    return NextResponse.json({
      data: formatted,
      evidence,
      count: formatted.length,
      demo: false,
      generatedAt: asOf,
    });
  } catch {
    return errorResponse("recommendations_unavailable", 503);
  }
}
