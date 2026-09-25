import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedRequest, hasAdminCredentials } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/security/http";

export const dynamic = "force-dynamic";

const querySchema = z.object({ leagueId: z.string().uuid().optional() });

type ContextLeague = {
  id: string;
  name: string;
  provider: string;
  season: number;
  currentWeek: number;
  scoring: unknown;
  rosterPositions: unknown;
  workspaceId: string;
};

export async function GET(request: Request) {
  if (!hasAdminCredentials()) return errorResponse("supabase_unavailable", 503);
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return errorResponse("invalid_query", 400);

  let auth;
  try {
    auth = await getAuthenticatedRequest(request);
  } catch {
    return errorResponse("authentication_unavailable", 503);
  }
  if (!auth) return errorResponse("authentication_required", 401);

  try {
    let membershipsQuery = auth.adminClient
      .from("league_memberships")
      .select("league_id, roster_id, provider_user_id, is_primary")
      .eq("user_id", auth.user.id);
    if (parsed.data.leagueId) membershipsQuery = membershipsQuery.eq("league_id", parsed.data.leagueId);
    const membershipsResult = await membershipsQuery;
    if (membershipsResult.error) return errorResponse("context_unavailable", 503);

    const memberships = membershipsResult.data || [];
    if (!memberships.length) {
      return NextResponse.json({ ok: true, status: "setup_required", setupRequired: true, data: { memberships: [] } });
    }

    const leagueIds = [...new Set(memberships.map((membership) => String(membership.league_id)))];
    const rosterIds = [...new Set(memberships.map((membership) => membership.roster_id).filter((id): id is string => Boolean(id)).map(String))];
    const [leaguesResult, rostersResult, slotsResult, preferencesResult] = await Promise.all([
      auth.adminClient.from("leagues").select("id, name, provider, season, current_week, scoring, roster_positions, workspace_id").in("id", leagueIds),
      rosterIds.length ? auth.adminClient.from("rosters").select("id, league_id, name, provider_roster_id, player_ids, starter_ids").in("id", rosterIds) : Promise.resolve({ data: [], error: null }),
      auth.adminClient.from("roster_slot_definitions").select("id, league_id, slot_type, slot_order, eligible_positions, required").in("league_id", leagueIds).order("slot_order", { ascending: true }),
      auth.adminClient.from("manager_preferences").select("league_id, risk_tolerance, upside_bias, floor_bias, rookie_aggression, waiver_aggression, trade_aggression, qb_strategy, te_strategy, stacking_preference, favorite_teams, avoid_players").eq("user_id", auth.user.id).in("league_id", leagueIds),
    ]);
    if (leaguesResult.error || rostersResult.error || slotsResult.error || preferencesResult.error) return errorResponse("context_unavailable", 503);

    const leaguesById = new Map((leaguesResult.data || []).map((league) => [String(league.id), league]));
    const rostersById = new Map((rostersResult.data || []).map((roster) => [String(roster.id), roster]));
    const slotsByLeague = new Map<string, Array<Record<string, unknown>>>();
    for (const slot of slotsResult.data || []) {
      const list = slotsByLeague.get(String(slot.league_id)) || [];
      list.push({ id: String(slot.id), slotType: String(slot.slot_type), slotOrder: Number(slot.slot_order), eligiblePositions: slot.eligible_positions, required: Boolean(slot.required) });
      slotsByLeague.set(String(slot.league_id), list);
    }
    const preferencesByLeague = new Map((preferencesResult.data || []).map((preference) => [String(preference.league_id), {
      riskTolerance: Number(preference.risk_tolerance), upsideBias: Number(preference.upside_bias), floorBias: Number(preference.floor_bias), rookieAggression: Number(preference.rookie_aggression), waiverAggression: Number(preference.waiver_aggression), tradeAggression: Number(preference.trade_aggression), qbStrategy: preference.qb_strategy, teStrategy: preference.te_strategy, stackingPreference: preference.stacking_preference, favoriteTeams: preference.favorite_teams, avoidPlayers: preference.avoid_players,
    }]));

    const data = memberships.map((membership) => {
      const leagueId = String(membership.league_id);
      const league = leaguesById.get(leagueId);
      const referencedRoster = membership.roster_id ? rostersById.get(String(membership.roster_id)) : undefined;
      // Defense in depth for legacy or corrupted rows: a membership may only
      // expose a roster from the same league.
      const roster = referencedRoster && String(referencedRoster.league_id) === leagueId ? referencedRoster : undefined;
      const preferences = preferencesByLeague.get(leagueId);
      const leagueDto: ContextLeague | null = league ? {
        id: String(league.id), name: String(league.name), provider: String(league.provider), season: Number(league.season), currentWeek: Number(league.current_week), scoring: league.scoring, rosterPositions: league.roster_positions, workspaceId: String(league.workspace_id),
      } : null;
      return {
        membership: { leagueId, rosterId: membership.roster_id ? String(membership.roster_id) : null, providerUserId: membership.provider_user_id ? String(membership.provider_user_id) : null, isPrimary: Boolean(membership.is_primary) },
        league: leagueDto,
        roster: roster ? { id: String(roster.id), name: roster.name ? String(roster.name) : null, providerRosterId: roster.provider_roster_id ? String(roster.provider_roster_id) : null, playerIds: Array.isArray(roster.player_ids) ? roster.player_ids.map(String) : [], starterIds: Array.isArray(roster.starter_ids) ? roster.starter_ids.map(String) : [] } : null,
        rosterSlots: slotsByLeague.get(leagueId) || [],
        preferences: preferences || null,
      };
    });
    const setupRequired = data.some((entry) => !entry.league || !entry.roster || !entry.preferences || entry.rosterSlots.length === 0);
    return NextResponse.json({ ok: true, status: setupRequired ? "setup_required" : "ready", setupRequired, data: { memberships: data } });
  } catch {
    return errorResponse("context_unavailable", 503);
  }
}
