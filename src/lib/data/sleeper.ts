const SLEEPER_BASE = "https://api.sleeper.app/v1";

async function sleeperFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${SLEEPER_BASE}${path}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: path.startsWith("/players/nfl") ? 86400 : 300 },
  });

  if (!response.ok) {
    throw new Error(`Sleeper request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  scoring_settings: Record<string, number>;
  roster_positions: string[];
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
}

export const sleeper = {
  getUser: (username: string) => sleeperFetch<{ user_id: string; username: string }>(`/user/${encodeURIComponent(username)}`),
  getLeagues: (userId: string, season: number) =>
    sleeperFetch<SleeperLeague[]>(`/user/${userId}/leagues/nfl/${season}`),
  getLeague: (leagueId: string) => sleeperFetch<SleeperLeague>(`/league/${leagueId}`),
  getRosters: (leagueId: string) => sleeperFetch<SleeperRoster[]>(`/league/${leagueId}/rosters`),
  getPlayers: () => sleeperFetch<Record<string, unknown>>(`/players/nfl`),
  getTrending: (type: "add" | "drop", lookbackHours = 24, limit = 25) =>
    sleeperFetch<Array<{ player_id: string; count: number }>>(
      `/players/nfl/trending/${type}?lookback_hours=${lookbackHours}&limit=${limit}`,
    ),
};

// Keep all Sleeper-specific normalization in this file or sibling adapter files.
// No raw Sleeper payload should be imported by UI or engine modules.
