import { NextResponse } from "next/server";
import { z } from "zod";
import { demoRecommendations } from "@/lib/demo";
import { authorizeLeagueAccess, hasAdminCredentials } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/security/http";
import type { Recommendation } from "@/lib/types";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  leagueId: z.string().uuid().optional(),
  kind: z.enum(["draft", "start", "sit", "add", "drop", "hold", "watch"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  demo: z.enum(["true", "false"]).default("false"),
});

function formatRecommendation(row: Record<string, unknown>): Recommendation {
  return {
    id: String(row.id),
    kind: row.kind as Recommendation["kind"],
    subjectPlayerId: String(row.subject_player_id),
    alternativePlayerId: row.alternative_player_id ? String(row.alternative_player_id) : undefined,
    score: Number(row.score),
    confidence: Number(row.confidence),
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
      .select("id, kind, subject_player_id, alternative_player_id, score, confidence, headline, reason_codes, evidence_ids, computed_at, fresh_until, engine_version")
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
    return NextResponse.json({
      data: formatted,
      count: formatted.length,
      demo: false,
      generatedAt: new Date().toISOString(),
    });
  } catch {
    return errorResponse("recommendations_unavailable", 503);
  }
}
