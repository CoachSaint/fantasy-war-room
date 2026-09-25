import type { LeagueContext, Player, Position } from "@/lib/types";

const SLEEPER_BASE = "https://api.sleeper.app/v1";

export interface SleeperWeeklyProjection {
  sleeperId: string;
  season: number;
  week: number;
  ppr: number | null;
  halfPpr: number | null;
  standard: number | null;
  stats: Record<string, number>;
  observedAt: string;
}

const projectionStatKeys = new Set([
  "pass_yd", "pass_td", "pass_int", "rush_att", "rush_yd", "rush_td",
  "rec", "rec_yd", "rec_td", "pass_2pt", "rush_2pt", "rec_2pt",
  "fum_lost", "st_td", "def_fum_td",
]);

function finiteProjection(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= -20 && parsed <= 100 ? parsed : null;
}

/** Rows containing only ADP are excluded; they are not weekly forecasts. */
export function parseSleeperWeeklyProjections(
  raw: unknown, season: number, week: number, observedAt = new Date().toISOString()
): SleeperWeeklyProjection[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw).flatMap(([sleeperId, rawStats]) => {
    if (!/^\d+$/.test(sleeperId) || !rawStats || typeof rawStats !== "object" || Array.isArray(rawStats)) return [];
    const row = rawStats as Record<string, unknown>;
    const ppr = finiteProjection(row.pts_ppr);
    const halfPpr = finiteProjection(row.pts_half_ppr);
    const standard = finiteProjection(row.pts_std);
    if (ppr == null && halfPpr == null && standard == null) return [];
    const stats = Object.fromEntries(Object.entries(row)
      .filter(([key, value]) => projectionStatKeys.has(key) && typeof value === "number" && Number.isFinite(value))
      .map(([key, value]) => [key, Number(value)]));
    return [{ sleeperId, season, week, ppr, halfPpr, standard, stats, observedAt }];
  });
}

async function sleeperFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${SLEEPER_BASE}${path}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: path.startsWith("/players/nfl") ? 86400 : 300 },
  });

  if (!response.ok) {
    throw new Error(`Sleeper request failed: ${response.status} for ${path}`);
  }
  return response.json() as Promise<T>;
}

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar?: string;
  metadata?: Record<string, unknown>;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  scoring_settings: Record<string, number>;
  roster_positions: string[];
  status: string;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi?: string[] | null;
  settings?: Record<string, number>;
  league_id?: string;
}

export interface SleeperNflState {
  week: number;
  season: string;
  season_type: string;
  leg: number;
  league_season: string;
  display_week: number;
  season_has_scores?: boolean;
}

export interface SleeperPlayerRaw {
  player_id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  team?: string | null;
  position?: string | null;
  fantasy_positions?: string[] | null;
  age?: number;
  status?: string;
  injury_status?: string | null;
  active?: boolean;
  search_rank?: number;
  bye_week?: number;
  depth_chart_order?: number | null;
  depth_chart_position?: string | null;
}

export interface NormalizeRosterOptions {
  /** The explicitly selected NFL state. The adapter never invents a week. */
  nflState?: SleeperNflState;
  /** Candidate players which are eligible to be considered available. */
  activePlayerIds?: Iterable<string>;
  /** Players to omit even when they are in the active pool. */
  excludedPlayerIds?: Iterable<string>;
  /** Optional Sleeper player map used to derive an active pool safely. */
  players?: Record<string, SleeperPlayerRaw>;
}

interface PlayersCache {
  data: Record<string, SleeperPlayerRaw> | null;
  fetchedAt: number;
}

const playersCache: PlayersCache = {
  data: null,
  fetchedAt: 0,
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const sleeper = {
  getWeeklyProjections: async (season: number, week: number): Promise<SleeperWeeklyProjection[]> => {
    // This observed public endpoint is outside Sleeper's published API reference.
    // Keep it optional and never infer a projection from an ADP-only row.
    const response = await fetch(`${SLEEPER_BASE}/projections/nfl/regular/${season}/${week}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("sleeper_projections_unavailable");
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > 2_000_000) throw new Error("sleeper_projections_too_large");
    const body = await response.text();
    if (new TextEncoder().encode(body).length > 2_000_000) throw new Error("sleeper_projections_too_large");
    return parseSleeperWeeklyProjections(JSON.parse(body) as unknown, season, week);
  },
  getUser: (usernameOrId: string) =>
    sleeperFetch<SleeperUser>(`/user/${encodeURIComponent(usernameOrId)}`),

  getLeagues: (userId: string, season: number | string) =>
    sleeperFetch<SleeperLeague[]>(`/user/${userId}/leagues/nfl/${season}`),

  getLeague: (leagueId: string) =>
    sleeperFetch<SleeperLeague>(`/league/${leagueId}`),

  getRosters: (leagueId: string) =>
    sleeperFetch<SleeperRoster[]>(`/league/${leagueId}/rosters`),

  getUsers: (leagueId: string) =>
    sleeperFetch<SleeperUser[]>(`/league/${leagueId}/users`),

  getNflState: () =>
    sleeperFetch<SleeperNflState>(`/state/nfl`),

  getPlayers: async (forceRefresh = false): Promise<Record<string, SleeperPlayerRaw>> => {
    const now = Date.now();
    if (!forceRefresh && playersCache.data && now - playersCache.fetchedAt < CACHE_TTL_MS) {
      return playersCache.data;
    }
    const data = await sleeperFetch<Record<string, SleeperPlayerRaw>>(`/players/nfl`);
    playersCache.data = data;
    playersCache.fetchedAt = now;
    return data;
  },

  clearPlayersCache: () => {
    playersCache.data = null;
    playersCache.fetchedAt = 0;
  },

  getTrending: (type: "add" | "drop", lookbackHours = 24, limit = 25) =>
    sleeperFetch<Array<{ player_id: string; count: number }>>(
      `/players/nfl/trending/${type}?lookback_hours=${lookbackHours}&limit=${limit}`
    ),

  /** Resolve live state and player availability before normalizing a league. */
  getLeagueContext: async (
    league: SleeperLeague,
    rosters: SleeperRoster[],
    userRosterId?: number,
    options: NormalizeRosterOptions = {}
  ): Promise<LeagueContext> => {
    const [stateResult, playersResult] = await Promise.allSettled([
      options.nflState ? Promise.resolve(options.nflState) : sleeper.getNflState(),
      options.players || options.activePlayerIds ? Promise.resolve(options.players) : sleeper.getPlayers(),
    ]);
    const nflState = stateResult.status === "fulfilled" ? stateResult.value : undefined;
    const players = playersResult.status === "fulfilled" ? playersResult.value : undefined;
    return sleeper.normalizeRosterToLeagueContext(league, rosters, userRosterId, {
      ...options,
      nflState,
      players,
    });
  },

  normalizePlayer: (sleeperId: string, raw: SleeperPlayerRaw): Player => {
    const validPositions: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];
    const pos = (raw.position || raw.fantasy_positions?.[0] || "WR") as Position;
    const position = validPositions.includes(pos) ? pos : "WR";

    return {
      id: `sleeper_${sleeperId}`,
      sleeperId,
      fullName: raw.full_name || `${raw.first_name || ""} ${raw.last_name || ""}`.trim() || sleeperId,
      team: raw.team || undefined,
      position,
      byeWeek: raw.bye_week || undefined,
      status: raw.injury_status || raw.status || "Active",
    };
  },

  normalizeRosterToLeagueContext: (
    league: SleeperLeague,
    rosters: SleeperRoster[],
    userRosterId?: number,
    options: NormalizeRosterOptions | SleeperNflState = {}
  ): LeagueContext => {
    // Accepting a state directly keeps this sync compatibility helper useful for
    // callers that already fetched /state/nfl, while the async helper above can
    // obtain it from Sleeper itself.
    const normalizedOptions: NormalizeRosterOptions = "week" in options && !("nflState" in options)
      ? { nflState: options as SleeperNflState }
      : options as NormalizeRosterOptions;
    // A missing roster id is an incomplete identity match, not permission to use
    // another manager's roster. Failing closed here prevents cross-team leakage.
    const userRoster = userRosterId == null
      ? undefined
      : rosters.find((r) => r.roster_id === userRosterId);
    const rosterPlayerIds = userRoster ? userRoster.players || [] : [];

    const allRosteredPlayerIds = new Set<string>();
    for (const r of rosters) {
      for (const ids of [r.players, r.starters, r.reserve, r.taxi]) {
        for (const p of ids || []) {
          allRosteredPlayerIds.add(p);
        }
      }
    }

    const derivedActivePlayerIds = normalizedOptions.players
      ? Object.values(normalizedOptions.players)
          .filter((p) => p.active !== false && p.team != null && p.team !== "")
          .map((p) => p.player_id)
      : [];
    const activePlayerIds = new Set(normalizedOptions.activePlayerIds || derivedActivePlayerIds);
    const excludedPlayerIds = new Set(normalizedOptions.excludedPlayerIds || []);
    const availablePlayerIds = Array.from(activePlayerIds).filter(
      (playerId) => !allRosteredPlayerIds.has(playerId) && !excludedPlayerIds.has(playerId)
    );

    const recScoring = league.scoring_settings?.rec || 0;
    let scoring: LeagueContext["scoring"] = "standard";
    if (recScoring === 1) scoring = "ppr";
    else if (recScoring === 0.5) scoring = "half_ppr";
    else if (recScoring > 0) scoring = "custom";

    return {
      leagueId: league.league_id,
      season: parseInt(league.season, 10) || 2026,
      week: normalizedOptions.nflState?.display_week || normalizedOptions.nflState?.week || 0,
      scoring,
      rosterPositions: league.roster_positions || [],
      rosterPlayerIds,
      availablePlayerIds,
    };
  },
};
