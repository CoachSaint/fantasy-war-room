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
    let query = access.auth.adminClient
      .from("recommendations")
      .select("id, kind, subject_player_id, alternative_player_id, score, confidence, headline, reason_codes, evidence_ids, computed_at, fresh_until, engine_version, payload")
      .eq("league_id", leagueId)
      .or(`user_id.is.null,user_id.eq.${access.auth.user.id}`)
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
      generatedAt: new Date().toISOString(),
    });
  } catch {
    return errorResponse("recommendations_unavailable", 503);
  }
}
