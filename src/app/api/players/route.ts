import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeLeagueAccess } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/security/http";

export const dynamic = "force-dynamic";

const querySchema = z.object({ leagueId: z.string().uuid(), playerId: z.string().uuid().optional() });

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return errorResponse("invalid_query", 400);
  const { leagueId, playerId } = parsed.data;
  const access = await authorizeLeagueAccess(request, leagueId);
  if (!access.ok) return errorResponse(access.error, access.status);

  const client = access.auth.adminClient;
  if (playerId) {
    const assigned = await client.from("roster_assignments")
      .select("player_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerId)
      .limit(1);
    if (assigned.error) return errorResponse("players_unavailable", 503);
    if (!assigned.data?.length) return errorResponse("player_not_in_league", 404);
    const [player, forecasts, observed, evidence] = await Promise.all([
      client.from("players").select("id, full_name, team, position, status, updated_at").eq("id", playerId).maybeSingle(),
      client.from("player_snapshots").select("season, week, data, observed_at, source")
        .eq("player_id", playerId).eq("source", "sleeper_weekly_projections")
        .order("observed_at", { ascending: false }).limit(9),
      client.from("player_snapshots").select("season, week, data, observed_at, source")
        .eq("player_id", playerId).eq("source", "nflverse_stats_player")
        .order("season", { ascending: false }).order("week", { ascending: false })
        .order("observed_at", { ascending: false }).limit(15),
      client.from("evidence").select("id, type, source, source_url, summary, confidence, published_at, observed_at").eq("player_id", playerId).order("observed_at", { ascending: false }).limit(20),
    ]);
    if (player.error || forecasts.error || observed.error || evidence.error) return errorResponse("players_unavailable", 503);
    if (!player.data) return errorResponse("player_not_in_league", 404);
    const seenWeeks = new Set<string>();
    const recentObserved = (observed.data || []).filter((snapshot) => {
      const key = `${snapshot.season}:${snapshot.week}`;
      if (seenWeeks.has(key)) return false;
      seenWeeks.add(key);
      return true;
    }).slice(0, 3);
    return NextResponse.json({ ok: true, source: "connected", player: player.data,
      snapshots: [...(forecasts.data || []), ...recentObserved], evidence: evidence.data || [] });
  }

  const assignments = await client.from("roster_assignments")
    .select("player_id")
    .eq("league_id", leagueId)
    .limit(501);
  if (assignments.error) return errorResponse("players_unavailable", 503);
  if ((assignments.data || []).length > 500) return errorResponse("player_pool_too_large", 503);
  const ids = [...new Set((assignments.data || []).map((row) => String(row.player_id)))];
  const players = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const result = await client.from("players")
      .select("id, full_name, team, position, status, updated_at")
      .in("id", ids.slice(offset, offset + 100));
    if (result.error) return errorResponse("players_unavailable", 503);
    players.push(...(result.data || []));
  }
  players.sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));
  return NextResponse.json({ ok: true, source: "connected", leagueId, players, count: players.length });
}
