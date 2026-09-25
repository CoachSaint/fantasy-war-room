import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/security/http";
import { nflverse } from "@/lib/data/nflverse";
import { sleeper } from "@/lib/data/sleeper";
import { materializeGlobalNflverse, materializeSleeperProjections, ScoutMaterializationError } from "@/lib/services/scout-materializer";
import { materializeYahooLineupForLeague, YahooLineupError } from "@/lib/services/yahoo-lineup";
import { materializeDailyBriefForLeague, DailyBriefError } from "@/lib/services/daily-brief";
import { materializeYahooWaiversForLeague, YahooWaiverError } from "@/lib/services/yahoo-waivers";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  season: z.coerce.number().int().min(2020).max(2100).optional(),
  week: z.coerce.number().int().min(0).max(23).optional(),
});

type ScoutInput = { season: number; week: number };

class NflStateUnavailableError extends Error {}

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const value = request.headers.get("authorization")?.trim();
  const expected = `Bearer ${cronSecret}`;
  if (!value || value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

interface StepDetail {
  name: string;
  status: "success" | "failed" | "skipped";
  durationMs: number;
  recordsProcessed: number;
  error?: string;
  sourceWeek?: number;
  unmappedRecords?: number;
}

function step(name: string, status: StepDetail["status"], startedAt: number, recordsProcessed: number, error?: string): StepDetail {
  return { name, status, durationMs: Date.now() - startedAt, recordsProcessed, ...(error ? { error } : {}) };
}

async function parseInput(request: Request): Promise<ScoutInput> {
  const url = new URL(request.url);
  const values: Record<string, string> = {};
  for (const key of ["season", "week"]) {
    const value = url.searchParams.get(key);
    if (value != null) values[key] = value;
  }
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await request.json() as unknown;
      if (body && typeof body === "object" && !Array.isArray(body)) {
        Object.assign(values, body);
      }
    }
  }
  const parsed = inputSchema.parse(values);
  if ((parsed.season == null) !== (parsed.week == null)) throw new Error("season_week_pair_required");
  if (parsed.season != null && parsed.week != null) return { season: parsed.season, week: parsed.week };

  try {
    const state = await sleeper.getNflState();
    return {
      season: z.coerce.number().int().min(2020).max(2100).parse(state.season),
      week: z.coerce.number().int().min(0).max(23).parse(state.week),
    };
  } catch {
    throw new NflStateUnavailableError();
  }
}

export async function GET(request: Request) {
  return handleScoutRun(request);
}

export async function POST(request: Request) {
  return handleScoutRun(request);
}

async function handleScoutRun(request: Request) {
  if (!process.env.CRON_SECRET) return errorResponse("cron_secret_unconfigured", 503);
  if (!isAuthorized(request)) return errorResponse("unauthorized", 401);

  let input: ScoutInput;
  try {
    input = await parseInput(request);
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse("invalid_json", 400);
    if (error instanceof NflStateUnavailableError) return errorResponse("nfl_state_unavailable", 503);
    return errorResponse("invalid_scout_input", 400);
  }

  // A validly authenticated request with no persistence plane is degraded,
  // not a successful run and not an ordinary route/configuration error.
  if (!hasAdminCredentials()) {
    return NextResponse.json(
      { ok: false, status: "degraded", error: "supabase_unavailable", season: input.season, week: input.week },
      { status: 503 }
    );
  }

  const startedAt = new Date();
  const steps: StepDetail[] = [];
  let adminClient: ReturnType<typeof createAdminClient>;
  try {
    adminClient = createAdminClient();
  } catch {
    return errorResponse("supabase_unavailable", 503);
  }
  let runId: string | null = null;

  try {
    const run = await adminClient
      .from("scout_runs")
      .insert([{ status: "running", trigger: "cron", started_at: startedAt.toISOString() }])
      .select("id")
      .single();
    if (run.error || !run.data) return errorResponse("scout_persistence_unavailable", 503);
    runId = run.data.id;
  } catch {
    return errorResponse("scout_persistence_unavailable", 503);
  }

  // Yahoo consent and league-specific recommendations remain separate from
  // global source ingestion. A partial run must keep its degraded status.
  let failureCode: string | null = null;
  let playersProcessed = 0;
  let evidenceIngested = 0;
  let statsWeek: number | null = null;
  const syncStart = Date.now();
  steps.push(step("league_roster_sync", "skipped", syncStart, 0, "league_sync_not_configured"));

  const fetchStart = Date.now();
  try {
    const [stats, evidence] = await Promise.all([
      nflverse.getLatestAvailablePlayerSnapshots(input),
      nflverse.getEvidence(input),
    ]);
    const snapshots = stats.snapshots;
    statsWeek = stats.week;
    if (!snapshots.length) {
      steps.push(step("player_normalization", "skipped", fetchStart, 0, "stats_provider_unavailable"));
      steps.push(step("stats_snapshot_ingestion", "skipped", fetchStart, 0, "stats_provider_unavailable"));
      steps.push(step("evidence_ingestion_dedupe", "skipped", fetchStart, 0, evidence.length ? "canonical_player_mapping_required" : "provider_unavailable"));
    } else {
      const result = await materializeGlobalNflverse(adminClient, snapshots, evidence);
      playersProcessed = result.playersMapped;
      evidenceIngested = result.evidenceInserted;
      steps.push(step("player_normalization", "success", fetchStart, result.playersMapped));
      steps.push({ ...step("stats_snapshot_ingestion", "success", fetchStart, result.snapshotsInserted), sourceWeek: stats.week! });
      if (!evidence.length) {
        steps.push(step("evidence_ingestion_dedupe", "skipped", fetchStart, 0, "provider_unavailable"));
      } else if (result.evidenceUnmapped) {
        steps.push(step("evidence_ingestion_dedupe", "failed", fetchStart, result.evidenceInserted, "unmapped_provider_evidence"));
        failureCode = "unmapped_provider_evidence";
      } else {
        steps.push(step("evidence_ingestion_dedupe", "success", fetchStart, result.evidenceInserted));
      }
    }
  } catch (error) {
    failureCode = error instanceof ScoutMaterializationError ? error.code : "provider_error";
    steps.push(step("player_normalization", "failed", fetchStart, 0, failureCode));
    steps.push(step("stats_snapshot_ingestion", "failed", fetchStart, 0, failureCode));
    steps.push(step("evidence_ingestion_dedupe", "failed", fetchStart, 0, failureCode));
  }

  const projectionStart = Date.now();
  try {
    const [projections, crosswalk] = await Promise.all([
      sleeper.getWeeklyProjections(input.season, input.week),
      nflverse.getYahooCrosswalk(input),
    ]);
    if (!projections.length || !crosswalk.sleeperIds.size) {
      steps.push(step("projection_ingestion", "skipped", projectionStart, 0,
        projections.length ? "projection_crosswalk_unavailable" : "projection_provider_unavailable"));
    } else {
      const result = await materializeSleeperProjections(adminClient, projections, crosswalk.sleeperIds);
      steps.push({
        ...step("projection_ingestion", "success", projectionStart, result.snapshotsInserted),
        sourceWeek: input.week,
        unmappedRecords: result.projectionsUnmapped,
      });
    }
  } catch (error) {
    const code = error instanceof ScoutMaterializationError ? error.code : "projection_provider_error";
    failureCode ??= code;
    steps.push(step("projection_ingestion", "failed", projectionStart, 0, code));
  }

  const scoringStart = Date.now();
  let recommendationsMaterialized = 0;
  const currentYahooLeagueIds: string[] = [];
  try {
    const leagueRows = await adminClient.from("leagues").select("id")
      .eq("provider", "yahoo").eq("season", input.season).eq("current_week", input.week)
      .limit(201);
    if (leagueRows.error) throw new YahooLineupError("yahoo_league_lookup_failed");
    if ((leagueRows.data || []).length > 200) throw new YahooLineupError("yahoo_league_limit_exceeded");
    currentYahooLeagueIds.push(...(leagueRows.data || []).map((row) => String(row.id)));
    if (!leagueRows.data?.length) {
      steps.push(step("feature_scoring", "skipped", scoringStart, 0, "current_yahoo_league_unavailable"));
      steps.push(step("recommendation_materialization", "skipped", scoringStart, 0, "current_yahoo_league_unavailable"));
    } else {
      let playersScored = 0;
      let completedLeagues = 0;
      const skippedReasons: string[] = [];
      for (const league of leagueRows.data) {
        const result = await materializeYahooLineupForLeague(adminClient, String(league.id));
        if (result.status === "skipped") {
          skippedReasons.push(result.reason || "league_context_unavailable");
          continue;
        }
        completedLeagues += 1;
        playersScored += result.playersScored;
        recommendationsMaterialized += result.recommendationsInserted;
      }
      const skippedReason = skippedReasons.length ? `skipped_leagues:${skippedReasons.length}` : undefined;
      steps.push(step("feature_scoring", playersScored ? "success" : "skipped", scoringStart, playersScored,
        playersScored ? skippedReason : skippedReasons[0] || "current_projection_unavailable"));
      steps.push(step("recommendation_materialization", completedLeagues ? "success" : "skipped", scoringStart,
        recommendationsMaterialized, completedLeagues ? skippedReason : skippedReasons[0] || "league_context_unavailable"));
    }
  } catch (error) {
    const code = error instanceof YahooLineupError ? error.code : "lineup_materialization_failed";
    failureCode ??= code;
    steps.push(step("feature_scoring", "failed", scoringStart, 0, code));
    steps.push(step("recommendation_materialization", "failed", scoringStart, recommendationsMaterialized, code));
  }
  const waiverStart = Date.now();
  if (!currentYahooLeagueIds.length) {
    steps.push(step("waiver_scoring", "skipped", waiverStart, 0, "current_yahoo_league_unavailable"));
    steps.push(step("waiver_materialization", "skipped", waiverStart, 0, "current_yahoo_league_unavailable"));
  } else {
    try {
      let candidatesScored = 0;
      let completedLeagues = 0;
      let waiversInserted = 0;
      const skippedReasons: string[] = [];
      for (const leagueId of currentYahooLeagueIds) {
        const result = await materializeYahooWaiversForLeague(adminClient, leagueId);
        if (result.status === "skipped") {
          skippedReasons.push(result.reason || "waiver_context_unavailable");
          continue;
        }
        completedLeagues += 1;
        candidatesScored += result.candidatesScored;
        waiversInserted += result.recommendationsInserted;
      }
      recommendationsMaterialized += waiversInserted;
      steps.push(step("waiver_scoring", candidatesScored ? "success" : "skipped", waiverStart,
        candidatesScored, candidatesScored ? undefined : skippedReasons[0] || "waiver_projection_unavailable"));
      steps.push(step("waiver_materialization", completedLeagues ? "success" : "skipped", waiverStart,
        waiversInserted, completedLeagues ? undefined : skippedReasons[0] || "waiver_context_unavailable"));
    } catch (error) {
      const code = error instanceof YahooWaiverError ? error.code : "waiver_materialization_failed";
      failureCode ??= code;
      steps.push(step("waiver_scoring", "failed", waiverStart, 0, code));
      steps.push(step("waiver_materialization", "failed", waiverStart, 0, code));
    }
  }
  const diffStart = Date.now();
  steps.push(step("snapshot_diff", "skipped", diffStart, 0, "league_baseline_required"));
  let dailyBriefsWritten = 0;
  if (!currentYahooLeagueIds.length) {
    steps.push(step("recommendation_diff", "skipped", diffStart, 0, "current_yahoo_league_unavailable"));
    steps.push(step("daily_brief_materialization", "skipped", diffStart, 0, "current_yahoo_league_unavailable"));
  } else {
    try {
      let changesFound = 0;
      let baselinesFound = 0;
      const briefAsOf = new Date();
      for (const leagueId of currentYahooLeagueIds) {
        const result = await materializeDailyBriefForLeague(adminClient, leagueId, briefAsOf);
        dailyBriefsWritten += result.briefsWritten;
        changesFound += result.changesFound;
        baselinesFound += result.baselinesFound;
      }
      steps.push(step("recommendation_diff", baselinesFound ? "success" : "skipped", diffStart,
        changesFound, baselinesFound ? undefined : "brief_baseline_missing"));
      steps.push(step("daily_brief_materialization", dailyBriefsWritten ? "success" : "skipped", diffStart,
        dailyBriefsWritten, dailyBriefsWritten ? undefined : "league_membership_unavailable"));
    } catch (error) {
      const code = error instanceof DailyBriefError ? error.code : "daily_brief_failed";
      failureCode ??= code;
      steps.push(step("recommendation_diff", "failed", diffStart, 0, code));
      steps.push(step("daily_brief_materialization", "failed", diffStart, dailyBriefsWritten, code));
    }
  }

  const finishedAt = new Date();
  const hasFailures = Boolean(failureCode) || steps.some((entry) => entry.status === "failed");
  const finalStatus = "completed_with_errors" as const;
  const runError = failureCode ?? (hasFailures ? "provider_error" : "pipeline_incomplete");
  try {
    const finalUpdate = await adminClient
      .from("scout_runs")
      .update({ status: finalStatus, finished_at: finishedAt.toISOString(), steps, error: runError })
      .eq("id", runId);
    if (finalUpdate.error) return errorResponse("scout_persistence_unavailable", 503);
  } catch {
    return errorResponse("scout_persistence_unavailable", 503);
  }

  return NextResponse.json({
    ok: false,
    status: "degraded",
    scoutRunId: runId,
    trigger: "cron",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    steps,
    error: runError,
    summary: { season: input.season, week: input.week, statsWeek, playersProcessed, evidenceIngested, recommendationsMaterialized, dailyBriefsWritten },
  }, { status: 503 });
}
