import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
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
  const selectedManagerId = options.managerId || (setup.managers.length === 1 ? setup.managers[0].managerId : undefined);
  if (!selectedManagerId) throw new SetupRepositoryError("manager_selection_required", 400);
  if (!setup.managers.some((manager) => manager.managerId === selectedManagerId)) {
    throw new SetupRepositoryError("manager_not_in_setup", 400);
  }

  const workspaceId = options.workspaceId || randomUUID();
  const leagueId = randomUUID();
  const managerForTeam = new Map(setup.managerMappings.map((mapping) => [mapping.teamId, mapping.managerId]));
  const rosters = setup.teams.map((team) => ({
    id: randomUUID(), provider_roster_id: team.id, name: team.name,
    owner_user_id: managerForTeam.get(team.id) === selectedManagerId ? userId : null,
  }));
  const rosterIdByTeam = new Map(rosters.map((roster) => [roster.provider_roster_id, roster.id]));
  const selectedTeamId = setup.managerMappings.find((mapping) => mapping.managerId === selectedManagerId)?.teamId;
  const selectedRosterId = selectedTeamId ? rosterIdByTeam.get(selectedTeamId) : undefined;
  if (!selectedRosterId) throw new SetupRepositoryError("roster_mapping_failed", 503);

  const assignmentIds = setup.playerAssignments.map((assignment) => assignment.playerId);
  const resolvedPlayers = await resolvePlayerIds(client, assignmentIds);
  if (assignmentIds.some((id) => !resolvedPlayers.has(id))) throw new SetupRepositoryError("unresolved_player", 400);
  if (new Set(assignmentIds.map((id) => resolvedPlayers.get(id))).size !== assignmentIds.length) {
    throw new SetupRepositoryError("duplicate_canonical_player_assignment", 400);
  }
  const assignments = setup.playerAssignments.map((assignment) => ({
    roster_id: rosterIdByTeam.get(assignment.teamId),
    player_id: resolvedPlayers.get(assignment.playerId),
  }));
  if (assignments.some((assignment) => !assignment.roster_id || !assignment.player_id)) {
    throw new SetupRepositoryError("roster_mapping_failed", 503);
  }

  let slotOrder = 0;
  const expandedSlots = setup.rosterSlots.flatMap((slot) => Array.from({ length: slot.count ?? 1 }, () => ({
    slot_type: slot.slotType,
    slot_order: slotOrder++,
    eligible_positions: slot.eligiblePositions,
    required: slot.required ?? !["BENCH", "IR", "TAXI"].includes(slot.slotType),
  })));
  const result = await client.rpc("create_manual_league_setup", {
    p_user_id: userId,
    p_workspace_id: workspaceId,
    p_create_workspace: !options.workspaceId,
    p_workspace_name: `${setup.league.name} Workspace`.slice(0, 120),
    p_league_id: leagueId,
    p_provider_league_id: setup.league.leagueId,
    p_league_name: setup.league.name,
    p_season: setup.league.season,
    p_week: setup.league.week,
    p_scoring: setup.scoring,
    p_roster_positions: expandedSlots.map((slot) => slot.slot_type),
    p_scoring_rules: scoringRows(setup.scoring as unknown as Record<string, unknown>),
    p_slots: expandedSlots,
    p_rosters: rosters,
    p_selected_roster_id: selectedRosterId,
    p_selected_manager_id: selectedManagerId,
    p_assignments: assignments,
  });
  if (result.error) {
    if (result.error.code === "23505") throw new SetupRepositoryError("setup_conflict", 409);
    if (result.error.code === "P0001" && result.error.message === "workspace_manage_required") {
      throw new SetupRepositoryError("workspace_manage_required", 403);
    }
    if (result.error.code === "PGRST202") throw new SetupRepositoryError("setup_migration_required", 503);
    throw new SetupRepositoryError("setup_persistence_failed", 503);
  }
  const data = result.data as { workspaceId?: string; leagueId?: string; rosterId?: string } | null;
  if (data?.workspaceId !== workspaceId || data.leagueId !== leagueId || data.rosterId !== selectedRosterId) {
    throw new SetupRepositoryError("setup_result_invalid", 503);
  }
  return { workspaceId, leagueId, rosterId: selectedRosterId, fingerprint: setup.fingerprint };
}
