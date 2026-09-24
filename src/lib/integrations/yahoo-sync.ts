import type { SupabaseClient } from "@supabase/supabase-js";
import type { YahooLeagueImport, YahooPlayer } from "@/lib/data/yahoo";

export class YahooSyncError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "YahooSyncError";
  }
}

export interface YahooSyncSummary {
  leaguesProcessed: number;
  rostersProcessed: number;
  playersProcessed: number;
  matchupsProcessed: number;
  leagueIds: string[];
}

function assertResult<T>(result: { data: T; error: { code?: string } | null }, code: string): T {
  if (result.error) throw new YahooSyncError(code);
  return result.data;
}

function designation(selectedPosition: string | undefined): "starter" | "bench" | "ir" | "taxi" {
  const value = selectedPosition?.toUpperCase();
  if (value === "IR" || value === "IR+" || value === "NA") return "ir";
  if (!value || value === "BN") return "bench";
  return "starter";
}

async function resolveYahooPlayers(
  client: SupabaseClient,
  players: YahooPlayer[]
): Promise<Map<string, string>> {
  const uniquePlayers = [...new Map(players.map((player) => [player.playerKey, player])).values()];
  if (!uniquePlayers.length) return new Map();
  const providerIds = uniquePlayers.map((player) => player.playerKey);
  const existing = await client
    .from("player_id_map")
    .select("provider_player_id, player_id")
    .eq("provider", "yahoo")
    .in("provider_player_id", providerIds);
  if (existing.error) throw new YahooSyncError("yahoo_player_mapping_unavailable");
  const resolved = new Map<string, string>((existing.data || []).map((row) => [String(row.provider_player_id), String(row.player_id)]));

  const missing = uniquePlayers.filter((player) => !resolved.has(player.playerKey));
  if (missing.length) {
    const canonical = await client.from("players").upsert(missing.map((player) => ({
      canonical_key: `yahoo:${player.playerKey}`,
      full_name: player.fullName,
      team: player.team || null,
      position: player.position,
      status: player.status || null,
      identity_status: "provider_only",
      updated_at: new Date().toISOString(),
    })), { onConflict: "canonical_key" }).select("id, canonical_key");
    if (canonical.error) throw new YahooSyncError("yahoo_player_materialization_failed");
    const playerIdByCanonicalKey = new Map((canonical.data || []).map((row) => [String(row.canonical_key), String(row.id)]));
    const mappingRows = missing.map((player) => ({
      provider: "yahoo",
      provider_player_id: player.playerKey,
      player_id: playerIdByCanonicalKey.get(`yahoo:${player.playerKey}`),
    }));
    if (mappingRows.some((row) => !row.player_id)) throw new YahooSyncError("yahoo_player_materialization_failed");
    const mappings = await client.from("player_id_map").upsert(mappingRows, { onConflict: "provider,provider_player_id" });
    if (mappings.error) throw new YahooSyncError("yahoo_player_mapping_failed");
    const queueRows = missing.map((player) => ({
      provider: "yahoo",
      provider_player_id: player.playerKey,
      player_id: playerIdByCanonicalKey.get(`yahoo:${player.playerKey}`),
      status: "pending",
      observed_name: player.fullName,
      observed_team: player.team || null,
      observed_position: player.position,
      updated_at: new Date().toISOString(),
    }));
    if (queueRows.some((row) => !row.player_id)) throw new YahooSyncError("yahoo_player_materialization_failed");
    const queue = await client.from("provider_identity_queue").upsert(queueRows, { onConflict: "provider,provider_player_id" });
    if (queue.error) throw new YahooSyncError("yahoo_identity_queue_failed");
    mappingRows.forEach((row) => resolved.set(row.provider_player_id, String(row.player_id)));
  }
  return resolved;
}

async function persistYahooLeague(
  client: SupabaseClient,
  userId: string,
  connectionId: string,
  externalUserId: string | null,
  imported: YahooLeagueImport
): Promise<{ leagueId: string; rosterId: string; rosterCount: number; playerCount: number; matchupCount: number }> {
  const now = new Date().toISOString();
  const existingLeague = await client
    .from("leagues")
    .select("id, workspace_id")
    .eq("owner_id", userId)
    .eq("provider", "yahoo")
    .eq("provider_league_id", imported.leagueKey)
    .maybeSingle();
  if (existingLeague.error) throw new YahooSyncError("yahoo_league_lookup_failed");

  let workspaceId: string;
  let leagueId: string;
  if (existingLeague.data) {
    workspaceId = String(existingLeague.data.workspace_id);
    leagueId = String(existingLeague.data.id);
    const updated = await client.from("leagues").update({
      name: imported.name,
      season: imported.season,
      current_week: imported.currentWeek,
      scoring: { provider: "yahoo", statModifiers: imported.scoringModifiers },
      roster_positions: imported.rosterSlots.flatMap((slot) => Array.from({ length: slot.count }, () => slot.slotType)),
      updated_at: now,
    }).eq("id", leagueId).eq("owner_id", userId);
    if (updated.error) throw new YahooSyncError("yahoo_league_update_failed");
  } else {
    const workspace = assertResult(await client.from("workspaces").insert({
      name: `${imported.name} Workspace`.slice(0, 120),
      created_by: userId,
    }).select("id").single(), "yahoo_workspace_create_failed");
    if (!workspace) throw new YahooSyncError("yahoo_workspace_create_failed");
    workspaceId = String(workspace.id);
    const membership = await client.from("workspace_members").upsert({ workspace_id: workspaceId, user_id: userId, role: "owner" }, { onConflict: "workspace_id,user_id" });
    if (membership.error) throw new YahooSyncError("yahoo_workspace_membership_failed");
    const league = assertResult(await client.from("leagues").insert({
      owner_id: userId,
      workspace_id: workspaceId,
      provider: "yahoo",
      provider_league_id: imported.leagueKey,
      name: imported.name,
      season: imported.season,
      current_week: imported.currentWeek,
      scoring: { provider: "yahoo", statModifiers: imported.scoringModifiers },
      roster_positions: imported.rosterSlots.flatMap((slot) => Array.from({ length: slot.count }, () => slot.slotType)),
    }).select("id").single(), "yahoo_league_create_failed");
    if (!league) throw new YahooSyncError("yahoo_league_create_failed");
    leagueId = String(league.id);
  }

  const allPlayers = imported.teams.flatMap((team) => team.players);
  const playerIds = await resolveYahooPlayers(client, allPlayers);

  const expandedSlots = imported.rosterSlots.flatMap((slot, slotIndex) => Array.from({ length: slot.count }, (_, offset) => ({
    league_id: leagueId,
    slot_type: slot.slotType,
    slot_order: imported.rosterSlots.slice(0, slotIndex).reduce((sum, prior) => sum + prior.count, 0) + offset,
    eligible_positions: slot.eligiblePositions,
    required: slot.required,
  })));
  if (expandedSlots.length) {
    const slotResult = await client.from("roster_slot_definitions").upsert(expandedSlots, { onConflict: "league_id,slot_order" });
    if (slotResult.error) throw new YahooSyncError("yahoo_roster_slots_create_failed");
  }

  const rosterRows = imported.teams.map((team) => {
    const canonicalIds = team.players.map((player) => playerIds.get(player.playerKey)).filter((id): id is string => Boolean(id));
    const starters = team.players.filter((player) => designation(player.selectedPosition) === "starter").map((player) => playerIds.get(player.playerKey)).filter((id): id is string => Boolean(id));
    return {
      league_id: leagueId,
      provider_roster_id: team.teamKey,
      owner_user_id: team.teamKey === imported.ownedTeamKey ? userId : null,
      name: team.name,
      player_ids: canonicalIds,
      starter_ids: starters,
      current_faab: team.faabBalance ?? null,
      waiver_priority: team.waiverPriority ?? null,
      metadata: { provider: "yahoo", managerId: team.managerId || null, managerName: team.managerName || null },
      updated_at: now,
    };
  });
  const rosterResult = await client.from("rosters").upsert(rosterRows, { onConflict: "league_id,provider_roster_id" }).select("id, provider_roster_id");
  if (rosterResult.error) throw new YahooSyncError("yahoo_rosters_create_failed");
  const rosterIdByTeam = new Map((rosterResult.data || []).map((row) => [String(row.provider_roster_id), String(row.id)]));
  const ownedRosterId = rosterIdByTeam.get(imported.ownedTeamKey);
  if (!ownedRosterId) throw new YahooSyncError("yahoo_owned_roster_missing");

  const assignments = imported.teams.flatMap((team) => team.players.map((player) => ({
    roster_id: rosterIdByTeam.get(team.teamKey),
    league_id: leagueId,
    player_id: playerIds.get(player.playerKey),
    slot_definition_id: null,
    designation: designation(player.selectedPosition),
  }))).filter((row) => row.roster_id && row.player_id);
  if (assignments.length) {
    const assignmentResult = await client.from("roster_assignments").upsert(assignments, { onConflict: "roster_id,player_id" });
    if (assignmentResult.error) throw new YahooSyncError("yahoo_assignments_create_failed");
  }

  const leagueMembership = await client.from("league_memberships").upsert({
    league_id: leagueId,
    user_id: userId,
    roster_id: ownedRosterId,
    provider_user_id: externalUserId,
    is_primary: true,
    updated_at: now,
  }, { onConflict: "league_id,user_id" });
  if (leagueMembership.error) throw new YahooSyncError("yahoo_league_membership_failed");
  const preferences = await client.from("manager_preferences").upsert({ user_id: userId, league_id: leagueId }, { onConflict: "user_id,league_id" });
  if (preferences.error) throw new YahooSyncError("yahoo_preferences_create_failed");
  const link = await client.from("provider_league_links").upsert({
    connection_id: connectionId,
    user_id: userId,
    provider: "yahoo",
    provider_league_id: imported.leagueKey,
    provider_team_id: imported.ownedTeamKey,
    league_id: leagueId,
    roster_id: ownedRosterId,
    last_synced_at: now,
    metadata: { leagueName: imported.name, season: imported.season },
  }, { onConflict: "user_id,provider,provider_league_id,provider_team_id" });
  if (link.error) throw new YahooSyncError("yahoo_link_create_failed");

  const matchupRows = imported.matchups.map((matchup) => {
    const teamA = rosterIdByTeam.get(matchup.teamKeys[0]);
    const teamB = rosterIdByTeam.get(matchup.teamKeys[1]);
    const winner = matchup.winnerTeamKey ? rosterIdByTeam.get(matchup.winnerTeamKey) : null;
    if (!teamA || !teamB || (matchup.winnerTeamKey && !winner)) throw new YahooSyncError("yahoo_matchup_roster_missing");
    return {
      league_id: leagueId,
      provider: "yahoo",
      week: matchup.week,
      provider_matchup_key: matchup.teamKeys.join("|"),
      team_a_roster_id: teamA,
      team_b_roster_id: teamB,
      team_a_points: matchup.points[0],
      team_b_points: matchup.points[1],
      team_a_projected_points: matchup.projectedPoints[0],
      team_b_projected_points: matchup.projectedPoints[1],
      winner_roster_id: winner,
      status: matchup.status,
      is_tied: matchup.isTied,
      is_playoffs: matchup.isPlayoffs,
      observed_at: now,
    };
  });
  const matchupResult = await client.from("league_week_matchups")
    .upsert(matchupRows, { onConflict: "league_id,week,provider_matchup_key" });
  if (matchupResult.error) throw new YahooSyncError("yahoo_matchups_create_failed");

  // Stale-row cleanup happens only after every replacement row and ownership
  // link has been written. A mid-sync failure therefore preserves prior data.
  const currentMatchupKeys = matchupRows.map((row) => JSON.stringify(row.provider_matchup_key)).join(",");
  const staleMatchups = await client.from("league_week_matchups").delete()
    .eq("league_id", leagueId)
    .eq("week", imported.currentWeek)
    .not("provider_matchup_key", "in", `(${currentMatchupKeys})`);
  if (staleMatchups.error) throw new YahooSyncError("yahoo_matchups_cleanup_failed");
  const staleSlots = await client.from("roster_slot_definitions").delete().eq("league_id", leagueId).gte("slot_order", expandedSlots.length);
  if (staleSlots.error) throw new YahooSyncError("yahoo_roster_slots_cleanup_failed");
  for (const team of imported.teams) {
    const rosterId = rosterIdByTeam.get(team.teamKey);
    if (!rosterId) continue;
    const currentPlayerIds = team.players.map((player) => playerIds.get(player.playerKey)).filter((id): id is string => Boolean(id));
    const staleAssignments = currentPlayerIds.length
      ? await client.from("roster_assignments").delete().eq("roster_id", rosterId).not("player_id", "in", `(${currentPlayerIds.join(",")})`)
      : await client.from("roster_assignments").delete().eq("roster_id", rosterId);
    if (staleAssignments.error) throw new YahooSyncError("yahoo_assignments_cleanup_failed");
  }
  const currentTeamKeys = imported.teams.map((team) => `"${team.teamKey}"`).join(",");
  const staleRosters = await client.from("rosters").delete()
    .eq("league_id", leagueId)
    .not("provider_roster_id", "in", `(${currentTeamKeys})`);
  if (staleRosters.error) throw new YahooSyncError("yahoo_rosters_cleanup_failed");

  return { leagueId, rosterId: ownedRosterId, rosterCount: imported.teams.length, playerCount: playerIds.size, matchupCount: matchupRows.length };
}

export async function persistYahooImports(
  client: SupabaseClient,
  userId: string,
  connectionId: string,
  externalUserId: string | null,
  imports: YahooLeagueImport[]
): Promise<YahooSyncSummary> {
  // Validate every league before the first database write. A partial provider
  // scoreboard must never replace or delete an existing weekly snapshot.
  for (const imported of imports) {
    const expected = new Set(imported.teams.map((team) => team.teamKey));
    const actual = imported.matchups.flatMap((matchup) => matchup.teamKeys);
    if (expected.size !== imported.teams.length || actual.length !== expected.size ||
        new Set(actual).size !== expected.size || actual.some((key) => !expected.has(key)) ||
        imported.matchups.some((matchup) => matchup.week !== imported.currentWeek)) {
      throw new YahooSyncError("yahoo_matchups_invalid");
    }
  }
  const results = [];
  for (const imported of imports) {
    results.push(await persistYahooLeague(client, userId, connectionId, externalUserId, imported));
  }
  return {
    leaguesProcessed: results.length,
    rostersProcessed: results.reduce((sum, result) => sum + result.rosterCount, 0),
    playersProcessed: results.reduce((sum, result) => sum + result.playerCount, 0),
    matchupsProcessed: results.reduce((sum, result) => sum + result.matchupCount, 0),
    leagueIds: results.map((result) => result.leagueId),
  };
}
