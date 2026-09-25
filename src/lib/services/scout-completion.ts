export type ScoutCompletionStep = {
  name: string;
  status: "success" | "failed" | "skipped";
  error?: string;
};

const requiredSteps = [
  "league_roster_freshness",
  "roster_identity_seed",
  "player_normalization",
  "stats_snapshot_ingestion",
  "projection_ingestion",
  "feature_scoring",
  "recommendation_materialization",
  "waiver_scoring",
  "waiver_materialization",
  "daily_brief_materialization",
] as const;

/** A run completes only after source, league, decision, and brief work succeeds. */
export function evaluateScoutCompletion(
  steps: ScoutCompletionStep[], failureCode: string | null,
): { complete: boolean; error: string | null } {
  const failed = steps.find((step) => step.status === "failed");
  if (failureCode || failed) return { complete: false, error: failureCode || failed?.error || "provider_error" };
  const incomplete = requiredSteps.find((name) =>
    !steps.some((step) => step.name === name && step.status === "success")
  );
  if (incomplete) {
    return { complete: false,
      error: steps.find((step) => step.name === incomplete)?.error || "pipeline_incomplete" };
  }
  return { complete: true, error: null };
}
