import type { SupabaseClient } from "@supabase/supabase-js";
import { nflverse } from "@/lib/data/nflverse";

/** Schedule absence only disables measured accuracy; it must not invent a kickoff. */
export async function ensureNflGameStarts(client: SupabaseClient, season: number, week: number): Promise<boolean> {
  const starts = await nflverse.getWeeklyGameStarts({ season, week });
  if (!starts.length) return false;
  const observedAt = new Date().toISOString();
  const result = await client.from("nfl_game_starts").upsert(starts.map((game) => ({
    season: game.season, week: game.week, team: game.team,
    kickoff_at: game.kickoffAt, observed_at: observedAt, source: "nflverse_schedules",
  })), { onConflict: "season,week,team" });
  return !result.error;
}
