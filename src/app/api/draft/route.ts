import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeLeagueAccess } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/security/http";

export const dynamic = "force-dynamic";

const querySchema = z.object({ leagueId: z.string().uuid() });
const draftStatuses = new Set(["predraft", "drafting", "postdraft"]);

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return errorResponse("invalid_query", 400);
  const { leagueId } = parsed.data;
  const access = await authorizeLeagueAccess(request, leagueId);
  if (!access.ok) return errorResponse(access.error, access.status);
  const client = access.auth.adminClient;
  const [league, membership] = await Promise.all([
    client.from("leagues").select("provider, provider_league_id, scoring")
      .eq("id", leagueId).maybeSingle(),
    client.from("league_memberships").select("roster_id")
      .eq("league_id", leagueId).eq("user_id", access.auth.user.id).maybeSingle(),
  ]);
  if (league.error || membership.error) return errorResponse("draft_unavailable", 503);
  if (!league.data || !membership.data?.roster_id) return errorResponse("owned_roster_unavailable", 409);
  if (league.data.provider !== "yahoo") {
    return NextResponse.json({ ok: true, status: "not_yahoo_league", draftStatus: "unknown", picks: [] });
  }
  const roster = await client.from("rosters").select("provider_roster_id")
    .eq("id", membership.data.roster_id).eq("league_id", leagueId).maybeSingle();
  if (roster.error) return errorResponse("draft_unavailable", 503);
  const teamKey = String(roster.data?.provider_roster_id || "");
  if (!/^\d+\.l\.\d+\.t\.\d+$/.test(teamKey)) return errorResponse("owned_roster_unavailable", 409);
  const scoring = league.data.scoring && typeof league.data.scoring === "object" && !Array.isArray(league.data.scoring)
    ? league.data.scoring as Record<string, unknown> : {};
  const draftStatus = typeof scoring.draftStatus === "string" && draftStatuses.has(scoring.draftStatus)
    ? scoring.draftStatus : "unknown";
  const historyStatus = scoring.draftHistoryStatus === "ready" || scoring.draftHistoryStatus === "not_started"
    ? scoring.draftHistoryStatus : "unavailable";
  const history = await client.from("league_draft_picks")
    .select("overall_pick, round, provider_player_key, player_name, player_position, observed_at")
    .eq("league_id", leagueId).eq("provider_team_key", teamKey)
    .order("overall_pick", { ascending: true }).limit(40);
  if (history.error) return errorResponse(history.error.code === "42P01"
    ? "draft_migration_required" : "draft_unavailable", 503);
  return NextResponse.json({
    ok: true, status: historyStatus, draftStatus,
    sourceUrl: `https://fantasysports.yahooapis.com/fantasy/v2/team/${teamKey}/draftresults`,
    picks: (history.data || []).map((pick) => ({
      overallPick: Number(pick.overall_pick), round: Number(pick.round),
      playerKey: String(pick.provider_player_key),
      playerName: pick.player_name ? String(pick.player_name) : null,
      playerPosition: pick.player_position ? String(pick.player_position) : null,
      observedAt: String(pick.observed_at),
    })),
  });
}
