import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalLeagueSetup } from "@/lib/services/league-setup";

export class SetupRepositoryError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 403 | 409 | 503 = 503
  ) {
    super(code);
    this.name = "SetupRepositoryError";
  }
}

type SetupResult = {
  workspaceId: string;
  leagueId: string;
  rosterId: string;
  fingerprint: string;
};

type SetupOptions = {
  workspaceId?: string;
  managerId?: string;
};

function checked<T extends { error: { code?: string; message?: string } | null; data: T["data"] }>(
  result: T,
  fallback = "persistence_unavailable"
): T["data"] {
  if (result.error) {
    if (result.error.code === "23505") throw new SetupRepositoryError("setup_conflict", 409);
    throw new SetupRepositoryError(fallback, 503);
  }
  return result.data;
}

function scoringRows(scoring: Record<string, unknown>): Array<{
  category: "passing" | "rushing" | "receiving" | "misc" | "kicking" | "defense" | "bonus";
  stat_key: string;
  position: string;
  points: number;
}> {
  const rows: Array<{
    category: "passing" | "rushing" | "receiving" | "misc" | "kicking" | "defense" | "bonus";
    stat_key: string;
    position: string;
    points: number;
  }> = [];
  for (const [category, rawValues] of Object.entries(scoring)) {
    if (category === "preset" || !rawValues || typeof rawValues !== "object") continue;
    const dbCategory = category === "bonuses" ? "bonus" : category;
    if (!["passing", "rushing", "receiving", "misc", "kicking", "defense", "bonus"].includes(dbCategory)) continue;
    for (const [statKey, rawValue] of Object.entries(rawValues as Record<string, unknown>)) {
      if (statKey === "receptionByPosition" && rawValue && typeof rawValue === "object") {
        for (const [position, points] of Object.entries(rawValue as Record<string, unknown>)) {
          if (typeof points === "number" && Number.isFinite(points)) {
            rows.push({ category: dbCategory as typeof rows[number]["category"], stat_key: "reception", position, points });
          }
        }
      } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
        rows.push({ category: dbCategory as typeof rows[number]["category"], stat_key: statKey, position: "*", points: rawValue });
      }
    }
  }
  return rows;
}

async function cleanup(
  client: SupabaseClient,
  leagueId: string | null,
  workspaceId: string | null,
  createdWorkspace: boolean
): Promise<void> {
  const failures: string[] = [];
  if (leagueId) {
    const result = await client.from("leagues").delete().eq("id", leagueId);
    if (result.error) failures.push("league");
  }
  if (createdWorkspace && workspaceId) {
    const result = await client.from("workspaces").delete().eq("id", workspaceId);
    if (result.error) failures.push("workspace");
  }
  if (failures.length) throw new SetupRepositoryError("setup_rollback_failed", 503);
}

async function resolvePlayerIds(client: SupabaseClient, providerIds: string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const uniqueIds = [...new Set(providerIds)];
  if (!uniqueIds.length) return resolved;

  const mapped = await client
    .from("player_id_map")
    .select("provider_player_id, player_id")
    .in("provider_player_id", uniqueIds);
  if (mapped.error) throw new SetupRepositoryError("player_mapping_unavailable", 503);
  const ambiguous = new Set<string>();
  for (const row of mapped.data || []) {
    const providerId = String(row.provider_player_id);
    const playerId = String(row.player_id);
    const existing = resolved.get(providerId);
    if (existing && existing !== playerId) ambiguous.add(providerId);
    else resolved.set(providerId, playerId);
  }
  if (ambiguous.size) throw new SetupRepositoryError("ambiguous_player_mapping", 400);

  const unresolvedUuidIds = uniqueIds.filter((id) => !resolved.has(id) && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
  if (unresolvedUuidIds.length) {
    const canonical = await client.from("players").select("id").in("id", unresolvedUuidIds);
    if (canonical.error) throw new SetupRepositoryError("player_mapping_unavailable", 503);
    for (const row of canonical.data || []) resolved.set(String(row.id), String(row.id));
  }
  return resolved;
}

export async function persistLeagueSetup(
  client: SupabaseClient,
  userId: string,
  setup: CanonicalLeagueSetup,
  options: SetupOptions = {}
): Promise<SetupResult> {
  let workspaceId: string | null = null;
  let leagueId: string | null = null;
  let createdWorkspace = false;

  try {
    if (options.workspaceId) {
      const membership = await client
        .from("workspace_members")
        .select("workspace_id, role")
        .eq("workspace_id", options.workspaceId)
        .eq("user_id", userId)
        .in("role", ["owner", "admin"])
        .maybeSingle();
      if (membership.error) throw new SetupRepositoryError("workspace_access_unavailable");
      if (!membership.data) throw new SetupRepositoryError("workspace_manage_required", 403);
      workspaceId = options.workspaceId;
    } else {
      const workspace = checked(await client
        .from("workspaces")
        .insert({
          name: `${setup.league.name} Workspace`.slice(0, 120),
          created_by: userId,
        })
        .select("id")
        .single(), "workspace_create_failed");
      if (!workspace) throw new SetupRepositoryError("workspace_create_failed");
      workspaceId = String(workspace.id);
      createdWorkspace = true;

      // Keep this explicit even though the migration also has an insert
      // trigger; it makes the ownership invariant clear and survives older DBs.
      checked(await client.from("workspace_members").upsert(
        { workspace_id: workspaceId, user_id: userId, role: "owner" },
        { onConflict: "workspace_id,user_id" }
      ), "workspace_membership_create_failed");
    }

    const selectedManagerId = options.managerId || (setup.managers.length === 1 ? setup.managers[0].managerId : undefined);
    if (!selectedManagerId) throw new SetupRepositoryError("manager_selection_required", 400);
    if (!setup.managers.some((manager) => manager.managerId === selectedManagerId)) {
      throw new SetupRepositoryError("manager_not_in_setup", 400);
    }

    const league = checked(await client
      .from("leagues")
      .insert({
        owner_id: userId,
        workspace_id: workspaceId,
        provider: "manual",
        provider_league_id: setup.league.leagueId,
        name: setup.league.name,
        season: setup.league.season,
        current_week: setup.league.week,
        scoring: setup.scoring,
        roster_positions: setup.rosterSlots.flatMap((slot) => Array.from({ length: slot.count ?? 1 }, () => slot.slotType)),
      })
      .select("id")
      .single(), "league_create_failed");
    if (!league) throw new SetupRepositoryError("league_create_failed");
    leagueId = String(league.id);

    const rules = scoringRows(setup.scoring as unknown as Record<string, unknown>);
    if (rules.length) {
      checked(await client.from("league_scoring_rules").insert(rules.map((row) => ({ ...row, league_id: leagueId }))), "scoring_rules_create_failed");
    }

    const expandedSlots = setup.rosterSlots.flatMap((slot) => Array.from({ length: slot.count ?? 1 }, (_, offset) => ({
      league_id: leagueId,
      slot_type: slot.slotType,
      slot_order: setup.rosterSlots.slice(0, setup.rosterSlots.indexOf(slot)).reduce((sum, prior) => sum + (prior.count ?? 1), 0) + offset,
      eligible_positions: slot.eligiblePositions,
      required: slot.required ?? !["BENCH", "IR", "TAXI"].includes(slot.slotType),
    })));
    checked(await client.from("roster_slot_definitions").insert(expandedSlots), "roster_slots_create_failed");

    const managerForTeam = new Map(setup.managerMappings.map((mapping) => [mapping.teamId, mapping.managerId]));
    const rosters = checked(await client.from("rosters").insert(setup.teams.map((team) => ({
      league_id: leagueId,
      provider_roster_id: team.id,
      name: team.name,
      owner_user_id: managerForTeam.get(team.id) === selectedManagerId ? userId : null,
      player_ids: [],
      starter_ids: [],
    }))).select("id, provider_roster_id"), "rosters_create_failed") || [];
    const rosterIdByTeam = new Map<string, string>((rosters as Array<{ id: string; provider_roster_id: string }>).map((row) => [String(row.provider_roster_id), String(row.id)]));
    const selectedRosterId = rosterIdByTeam.get(setup.managerMappings.find((mapping) => mapping.managerId === selectedManagerId)?.teamId || "");
    if (!selectedRosterId) throw new SetupRepositoryError("roster_mapping_failed", 503);

    checked(await client.from("league_memberships").insert({
      league_id: leagueId,
      user_id: userId,
      roster_id: selectedRosterId,
      provider_user_id: selectedManagerId,
      is_primary: true,
    }), "membership_create_failed");

    checked(await client.from("manager_preferences").insert({ user_id: userId, league_id: leagueId }), "preferences_create_failed");

    const assignmentIds = setup.playerAssignments.map((assignment) => assignment.playerId);
    const resolvedPlayers = await resolvePlayerIds(client, assignmentIds);
    const unresolved = assignmentIds.filter((id) => !resolvedPlayers.has(id));
    if (unresolved.length) throw new SetupRepositoryError("unresolved_player", 400);
    const assignments = setup.playerAssignments.map((assignment) => ({
      roster_id: rosterIdByTeam.get(assignment.teamId),
      league_id: leagueId,
      player_id: resolvedPlayers.get(assignment.playerId),
      designation: "bench" as const,
      // The setup contract assigns players to teams, not exact lineup slots.
      // Leave slot selection unset instead of inventing a slot assignment.
      slot_definition_id: null,
    }));
    if (assignments.some((assignment) => !assignment.roster_id || !assignment.player_id)) throw new SetupRepositoryError("roster_mapping_failed", 503);
    if (assignments.length) checked(await client.from("roster_assignments").insert(assignments), "assignments_create_failed");

    return { workspaceId, leagueId, rosterId: selectedRosterId, fingerprint: setup.fingerprint };
  } catch (error) {
    try {
      await cleanup(client, leagueId, workspaceId, createdWorkspace);
    } catch (cleanupError) {
      if (cleanupError instanceof SetupRepositoryError) throw cleanupError;
      throw new SetupRepositoryError("setup_rollback_failed", 503);
    }
    if (error instanceof SetupRepositoryError) throw error;
    throw new SetupRepositoryError("setup_persistence_failed", 503);
  }
}
