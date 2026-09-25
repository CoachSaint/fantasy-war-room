import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/security/http";
import { cronAuthorized } from "@/lib/security/cron";
import { nflverse } from "@/lib/data/nflverse";
import { sleeper } from "@/lib/data/sleeper";
import { materializeGlobalNflverse, materializeNflverseRosterPlayers, materializeSleeperProjections, ScoutMaterializationError } from "@/lib/services/scout-materializer";
import { materializeYahooLineupForLeague, YahooLineupError } from "@/lib/services/yahoo-lineup";
import { materializeDailyBriefForLeague, DailyBriefError } from "@/lib/services/daily-brief";
import { materializeYahooWaiversForLeague, YahooWaiverError } from "@/lib/services/yahoo-waivers";
import { reconcileYahooOutcomesForLeague, YahooOutcomeError } from "@/lib/services/yahoo-outcomes";
import { evaluateScoutCompletion } from "@/lib/services/scout-completion";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  season: z.coerce.number().int().min(2020).max(2100).optional(),
  week: z.coerce.number().int().min(0).max(23).optional(),
});

type ScoutInput = { season: number; week: number };

class NflStateUnavailableError extends Error {}

interface StepDetail {
  name: string;
  status: "success" | "failed" | "skipped";
  durationMs: number;
  recordsProcessed: number;
  error?: string;
  sourceWeek?: number;
  sourceWeeks?: number[];
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
  if (!cronAuthorized(request)) return errorResponse("unauthorized", 401);

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
  const rosterStart = Date.now();
  const crosswalk = await nflverse.getYahooCrosswalk(input);
  if (!crosswalk.players.size) {
    steps.push(step("roster_identity_seed", "skipped", rosterStart, 0, "roster_provider_unavailable"));
  } else {
    try {
      const mapped = await materializeNflverseRosterPlayers(adminClient, crosswalk.players);
      steps.push({ ...step("roster_identity_seed", "success", rosterStart, mapped), sourceWeek: crosswalk.week! });
    } catch (error) {
      const code = error instanceof ScoutMaterializationError ? error.code : "roster_identity_seed_failed";
      failureCode ??= code;
      steps.push(step("roster_identity_seed", "failed", rosterStart, 0, code));
    }
  }

  const fetchStart = Date.now();
  try {
    const [stats, evidence] = await Promise.all([
      nflverse.getRecentPlayerSnapshots(input),
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
      steps.push({ ...step("stats_snapshot_ingestion", "success", fetchStart, result.snapshotsInserted), sourceWeek: stats.week!, sourceWeeks: stats.weeks });
      if (!evidence.length) {
        steps.push(step("evidence_ingestion_dedupe", "skipped", fetchStart, 0, "provider_unavailable"));
      } else if (result.evidenceUnmapped) {
        steps.push(step("evidence_ingestion_dedupe", "failed", fetchStart, result.evidenceInserted, "unmapped_provider_evidence"));
        failureCode ??= "unmapped_provider_evidence";
      } else {
        steps.push(step("evidence_ingestion_dedupe", "success", fetchStart, result.evidenceInserted));
      }
    }
  } catch (error) {
    failureCode ??= error instanceof ScoutMaterializationError ? error.code : "provider_error";
    steps.push(step("player_normalization", "failed", fetchStart, 0, failureCode));
    steps.push(step("stats_snapshot_ingestion", "failed", fetchStart, 0, failureCode));
    steps.push(step("evidence_ingestion_dedupe", "failed", fetchStart, 0, failureCode));
  }

  const projectionStart = Date.now();
  try {
    const projections = await sleeper.getWeeklyProjections(input.season, input.week);
    if (!projections.length || !crosswalk.sleeperIds.size) {
      steps.push(step("projection_ingestion", "skipped", projectionStart, 0,
        projections.length ? "projection_crosswalk_unavailable" : "projection_provider_unavailable"));
    } else {
      const result = await materializeSleeperProjections(adminClient, projections, crosswalk.sleeperIds);
      steps.push({
        ...step("projection_ingestion", result.projectionsMapped ? "success" : "skipped", projectionStart,
          result.snapshotsInserted, result.projectionsMapped ? undefined : "projection_identities_unmatched"),
        sourceWeek: input.week,
        unmappedRecords: result.projectionsUnmapped,
      });
    }
  } catch (error) {
    const code = error instanceof ScoutMaterializationError ? error.code : "projection_provider_error";
    failureCode ??= code;
    steps.push(step("projection_ingestion", "failed", projectionStart, 0, code));
  }

  const outlookStart = Date.now();
  const outlookWeeks = Array.from({ length: Math.max(0, Math.min(18, input.week + 2) - input.week) },
    (_, offset) => input.week + offset + 1);
  const outlookMaterializedWeeks: number[] = [];
  let outlookSnapshotsInserted = 0;
  if (outlookWeeks.length && crosswalk.sleeperIds.size) {
    const forecasts = await Promise.allSettled(outlookWeeks.map((week) => sleeper.getWeeklyProjections(input.season, week)));
    for (const [index, result] of forecasts.entries()) {
      if (result.status !== "fulfilled" || !result.value.length) continue;
      try {
        const written = await materializeSleeperProjections(adminClient, result.value, crosswalk.sleeperIds);
        if (!written.projectionsMapped) continue;
        outlookMaterializedWeeks.push(outlookWeeks[index]);
        outlookSnapshotsInserted += written.snapshotsInserted;
      } catch {
        // Future-week forecasts are optional. The waiver view reports only
        // weeks whose source records were actually stored and verified.
      }
    }
  }
  steps.push({
    ...step("outlook_projection_ingestion", outlookMaterializedWeeks.length ? "success" : "skipped",
      outlookStart, outlookSnapshotsInserted,
      outlookMaterializedWeeks.length === outlookWeeks.length ? undefined : "outlook_projection_incomplete"),
    sourceWeeks: outlookMaterializedWeeks,
  });

  const seasonProjectionStart = Date.now();
  try {
    const seasonProjections = await sleeper.getSeasonProjections(input.season);
    if (!seasonProjections.length || !crosswalk.sleeperIds.size) {
      steps.push(step("season_projection_ingestion", "skipped", seasonProjectionStart, 0,
        seasonProjections.length ? "projection_crosswalk_unavailable" : "season_projection_provider_unavailable"));
    } else {
      const result = await materializeSleeperProjections(adminClient, seasonProjections, crosswalk.sleeperIds, "season");
      steps.push({ ...step("season_projection_ingestion", result.projectionsMapped ? "success" : "skipped",
        seasonProjectionStart, result.snapshotsInserted,
        result.projectionsMapped ? undefined : "season_projection_identities_unmatched"),
        unmappedRecords: result.projectionsUnmapped });
    }
  } catch {
    // The observed season endpoint is optional. Draft uses only rows whose
    // source and exact player identity were actually persisted.
    steps.push(step("season_projection_ingestion", "skipped", seasonProjectionStart, 0,
      "season_projection_provider_unavailable"));
  }

  const scoringStart = Date.now();
  const syncStart = Date.now();
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
      steps.push(step("league_roster_freshness", "skipped", syncStart, 0, "current_yahoo_league_unavailable"));
      steps.push(step("feature_scoring", "skipped", scoringStart, 0, "current_yahoo_league_unavailable"));
      steps.push(step("recommendation_materialization", "skipped", scoringStart, 0, "current_yahoo_league_unavailable"));
    } else {
      const links = await adminClient.from("provider_league_links")
        .select("league_id, last_synced_at, connection_id").eq("provider", "yahoo")
        .in("league_id", currentYahooLeagueIds).limit(2001);
      if (links.error || (links.data || []).length > 2000) throw new YahooLineupError("yahoo_sync_lookup_failed");
      const connectionIds = [...new Set((links.data || []).map((row) => String(row.connection_id)))];
      const connections = connectionIds.length
        ? await adminClient.from("provider_connections").select("id, status").in("id", connectionIds)
        : { data: [], error: null };
      if (connections.error) throw new YahooLineupError("yahoo_connection_lookup_failed");
      const connectedIds = new Set((connections.data || []).filter((row) => row.status === "connected")
        .map((row) => String(row.id)));
      const freshLeagueIds = new Set((links.data || []).filter((row) => {
        const age = Date.now() - new Date(String(row.last_synced_at)).getTime();
        return connectedIds.has(String(row.connection_id))
          && Number.isFinite(age) && age >= -5 * 60_000 && age <= 6 * 60 * 60_000;
      }).map((row) => String(row.league_id)));
      steps.push(step("league_roster_freshness",
        freshLeagueIds.size === currentYahooLeagueIds.length ? "success" : "skipped",
        syncStart, freshLeagueIds.size,
        freshLeagueIds.size === currentYahooLeagueIds.length ? undefined : "yahoo_league_sync_stale"));
      let playersScored = 0;
      let completedLeagues = 0;
      let scoredLeagues = 0;
      const skippedReasons: string[] = [];
      for (const league of leagueRows.data) {
        const result = await materializeYahooLineupForLeague(adminClient, String(league.id));
        if (result.status === "skipped") {
          skippedReasons.push(result.reason || "league_context_unavailable");
          continue;
        }
        completedLeagues += 1;
        playersScored += result.playersScored;
        if (result.playersScored) scoredLeagues += 1;
        recommendationsMaterialized += result.recommendationsInserted;
      }
      const skippedReason = skippedReasons.length ? `skipped_leagues:${skippedReasons.length}` : undefined;
      const allScored = scoredLeagues === currentYahooLeagueIds.length;
      const allCompleted = completedLeagues === currentYahooLeagueIds.length;
      steps.push(step("feature_scoring", allScored ? "success" : "skipped", scoringStart, playersScored,
        allScored ? undefined : skippedReason || "current_projection_unavailable"));
      steps.push(step("recommendation_materialization", allCompleted ? "success" : "skipped", scoringStart,
        recommendationsMaterialized, allCompleted ? undefined : skippedReason || "league_context_unavailable"));
    }
  } catch (error) {
    const code = error instanceof YahooLineupError ? error.code : "lineup_materialization_failed";
    failureCode ??= code;
    if (!steps.some((entry) => entry.name === "league_roster_freshness")) {
      steps.push(step("league_roster_freshness", "failed", syncStart, 0, code));
    }
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
      let scoredLeagues = 0;
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
        if (result.candidatesScored) scoredLeagues += 1;
        waiversInserted += result.recommendationsInserted;
      }
      recommendationsMaterialized += waiversInserted;
      const allScored = scoredLeagues === currentYahooLeagueIds.length;
      const allCompleted = completedLeagues === currentYahooLeagueIds.length;
      steps.push(step("waiver_scoring", allScored ? "success" : "skipped", waiverStart,
        candidatesScored, allScored ? undefined : skippedReasons[0] || "waiver_projection_unavailable"));
      steps.push(step("waiver_materialization", allCompleted ? "success" : "skipped", waiverStart,
        waiversInserted, allCompleted ? undefined : skippedReasons[0] || "waiver_context_unavailable"));
    } catch (error) {
      const code = error instanceof YahooWaiverError ? error.code : "waiver_materialization_failed";
      failureCode ??= code;
      steps.push(step("waiver_scoring", "failed", waiverStart, 0, code));
      steps.push(step("waiver_materialization", "failed", waiverStart, 0, code));
    }
  }
  const outcomeStart = Date.now();
  if (!currentYahooLeagueIds.length) {
    steps.push(step("outcome_reconciliation", "skipped", outcomeStart, 0, "current_yahoo_league_unavailable"));
  } else {
    try {
      let recorded = 0;
      let unavailable = 0;
      for (const leagueId of currentYahooLeagueIds) {
        const result = await reconcileYahooOutcomesForLeague(adminClient, leagueId);
        recorded += result.recorded;
        unavailable += result.unavailable;
      }
      steps.push(step("outcome_reconciliation", unavailable ? "skipped" : "success", outcomeStart,
        recorded, unavailable ? `verified_actual_stats_unavailable:${unavailable}` : undefined));
    } catch (error) {
      const code = error instanceof YahooOutcomeError ? error.code : "outcome_reconciliation_failed";
      failureCode ??= code;
      steps.push(step("outcome_reconciliation", "failed", outcomeStart, 0, code));
    }
  }
  const diffStart = Date.now();
  try {
    const baseline = await adminClient.from("scout_runs").select("finished_at")
      .eq("status", "completed").lt("started_at", startedAt.toISOString())
      .order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (baseline.error) throw new Error("snapshot_baseline_lookup_failed");
    if (!baseline.data?.finished_at) {
      steps.push(step("snapshot_diff", "skipped", diffStart, 0, "scout_baseline_missing"));
    } else {
      const changes = await adminClient.from("player_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("season", input.season).eq("week", input.week)
        .in("source", ["nflverse_stats_player", "sleeper_weekly_projections"])
        .gt("observed_at", String(baseline.data.finished_at))
        .lte("observed_at", new Date().toISOString());
      if (changes.error) throw new Error("snapshot_diff_failed");
      steps.push(step("snapshot_diff", "success", diffStart, changes.count || 0));
    }
  } catch (error) {
    const code = error instanceof Error && error.message.startsWith("snapshot_") ? error.message : "snapshot_diff_failed";
    failureCode ??= code;
    steps.push(step("snapshot_diff", "failed", diffStart, 0, code));
  }
  let dailyBriefsWritten = 0;
  if (!currentYahooLeagueIds.length) {
    steps.push(step("recommendation_diff", "skipped", diffStart, 0, "current_yahoo_league_unavailable"));
    steps.push(step("daily_brief_materialization", "skipped", diffStart, 0, "current_yahoo_league_unavailable"));
  } else {
    try {
      let changesFound = 0;
      let baselinesFound = 0;
      let completedLeagues = 0;
      const briefAsOf = new Date();
      for (const leagueId of currentYahooLeagueIds) {
        const result = await materializeDailyBriefForLeague(adminClient, leagueId, briefAsOf);
        dailyBriefsWritten += result.briefsWritten;
        if (result.briefsWritten) completedLeagues += 1;
        changesFound += result.changesFound;
        baselinesFound += result.baselinesFound;
      }
      steps.push(step("recommendation_diff", baselinesFound ? "success" : "skipped", diffStart,
        changesFound, baselinesFound ? undefined : "brief_baseline_missing"));
      const allCompleted = completedLeagues === currentYahooLeagueIds.length;
      steps.push(step("daily_brief_materialization", allCompleted ? "success" : "skipped", diffStart,
        dailyBriefsWritten, allCompleted ? undefined : "league_membership_unavailable"));
    } catch (error) {
      const code = error instanceof DailyBriefError ? error.code : "daily_brief_failed";
      failureCode ??= code;
      steps.push(step("recommendation_diff", "failed", diffStart, 0, code));
      steps.push(step("daily_brief_materialization", "failed", diffStart, dailyBriefsWritten, code));
    }
  }

  const finishedAt = new Date();
  const completion = evaluateScoutCompletion(steps, failureCode);
  const finalStatus = completion.complete ? "completed" : "completed_with_errors";
  const runError = completion.error;
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
    ok: completion.complete,
    status: completion.complete ? "completed" : "degraded",
    scoutRunId: runId,
    trigger: "cron",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    steps,
    ...(runError ? { error: runError } : {}),
    summary: { season: input.season, week: input.week, statsWeek, playersProcessed, evidenceIngested, recommendationsMaterialized, dailyBriefsWritten },
  }, { status: completion.complete ? 200 : 503 });
}
