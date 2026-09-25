import type { SupabaseClient } from "@supabase/supabase-js";
import { materializeDailyBriefForLeague } from "@/lib/services/daily-brief";
import { materializeYahooLineupForLeague } from "@/lib/services/yahoo-lineup";
import { materializeYahooWaiversForLeague } from "@/lib/services/yahoo-waivers";

export type YahooDecisionRefresh = {
  leagueId: string;
  status: "evaluated" | "not_ready" | "failed";
  recommendationsWritten: number;
  briefsWritten: number;
  reason?: string;
};

/** Recompute decisions from already-ingested forecasts after a roster/availability sync. */
export async function refreshYahooDecisionsAfterImport(
  client: SupabaseClient,
  leagueIds: string[],
  asOf = new Date(),
): Promise<YahooDecisionRefresh[]> {
  const results: YahooDecisionRefresh[] = [];
  for (const leagueId of [...new Set(leagueIds)].slice(0, 10)) {
    try {
      const lineup = await materializeYahooLineupForLeague(client, leagueId, asOf);
      const waivers = await materializeYahooWaiversForLeague(client, leagueId, asOf);
      if (lineup.status === "skipped" && waivers.status === "skipped") {
        results.push({ leagueId, status: "not_ready", recommendationsWritten: 0,
          briefsWritten: 0, reason: `${lineup.reason || "lineup_unavailable"};${waivers.reason || "waivers_unavailable"}` });
        continue;
      }
      const brief = await materializeDailyBriefForLeague(client, leagueId, asOf);
      results.push({ leagueId, status: "evaluated",
        recommendationsWritten: lineup.recommendationsInserted + waivers.recommendationsInserted,
        briefsWritten: brief.briefsWritten,
        ...(lineup.status === "skipped" || waivers.status === "skipped"
          ? { reason: [lineup.reason, waivers.reason].filter(Boolean).join(";") } : {}),
      });
    } catch (error) {
      results.push({ leagueId, status: "failed", recommendationsWritten: 0, briefsWritten: 0,
        reason: error instanceof Error && "code" in error && typeof error.code === "string"
          ? error.code : "decision_refresh_failed" });
    }
  }
  return results;
}
