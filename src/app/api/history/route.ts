import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeLeagueAccess } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/security/http";

export const dynamic = "force-dynamic";

const querySchema = z.object({ leagueId: z.string().uuid(), limit: z.coerce.number().int().min(1).max(50).default(20) });

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return errorResponse("invalid_query", 400);
  const access = await authorizeLeagueAccess(request, parsed.data.leagueId);
  if (!access.ok) return errorResponse(access.error, access.status);
  const { data, error } = await access.auth.adminClient.from("decision_events")
    .select("id, recommendation_id, recommendation_snapshot, alternatives, confidence, response, user_note, recommended_at, responded_at")
    .eq("league_id", parsed.data.leagueId).eq("user_id", access.auth.user.id)
    .order("recommended_at", { ascending: false }).limit(parsed.data.limit);
  if (error) return errorResponse("history_unavailable", 503);
  return NextResponse.json({ data: data || [], count: data?.length || 0, generatedAt: new Date().toISOString() });
}
