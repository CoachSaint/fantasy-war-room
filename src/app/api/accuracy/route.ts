import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeLeagueAccess } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/security/http";

export const dynamic = "force-dynamic";

const querySchema = z.object({ leagueId: z.string().uuid() });

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return errorResponse("invalid_query", 400);
  const access = await authorizeLeagueAccess(request, parsed.data.leagueId);
  if (!access.ok) return errorResponse(access.error, access.status);
  const [decisions, predictions] = await Promise.all([
    access.auth.adminClient.from("decision_events").select("id", { count: "exact", head: true })
      .eq("league_id", parsed.data.leagueId).eq("user_id", access.auth.user.id),
    access.auth.adminClient.from("prediction_events").select("id", { count: "exact", head: true })
      .eq("league_id", parsed.data.leagueId).eq("user_id", access.auth.user.id),
  ]);
  if (decisions.error || predictions.error) return errorResponse("accuracy_unavailable", 503);
  return NextResponse.json({ decisionsRecorded: decisions.count || 0, predictionsRecorded: predictions.count || 0,
    accuracyStatus: "awaiting_verified_outcomes", generatedAt: new Date().toISOString() });
}
