import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/security/http";
import { nflverse } from "@/lib/data/nflverse";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  season: z.coerce.number().int().min(2020).max(2100).default(2026),
  week: z.coerce.number().int().min(0).max(23).default(1),
});

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
}

function step(name: string, status: StepDetail["status"], startedAt: number, recordsProcessed: number, error?: string): StepDetail {
  return { name, status, durationMs: Date.now() - startedAt, recordsProcessed, ...(error ? { error } : {}) };
}

async function parseInput(request: Request): Promise<z.infer<typeof inputSchema>> {
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
  return inputSchema.parse(values);
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

  let input: z.infer<typeof inputSchema>;
  try {
    input = await parseInput(request);
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse("invalid_json", 400);
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

  // These steps previously reported fixture work as successful. Until a real
  // league sync/materializer is configured, report the bounded gap explicitly.
  let markFailed = false;
  const syncStart = Date.now();
  steps.push(step("league_roster_sync", "skipped", syncStart, 0, "league_sync_not_configured"));

  const normalizeStart = Date.now();
  steps.push(step("player_normalization", "skipped", normalizeStart, 0, "player_materializer_not_configured"));

  const snapshotStart = Date.now();
  try {
    const snapshots = await nflverse.getPlayerSnapshots(input);
    if (snapshots.length === 0) {
      steps.push(step("stats_snapshot_ingestion", "skipped", snapshotStart, 0, "provider_unavailable"));
    } else {
      // Fetching is not ingestion. Preserve the observed row count while being
      // explicit that no canonical snapshot write occurred.
      steps.push(step("stats_snapshot_ingestion", "skipped", snapshotStart, snapshots.length, "snapshot_persistence_not_configured"));
    }
  } catch {
    markFailed = true;
    steps.push(step("stats_snapshot_ingestion", "failed", snapshotStart, 0, "provider_error"));
  }

  const evidenceStart = Date.now();
  try {
    const evidence = await nflverse.getEvidence(input);
    if (evidence.length === 0) {
      steps.push(step("evidence_ingestion_dedupe", "skipped", evidenceStart, 0, "provider_unavailable"));
    } else {
      // The current schema requires canonical UUID player IDs before evidence
      // can be persisted. Do not write provider IDs into FK columns.
      steps.push(step("evidence_ingestion_dedupe", "skipped", evidenceStart, evidence.length, "canonical_player_mapping_required"));
    }
  } catch {
    markFailed = true;
    steps.push(step("evidence_ingestion_dedupe", "failed", evidenceStart, 0, "provider_error"));
  }

  const scoringStart = Date.now();
  steps.push(step("feature_scoring", "skipped", scoringStart, 0, "league_context_required"));
  const diffStart = Date.now();
  steps.push(step("snapshot_diff", "skipped", diffStart, 0, "snapshot_persistence_required"));
  const materializeStart = Date.now();
  steps.push(step("recommendation_materialization", "skipped", materializeStart, 0, "recommendation_materializer_not_configured"));

  const finishedAt = new Date();
  const hasFailures = markFailed || steps.some((entry) => entry.status === "failed");
  const finalStatus = "completed_with_errors" as const;
  try {
    const finalUpdate = await adminClient
      .from("scout_runs")
      .update({ status: finalStatus, finished_at: finishedAt.toISOString(), steps, error: hasFailures ? "provider_error" : "pipeline_incomplete" })
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
    error: hasFailures ? "provider_error" : "pipeline_incomplete",
    summary: { season: input.season, week: input.week, playersProcessed: 0, evidenceIngested: 0, recommendationsMaterialized: 0 },
  }, { status: 503 });
}
