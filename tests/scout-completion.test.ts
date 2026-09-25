import { describe, expect, it } from "vitest";
import { evaluateScoutCompletion, type ScoutCompletionStep } from "../src/lib/services/scout-completion";

const required = [
  "league_roster_freshness", "roster_identity_seed", "player_normalization",
  "stats_snapshot_ingestion", "projection_ingestion", "feature_scoring",
  "recommendation_materialization", "waiver_scoring", "waiver_materialization",
  "daily_brief_materialization",
];

describe("Scout completion gate", () => {
  it("completes when every required stage succeeds; first-run baselines may be absent", () => {
    const steps: ScoutCompletionStep[] = required.map((name) => ({ name, status: "success" }));
    steps.push({ name: "snapshot_diff", status: "skipped", error: "scout_baseline_missing" });
    steps.push({ name: "recommendation_diff", status: "skipped", error: "brief_baseline_missing" });
    expect(evaluateScoutCompletion(steps, null)).toEqual({ complete: true, error: null });
  });

  it("degrades without a fresh league, forecast, or brief and preserves explicit failures", () => {
    const steps: ScoutCompletionStep[] = required.map((name) => ({ name, status: "success" }));
    const missingLeague = steps.map((step) => step.name === "league_roster_freshness"
      ? { ...step, status: "skipped" as const, error: "current_yahoo_league_unavailable" } : step);
    expect(evaluateScoutCompletion(missingLeague, null)).toEqual({ complete: false, error: "current_yahoo_league_unavailable" });
    const missingForecast = steps.map((step) => step.name === "projection_ingestion"
      ? { ...step, status: "skipped" as const, error: "projection_provider_unavailable" } : step);
    expect(evaluateScoutCompletion(missingForecast, null)).toEqual({ complete: false, error: "projection_provider_unavailable" });
    expect(evaluateScoutCompletion(steps, "snapshot_diff_failed"))
      .toEqual({ complete: false, error: "snapshot_diff_failed" });
  });
});
