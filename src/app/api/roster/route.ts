import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeLeagueAccess } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/security/http";

export const dynamic = "force-dynamic";

const querySchema = z.object({ leagueId: z.string().uuid() });

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return errorResponse("invalid_query", 400);

  const { leagueId } = parsed.data;
  const access = await authorizeLeagueAccess(request, leagueId);
  if (!access.ok) return errorResponse(access.error, access.status);

  const client = access.auth.adminClient;
  const userId = access.auth.user.id;
  const membership = await client.from("league_memberships")
    .select("roster_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membership.error) return errorResponse("roster_unavailable", 503);
  if (!membership.data?.roster_id) return errorResponse("roster_setup_required", 409);

  const roster = await client.from("rosters")
    .select("id, league_id, name, player_ids, starter_ids, updated_at")
    .eq("id", membership.data.roster_id)
    .eq("league_id", leagueId)
    .maybeSingle();
  if (roster.error) return errorResponse("roster_unavailable", 503);
  if (!roster.data) return errorResponse("roster_setup_required", 409);

  const assignments = await client.from("roster_assignments")
    .select("player_id, designation")
    .eq("roster_id", roster.data.id);
  if (assignments.error) return errorResponse("roster_unavailable", 503);

  const playerIds = [...new Set([
    ...(Array.isArray(roster.data.player_ids) ? roster.data.player_ids.map(String) : []),
    ...(assignments.data || []).map((row) => String(row.player_id)),
  ])];
  const playersResult = playerIds.length
    ? await client.from("players").select("id, full_name, team, position, status").in("id", playerIds)
    : { data: [], error: null };
  if (playersResult.error) return errorResponse("roster_unavailable", 503);

  const designationById = new Map((assignments.data || []).map((row) => [String(row.player_id), String(row.designation)]));
  const starterIds = new Set(Array.isArray(roster.data.starter_ids) ? roster.data.starter_ids.map(String) : []);
  const designationOrder: Record<string, number> = { starter: 0, bench: 1, ir: 2, taxi: 3 };
  const players = (playersResult.data || []).map((player) => ({
    id: String(player.id),
    fullName: String(player.full_name),
    team: player.team ? String(player.team) : null,
    position: String(player.position),
    status: player.status ? String(player.status) : null,
    designation: designationById.get(String(player.id)) ?? (starterIds.has(String(player.id)) ? "starter" : "bench"),
  })).sort((a, b) => (designationOrder[a.designation] ?? 4) - (designationOrder[b.designation] ?? 4) || a.position.localeCompare(b.position) || a.fullName.localeCompare(b.fullName));

  return NextResponse.json({
    ok: true,
    source: "connected",
    leagueId,
    roster: { id: String(roster.data.id), name: roster.data.name ? String(roster.data.name) : "Your roster", updatedAt: String(roster.data.updated_at) },
    players,
    count: players.length,
  });
}
