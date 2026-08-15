import type { LeagueContext, Player, Position } from "@/lib/types";

const SLEEPER_BASE = "https://api.sleeper.app/v1";

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
    userRosterId?: number
  ): LeagueContext => {
    const userRoster = rosters.find((r) => r.roster_id === userRosterId) || rosters[0];
    const rosterPlayerIds = userRoster ? userRoster.players || [] : [];

    const allRosteredPlayerIds = new Set<string>();
    for (const r of rosters) {
      if (r.players) {
        for (const p of r.players) {
          allRosteredPlayerIds.add(p);
        }
      }
    }

    const recScoring = league.scoring_settings?.rec || 0;
    let scoring: LeagueContext["scoring"] = "standard";
    if (recScoring === 1) scoring = "ppr";
    else if (recScoring === 0.5) scoring = "half_ppr";
    else if (recScoring > 0) scoring = "custom";

    return {
      leagueId: league.league_id,
      season: parseInt(league.season, 10) || 2026,
      week: 1,
      scoring,
      rosterPositions: league.roster_positions || [],
      rosterPlayerIds,
      availablePlayerIds: Array.from(allRosteredPlayerIds),
    };
  },
};
