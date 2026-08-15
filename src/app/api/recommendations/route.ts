import { NextResponse } from "next/server";
import { demoRecommendations } from "@/lib/demo";
import { hasAdminCredentials, createAdminClient } from "@/lib/supabase/admin";
import type { Recommendation, RecommendationKind } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const leagueId = url.searchParams.get("leagueId");
    const kindParam = url.searchParams.get("kind") as RecommendationKind | null;
    const limitParam = parseInt(url.searchParams.get("limit") || "20", 10);
    const forceDemo = url.searchParams.get("demo") === "true";

    if (hasAdminCredentials() && !forceDemo && leagueId) {
      try {
        const adminClient = createAdminClient();
        let query = adminClient
          .from("recommendations")
          .select("*")
          .eq("league_id", leagueId)
          .order("score", { ascending: false })
          .limit(limitParam);

        if (kindParam) {
          query = query.eq("kind", kindParam);
        }

        const { data, error } = await query;

        if (!error && data && data.length > 0) {
          const formatted: Recommendation[] = data.map((row) => ({
            id: row.id,
            kind: row.kind,
            subjectPlayerId: row.subject_player_id,
            alternativePlayerId: row.alternative_player_id,
            score: row.score,
            confidence: row.confidence,
            headline: row.headline,
            reasonCodes: row.reason_codes || [],
            evidenceIds: row.evidence_ids || [],
            computedAt: row.computed_at,
            freshUntil: row.fresh_until,
            engineVersion: row.engine_version,
          }));

          return NextResponse.json({
            data: formatted,
            count: formatted.length,
            demo: false,
            generatedAt: new Date().toISOString(),
          });
        }
      } catch (dbErr) {
        console.warn("Recommendations DB query failed, falling back to demo mode:", dbErr);
      }
    }

    let filtered = [...demoRecommendations];
    if (kindParam) {
      filtered = filtered.filter((r) => r.kind === kindParam);
    }
    filtered = filtered.slice(0, limitParam);

    return NextResponse.json({
      data: filtered,
      count: filtered.length,
      demo: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Failed to fetch recommendations", details: String(err) },
      { status: 500 }
    );
  }
}
