import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/security/http";
import { nflverse } from "@/lib/data/nflverse";
import { sleeper } from "@/lib/data/sleeper";
import { materializeGlobalNflverse, ScoutMaterializationError } from "@/lib/services/scout-materializer";

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

  const scoringStart = Date.now();
  steps.push(step("feature_scoring", "skipped", scoringStart, 0, "league_context_required"));
  const diffStart = Date.now();
  steps.push(step("snapshot_diff", "skipped", diffStart, 0, "league_baseline_required"));
  const materializeStart = Date.now();
  steps.push(step("recommendation_materialization", "skipped", materializeStart, 0, "recommendation_materializer_not_configured"));

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
    summary: { season: input.season, week: input.week, statsWeek, playersProcessed, evidenceIngested, recommendationsMaterialized: 0 },
  }, { status: 503 });
}
