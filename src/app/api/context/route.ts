import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedRequest, hasAdminCredentials } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/security/http";
import { selectPrimaryMembership } from "@/lib/select-primary-membership";

export const dynamic = "force-dynamic";

const querySchema = z.object({ leagueId: z.string().uuid().optional() });
const selectionSchema = z.object({ leagueId: z.string().uuid() }).strict();

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
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: true })
      .limit(65);
    if (parsed.data.leagueId) membershipsQuery = membershipsQuery.eq("league_id", parsed.data.leagueId);
    const membershipsResult = await membershipsQuery;
    if (membershipsResult.error) return errorResponse("context_unavailable", 503);

    const memberships = membershipsResult.data || [];
    if (memberships.length > 64) return errorResponse("league_membership_limit_exceeded", 503);
    if (!memberships.length) {
      return NextResponse.json({ ok: true, status: "setup_required", setupRequired: true, data: { memberships: [], activeLeagueId: null } });
    }

    const leagueIds = [...new Set(memberships.map((membership) => String(membership.league_id)))];
    const rosterIds = [...new Set(memberships.map((membership) => membership.roster_id).filter((id): id is string => Boolean(id)).map(String))];
    const [leaguesResult, rostersResult, slotsResult, preferencesResult] = await Promise.all([
      auth.adminClient.from("leagues").select("id, name, provider, season, current_week, scoring, roster_positions, workspace_id").in("id", leagueIds),
      rosterIds.length ? auth.adminClient.from("rosters").select("id, league_id, owner_user_id, name, provider_roster_id, player_ids, starter_ids").in("id", rosterIds) : Promise.resolve({ data: [], error: null }),
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
      // expose the authenticated user's roster in the same league.
      const roster = referencedRoster && String(referencedRoster.league_id) === leagueId
        && String(referencedRoster.owner_user_id) === auth.user.id ? referencedRoster : undefined;
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
    const metadata = auth.user.user_metadata;
    const preferredLeagueId = metadata && typeof metadata.fwrActiveLeagueId === "string"
      ? metadata.fwrActiveLeagueId : null;
    const readyMemberships = data.filter((entry) => entry.league && entry.roster
      && entry.preferences && entry.rosterSlots.length > 0);
    const active = selectPrimaryMembership(readyMemberships, preferredLeagueId);
    const setupRequired = !active;
    return NextResponse.json({ ok: true, status: setupRequired ? "setup_required" : "ready", setupRequired,
      data: { memberships: data, activeLeagueId: active?.league?.id || null,
        selectableLeagueIds: readyMemberships.map((entry) => entry.league!.id) } });
  } catch {
    return errorResponse("context_unavailable", 503);
  }
}

/** Save only a league already mapped to this authenticated user's roster. */
export async function PATCH(request: Request) {
  if (!hasAdminCredentials()) return errorResponse("supabase_unavailable", 503);
  let raw: unknown;
  try {
    const body = await request.text();
    if (body.length > 1024) return errorResponse("league_selection_too_large", 413);
    raw = JSON.parse(body) as unknown;
  } catch {
    return errorResponse("invalid_json", 400);
  }
  const parsed = selectionSchema.safeParse(raw);
  if (!parsed.success) return errorResponse("invalid_league_selection", 400);

  let auth;
  try {
    auth = await getAuthenticatedRequest(request);
  } catch {
    return errorResponse("authentication_unavailable", 503);
  }
  if (!auth) return errorResponse("authentication_required", 401);

  const { leagueId } = parsed.data;
  const membership = await auth.adminClient.from("league_memberships")
    .select("roster_id")
    .eq("user_id", auth.user.id).eq("league_id", leagueId).maybeSingle();
  if (membership.error) return errorResponse("league_membership_unavailable", 503);
  if (!membership.data?.roster_id) return errorResponse("league_access_denied", 403);
  const ownedRoster = await auth.adminClient.from("rosters").select("id")
    .eq("id", membership.data.roster_id).eq("league_id", leagueId)
    .eq("owner_user_id", auth.user.id).maybeSingle();
  if (ownedRoster.error) return errorResponse("league_roster_unavailable", 503);
  if (!ownedRoster.data) return errorResponse("league_access_denied", 403);

  const existing = auth.user.user_metadata && typeof auth.user.user_metadata === "object"
    && !Array.isArray(auth.user.user_metadata) ? auth.user.user_metadata : {};
  const updated = await auth.adminClient.auth.admin.updateUserById(auth.user.id, {
    user_metadata: { ...existing, fwrActiveLeagueId: leagueId },
  });
  if (updated.error || !updated.data.user) return errorResponse("league_selection_unavailable", 503);
  return NextResponse.json({ ok: true, activeLeagueId: leagueId });
}
