import type { Position, RosterSlotType } from "@/lib/types";

const YAHOO_FANTASY_BASE = "https://fantasysports.yahooapis.com/fantasy/v2";
const MAX_LEAGUES = 10;
const MAX_TEAMS_PER_LEAGUE = 32;

type UnknownRecord = Record<string, unknown>;

export interface YahooPlayer {
  playerKey: string;
  playerId: string;
  fullName: string;
  team?: string;
  position: Position;
  status?: string;
  selectedPosition?: string;
}

export interface YahooTeamRoster {
  teamKey: string;
  teamId: string;
  name: string;
  managerId?: string;
  managerName?: string;
  ownedByCurrentUser: boolean;
  waiverPriority?: number;
  faabBalance?: number;
  players: YahooPlayer[];
}

export interface YahooRosterSlot {
  slotType: RosterSlotType;
  count: number;
  eligiblePositions: Position[];
  required: boolean;
}

export interface YahooLeagueImport {
  leagueKey: string;
  leagueId: string;
  name: string;
  season: number;
  currentWeek: number;
  ownedTeamKey: string;
  rosterSlots: YahooRosterSlot[];
  scoringModifiers: Record<string, number>;
  teams: YahooTeamRoster[];
  matchups: YahooMatchup[];
}

export interface YahooMatchup {
  week: number;
  teamKeys: [string, string];
  points: [number | null, number | null];
  projectedPoints: [number | null, number | null];
  status: string;
  winnerTeamKey: string | null;
  isTied: boolean;
  isPlayoffs: boolean;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function scalar(value: unknown): string | number | boolean | null {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
}

function findScalar(value: unknown, key: string): string | number | boolean | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findScalar(item, key);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (key in value) {
    const direct = scalar(value[key]);
    if (direct !== null) return direct;
    const nested = findScalar(value[key], key);
    if (nested !== null) return nested;
  }
  for (const item of Object.values(value)) {
    const found = findScalar(item, key);
    if (found !== null) return found;
  }
  return null;
}

function findNamedNodes(value: unknown, key: string, output: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    value.forEach((item) => findNamedNodes(item, key, output));
  } else if (isRecord(value)) {
    for (const [entryKey, item] of Object.entries(value)) {
      if (entryKey === key) output.push(item);
      findNamedNodes(item, key, output);
    }
  }
  return output;
}

function text(value: unknown, key: string): string | undefined {
  const found = findScalar(value, key);
  return found === null ? undefined : String(found).trim() || undefined;
}

function number(value: unknown, key: string): number | undefined {
  const raw = findScalar(value, key);
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function truthy(value: unknown, key: string): boolean {
  const raw = findScalar(value, key);
  return raw === true || raw === 1 || raw === "1" || raw === "true";
}

function leagueKeyFromTeamKey(teamKey: string): string {
  return teamKey.replace(/\.t\.\d+$/, "");
}

function normalizePosition(value: string | undefined): Position | null {
  const position = value?.toUpperCase();
  if (position === "QB" || position === "RB" || position === "WR" || position === "TE" || position === "K") return position;
  if (position === "DEF" || position === "DST") return "DST";
  return null;
}

function normalizeRosterSlot(positionValue: string | undefined, countValue: number | undefined): YahooRosterSlot | null {
  const position = positionValue?.toUpperCase();
  const count = Math.max(1, Math.min(20, Math.trunc(countValue || 1)));
  const definitions: Record<string, { slotType: RosterSlotType; eligiblePositions: Position[]; required: boolean }> = {
    QB: { slotType: "QB", eligiblePositions: ["QB"], required: true },
    RB: { slotType: "RB", eligiblePositions: ["RB"], required: true },
    WR: { slotType: "WR", eligiblePositions: ["WR"], required: true },
    TE: { slotType: "TE", eligiblePositions: ["TE"], required: true },
    K: { slotType: "K", eligiblePositions: ["K"], required: true },
    DEF: { slotType: "DST", eligiblePositions: ["DST"], required: true },
    DST: { slotType: "DST", eligiblePositions: ["DST"], required: true },
    "W/R/T": { slotType: "FLEX", eligiblePositions: ["RB", "WR", "TE"], required: true },
    "Q/W/R/T": { slotType: "SUPER_FLEX", eligiblePositions: ["QB", "RB", "WR", "TE"], required: true },
    "W/R": { slotType: "WR_RB", eligiblePositions: ["WR", "RB"], required: true },
    "W/T": { slotType: "WR_TE", eligiblePositions: ["WR", "TE"], required: true },
    BN: { slotType: "BENCH", eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DST"], required: false },
    IR: { slotType: "IR", eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DST"], required: false },
    "IR+": { slotType: "IR", eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DST"], required: false },
  };
  const definition = position ? definitions[position] : undefined;
  return definition ? { ...definition, count } : null;
}

function normalizePlayer(node: unknown): YahooPlayer | null {
  const playerKey = text(node, "player_key");
  if (!playerKey || !/^\d+\.p\.\d+$/.test(playerKey)) return null;
  const nameNode = findNamedNodes(node, "name")[0];
  const selectedNode = findNamedNodes(node, "selected_position")[0];
  const position = normalizePosition(text(node, "display_position"));
  const selectedPosition = text(selectedNode, "position");
  if (!position || !selectedPosition) return null;
  return {
    playerKey,
    playerId: text(node, "player_id") || playerKey,
    fullName: text(nameNode, "full") || text(node, "full_name") || playerKey,
    team: text(node, "editorial_team_abbr"),
    position,
    status: text(node, "status_full") || text(node, "status"),
    selectedPosition,
  };
}

function normalizeTeam(node: unknown): YahooTeamRoster | null {
  const teamKey = text(node, "team_key");
  if (!teamKey || !/^\d+\.l\.\d+\.t\.\d+$/.test(teamKey)) return null;
  const managerNode = findNamedNodes(node, "manager")[0];
  const players = findNamedNodes(node, "player")
    .map(normalizePlayer)
    .filter((player): player is YahooPlayer => player !== null);
  return {
    teamKey,
    teamId: text(node, "team_id") || teamKey,
    name: text(node, "name") || teamKey,
    managerId: text(managerNode, "guid") || text(managerNode, "manager_id"),
    managerName: text(managerNode, "nickname"),
    ownedByCurrentUser: truthy(node, "is_owned_by_current_login"),
    waiverPriority: number(node, "waiver_priority"),
    faabBalance: number(node, "faab_balance"),
    players,
  };
}

export function normalizeYahooMatchups(payload: unknown, leagueKey: string, week: number, teamKeys: string[]): YahooMatchup[] {
  const nodes = findNamedNodes(payload, "matchup");
  if (!nodes.length || nodes.length > MAX_TEAMS_PER_LEAGUE / 2) throw new Error("yahoo_matchups_invalid");
  if (teamKeys.some((key) => !key.startsWith(`${leagueKey}.t.`))) throw new Error("yahoo_matchups_invalid");
  const knownTeams = new Set(teamKeys);
  if (knownTeams.size !== teamKeys.length) throw new Error("yahoo_matchups_invalid");
  const seenTeams = new Set<string>();
  const matchups = nodes.map((node) => {
    const matchupWeek = number(node, "week");
    const teamNodes = findNamedNodes(node, "team");
    if (matchupWeek !== week || teamNodes.length !== 2) throw new Error("yahoo_matchups_invalid");
    const parsed = teamNodes.map((team) => ({
      key: text(team, "team_key"),
      points: number(findNamedNodes(team, "team_points")[0], "total") ?? null,
      projected: number(findNamedNodes(team, "team_projected_points")[0], "total") ?? null,
    })).sort((a, b) => String(a.key).localeCompare(String(b.key)));
    if (parsed[0].key === parsed[1].key || parsed.some((team) => !team.key || !knownTeams.has(team.key) || seenTeams.has(team.key))) {
      throw new Error("yahoo_matchups_invalid");
    }
    const winnerTeamKey = text(node, "winner_team_key") ?? null;
    if (winnerTeamKey && !parsed.some((team) => team.key === winnerTeamKey)) throw new Error("yahoo_matchups_invalid");
    if (winnerTeamKey && truthy(node, "is_tied")) throw new Error("yahoo_matchups_invalid");
    parsed.forEach((team) => seenTeams.add(team.key!));
    return {
      week,
      teamKeys: [parsed[0].key!, parsed[1].key!] as [string, string],
      points: [parsed[0].points, parsed[1].points] as [number | null, number | null],
      projectedPoints: [parsed[0].projected, parsed[1].projected] as [number | null, number | null],
      status: text(node, "status") ?? "unknown",
      winnerTeamKey,
      isTied: truthy(node, "is_tied"),
      isPlayoffs: truthy(node, "is_playoffs"),
    };
  });
  if (seenTeams.size !== knownTeams.size) throw new Error("yahoo_matchups_invalid");
  return matchups;
}

export function normalizeYahooOwnedTeams(payload: unknown): YahooTeamRoster[] {
  const byKey = new Map<string, YahooTeamRoster>();
  for (const node of findNamedNodes(payload, "team")) {
    const team = normalizeTeam(node);
    if (team?.ownedByCurrentUser) byKey.set(team.teamKey, team);
  }
  return [...byKey.values()];
}

export function normalizeYahooLeagueImport(
  metadataPayload: unknown,
  settingsPayload: unknown,
  teamsPayload: unknown,
  scoreboardPayload: unknown,
  rosterPayloads: Map<string, unknown>,
  ownedTeamKey: string
): YahooLeagueImport {
  const leagueNode = findNamedNodes(metadataPayload, "league")[0] ?? metadataPayload;
  const leagueKey = text(leagueNode, "league_key");
  const leagueId = text(leagueNode, "league_id");
  const name = text(leagueNode, "name");
  const season = number(leagueNode, "season");
  const currentWeek = number(leagueNode, "current_week");
  if (!leagueKey || !/^\d+\.l\.\d+$/.test(leagueKey) || leagueKey !== leagueKeyFromTeamKey(ownedTeamKey) || !leagueId || !name) {
    throw new Error("yahoo_payload_invalid");
  }
  if (!Number.isInteger(season) || season! < 2000 || season! > 2100 || !Number.isInteger(currentWeek) || currentWeek! < 0 || currentWeek! > 23) {
    throw new Error("yahoo_payload_invalid");
  }
  const baseTeams = findNamedNodes(teamsPayload, "team")
    .map(normalizeTeam)
    .filter((team): team is YahooTeamRoster => team !== null);
  if (!baseTeams.length || baseTeams.length > MAX_TEAMS_PER_LEAGUE) throw new Error("yahoo_payload_invalid");
  const teamKeys = baseTeams.map((team) => team.teamKey);
  if (new Set(teamKeys).size !== teamKeys.length || !teamKeys.includes(ownedTeamKey)) throw new Error("yahoo_payload_invalid");
  const teams = baseTeams.map((team) => {
    const roster = rosterPayloads.get(team.teamKey);
    if (!roster || findNamedNodes(roster, "players").length === 0) throw new Error("yahoo_payload_invalid");
    const rawPlayers = findNamedNodes(roster, "player");
    const players = rawPlayers.map(normalizePlayer).filter((player): player is YahooPlayer => player !== null);
    if (players.length !== rawPlayers.length) throw new Error("yahoo_payload_unsupported");
    return { ...team, players };
  });

  const rawRosterSlots = findNamedNodes(settingsPayload, "roster_position");
  const rosterSlots = rawRosterSlots
    .map((node) => normalizeRosterSlot(text(node, "position"), number(node, "count")))
    .filter((slot): slot is YahooRosterSlot => slot !== null);
  if (!rosterSlots.length || rosterSlots.length !== rawRosterSlots.length) throw new Error("yahoo_payload_unsupported");
  const scoringModifiers: Record<string, number> = {};
  const rawStats = findNamedNodes(settingsPayload, "stat");
  if (!rawStats.length) throw new Error("yahoo_payload_invalid");
  for (const stat of rawStats) {
    const statId = text(stat, "stat_id");
    const value = number(stat, "value");
    if (!statId || value == null) throw new Error("yahoo_payload_invalid");
    scoringModifiers[statId] = value;
  }

  return {
    leagueKey,
    leagueId,
    name,
    season: season!,
    currentWeek: currentWeek!,
    ownedTeamKey,
    rosterSlots,
    scoringModifiers,
    teams: teams.slice(0, MAX_TEAMS_PER_LEAGUE),
    matchups: normalizeYahooMatchups(scoreboardPayload, leagueKey, currentWeek!, teamKeys),
  };
}

async function yahooFetch(accessToken: string, resource: string): Promise<unknown> {
  const url = new URL(`${YAHOO_FANTASY_BASE}${resource}`);
  url.searchParams.set("format", "json");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) throw new Error("yahoo_access_denied");
    if (!response.ok) throw new Error("yahoo_provider_unavailable");
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function mapConcurrent<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function getYahooLeagueImports(accessToken: string): Promise<YahooLeagueImport[]> {
  const discovery = await yahooFetch(accessToken, "/users;use_login=1/games;game_keys=nfl/teams");
  const ownedTeams = normalizeYahooOwnedTeams(discovery).slice(0, MAX_LEAGUES);
  if (!ownedTeams.length) throw new Error("yahoo_no_nfl_teams");
  const seenLeagues = new Set<string>();
  const uniqueOwnedTeams = ownedTeams.filter((team) => {
    const leagueKey = leagueKeyFromTeamKey(team.teamKey);
    if (seenLeagues.has(leagueKey)) return false;
    seenLeagues.add(leagueKey);
    return true;
  });

  return mapConcurrent(uniqueOwnedTeams, 3, async (ownedTeam) => {
    const leagueKey = leagueKeyFromTeamKey(ownedTeam.teamKey);
    const [metadata, settings, teamsPayload] = await Promise.all([
      yahooFetch(accessToken, `/league/${encodeURIComponent(leagueKey)}/metadata`),
      yahooFetch(accessToken, `/league/${encodeURIComponent(leagueKey)}/settings`),
      yahooFetch(accessToken, `/league/${encodeURIComponent(leagueKey)}/teams`),
    ]);
    const leagueNode = findNamedNodes(metadata, "league")[0] ?? metadata;
    const week = Math.max(1, Math.min(23, number(leagueNode, "current_week") || 1));
    const scoreboardPayload = await yahooFetch(accessToken, `/league/${encodeURIComponent(leagueKey)}/scoreboard;week=${week}`);
    const teamKeys = findNamedNodes(teamsPayload, "team")
      .map((node) => text(node, "team_key"))
      .filter((key): key is string => Boolean(key))
      .slice(0, MAX_TEAMS_PER_LEAGUE);
    if (!teamKeys.length || new Set(teamKeys).size !== teamKeys.length || !teamKeys.includes(ownedTeam.teamKey)) {
      throw new Error("yahoo_payload_invalid");
    }
    const rosterResults = await mapConcurrent(teamKeys, 4, async (teamKey) => ({
      teamKey,
      payload: await yahooFetch(accessToken, `/team/${encodeURIComponent(teamKey)}/roster;week=${week}/players`),
    }));
    return normalizeYahooLeagueImport(
      metadata,
      settings,
      teamsPayload,
      scoreboardPayload,
      new Map(rosterResults.map((entry) => [entry.teamKey, entry.payload])),
      ownedTeam.teamKey
    );
  });
}
