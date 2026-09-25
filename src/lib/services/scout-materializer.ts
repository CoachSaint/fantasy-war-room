import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NflverseSnapshot } from "@/lib/data/nflverse";
import type { SleeperWeeklyProjection } from "@/lib/data/sleeper";
import type { Evidence, Position } from "@/lib/types";

const positions = new Set<Position>(["QB", "RB", "WR", "TE", "K", "DST"]);
const chunkSize = 100;

export class ScoutMaterializationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ScoutMaterializationError";
  }
}

export type GlobalMaterializationResult = {
  playersMapped: number;
  snapshotsInserted: number;
  evidenceInserted: number;
  evidenceUnmapped: number;
};

export type ProjectionMaterializationResult = {
  projectionsMapped: number;
  snapshotsInserted: number;
  evidenceInserted: number;
  projectionsUnmapped: number;
};

function chunks<T>(items: T[]): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += chunkSize) result.push(items.slice(offset, offset + chunkSize));
  return result;
}

function fingerprint(snapshot: NflverseSnapshot): string {
  const sourceFields = {
    playerId: snapshot.playerId,
    season: snapshot.season,
    week: snapshot.week,
    actualPoints: snapshot.actualPoints,
    projectedPoints: snapshot.projectedPoints,
    snapShare: snapshot.snapShare,
    targetShare: snapshot.targetShare,
    rushShare: snapshot.rushShare,
    redZoneShare: snapshot.redZoneShare,
  };
  return createHash("sha256").update(JSON.stringify(sourceFields)).digest("hex");
}

/** Persist only source-observed values; no historical actual becomes a forecast. */
export async function materializeGlobalNflverse(
  client: SupabaseClient,
  snapshots: NflverseSnapshot[],
  evidence: Evidence[],
): Promise<GlobalMaterializationResult> {
  const eligible = [...new Map(snapshots.filter((snapshot) =>
    snapshot.playerId && !snapshot.playerId.startsWith("nflv_player_") &&
    snapshot.fullName?.trim() && positions.has(snapshot.position as Position)
  ).map((snapshot) => [snapshot.playerId, snapshot])).values()];
  if (!eligible.length) throw new ScoutMaterializationError("no_canonical_player_ids");
  const providerIds = eligible.map((snapshot) => snapshot.playerId);
  const mapped = new Map<string, string>();

  for (const batch of chunks(providerIds)) {
    const result = await client.from("player_id_map")
      .select("provider_player_id, player_id")
      .eq("provider", "nflverse")
      .in("provider_player_id", batch);
    if (result.error) throw new ScoutMaterializationError("player_mapping_read_failed");
    for (const row of result.data || []) mapped.set(String(row.provider_player_id), String(row.player_id));
  }

  const missing = eligible.filter((snapshot) => !mapped.has(snapshot.playerId));
  for (const batch of chunks(missing)) {
    const players = await client.from("players")
      .upsert(batch.map((snapshot) => ({
        canonical_key: `nflverse:${snapshot.playerId}`,
        full_name: snapshot.fullName!.trim(),
        team: snapshot.team || null,
        position: snapshot.position,
        identity_status: "provider_only",
      })), { onConflict: "canonical_key" })
      .select("id, canonical_key");
    if (players.error) throw new ScoutMaterializationError("player_create_failed");
    const idsByKey = new Map((players.data || []).map((row) => [String(row.canonical_key), String(row.id)]));
    const rows = batch.map((snapshot) => ({
      provider: "nflverse",
      provider_player_id: snapshot.playerId,
      player_id: idsByKey.get(`nflverse:${snapshot.playerId}`),
    }));
    if (rows.some((row) => !row.player_id)) throw new ScoutMaterializationError("player_create_failed");
    const mappings = await client.from("player_id_map")
      .upsert(rows, { onConflict: "provider,provider_player_id", ignoreDuplicates: true });
    if (mappings.error) throw new ScoutMaterializationError("player_mapping_write_failed");
  }

  for (const batch of chunks(providerIds)) {
    const result = await client.from("player_id_map")
      .select("provider_player_id, player_id")
      .eq("provider", "nflverse")
      .in("provider_player_id", batch);
    if (result.error) throw new ScoutMaterializationError("player_mapping_read_failed");
    for (const row of result.data || []) mapped.set(String(row.provider_player_id), String(row.player_id));
  }
  if (mapped.size !== providerIds.length) throw new ScoutMaterializationError("player_mapping_incomplete");

  let snapshotsInserted = 0;
  for (const batch of chunks(eligible)) {
    const rows = batch.map((snapshot) => ({
      player_id: mapped.get(snapshot.playerId),
      season: snapshot.season,
      week: snapshot.week,
      data: {
        providerPlayerId: snapshot.playerId,
        actualFantasyPoints: snapshot.actualPoints,
        projectedFantasyPoints: snapshot.projectedPoints,
        floor: snapshot.floor,
        ceiling: snapshot.ceiling,
        snapShare: snapshot.snapShare,
        targetShare: snapshot.targetShare,
        rushShare: snapshot.rushShare,
        redZoneShare: snapshot.redZoneShare,
      },
      observed_at: snapshot.observedAt,
      source: "nflverse_stats_player",
      fingerprint: fingerprint(snapshot),
    }));
    const result = await client.from("player_snapshots")
      .upsert(rows, { onConflict: "source,fingerprint", ignoreDuplicates: true })
      .select("id");
    if (result.error) throw new ScoutMaterializationError("snapshot_write_failed");
    snapshotsInserted += result.data?.length || 0;
  }

  const resolvedEvidence = evidence.filter((item) => mapped.has(item.playerId));
  let evidenceInserted = 0;
  for (const batch of chunks(resolvedEvidence)) {
    const rows = batch.map((item) => ({
      player_id: mapped.get(item.playerId),
      type: item.type,
      source: item.source,
      source_url: item.sourceUrl || null,
      summary: item.summary,
      confidence: Math.min(100, Math.max(0, Math.round(item.confidence * 100))),
      published_at: item.publishedAt || null,
      observed_at: item.observedAt,
      fingerprint: item.fingerprint,
    }));
    const result = await client.from("evidence")
      .upsert(rows, { onConflict: "fingerprint", ignoreDuplicates: true })
      .select("id");
    if (result.error) throw new ScoutMaterializationError("evidence_write_failed");
    evidenceInserted += result.data?.length || 0;
  }

  return {
    playersMapped: mapped.size,
    snapshotsInserted,
    evidenceInserted,
    evidenceUnmapped: evidence.length - resolvedEvidence.length,
  };
}

/** Store observed provider forecasts only where a GSIS identity is exact. */
export async function materializeSleeperProjections(
  client: SupabaseClient,
  projections: SleeperWeeklyProjection[],
  sleeperToGsis: Map<string, string>,
): Promise<ProjectionMaterializationResult> {
  const gsisIds = [...new Set(projections.map((item) => sleeperToGsis.get(item.sleeperId)).filter((id): id is string => Boolean(id)))];
  const canonicalByGsis = new Map<string, string>();
  for (const batch of chunks(gsisIds)) {
    const result = await client.from("player_id_map")
      .select("provider_player_id, player_id")
      .eq("provider", "nflverse")
      .in("provider_player_id", batch);
    if (result.error) throw new ScoutMaterializationError("projection_mapping_read_failed");
    for (const row of result.data || []) canonicalByGsis.set(String(row.provider_player_id), String(row.player_id));
  }
  const matched = projections.flatMap((item) => {
    const gsisId = sleeperToGsis.get(item.sleeperId);
    const playerId = gsisId ? canonicalByGsis.get(gsisId) : undefined;
    return playerId ? [{ item, playerId }] : [];
  });
  let snapshotsInserted = 0;
  let evidenceInserted = 0;
  for (const batch of chunks(matched)) {
    const rows = batch.map(({ item, playerId }) => {
      const fingerprint = createHash("sha256").update(JSON.stringify({
        sleeperId: item.sleeperId, season: item.season, week: item.week,
        ppr: item.ppr, halfPpr: item.halfPpr, standard: item.standard,
      })).digest("hex");
      return { item, playerId, fingerprint };
    });
    const snapshots = await client.from("player_snapshots").upsert(rows.map(({ item, playerId, fingerprint }) => ({
      player_id: playerId,
      season: item.season,
      week: item.week,
      data: {
        providerPlayerId: item.sleeperId,
        projectedFantasyPointsPpr: item.ppr,
        projectedFantasyPointsHalfPpr: item.halfPpr,
        projectedFantasyPointsStandard: item.standard,
        projectionAccuracyVerified: false,
      },
      observed_at: item.observedAt,
      source: "sleeper_weekly_projections",
      fingerprint,
    })), { onConflict: "source,fingerprint", ignoreDuplicates: true }).select("id");
    if (snapshots.error) throw new ScoutMaterializationError("projection_snapshot_write_failed");
    snapshotsInserted += snapshots.data?.length || 0;

    const evidence = await client.from("evidence").upsert(rows.map(({ item, playerId, fingerprint }) => ({
      player_id: playerId,
      type: "projection",
      source: "sleeper_weekly_projections",
      source_url: `https://api.sleeper.app/v1/projections/nfl/regular/${item.season}/${item.week}`,
      summary: `Sleeper Week ${item.week} forecast: standard ${item.standard ?? "unavailable"}, half PPR ${item.halfPpr ?? "unavailable"}, PPR ${item.ppr ?? "unavailable"} points. Forecast accuracy has not been verified.`,
      confidence: 100,
      published_at: null,
      observed_at: item.observedAt,
      fingerprint: `sleeper_projection_${fingerprint}`,
      metadata: { confidenceMeaning: "exact_source_transcription", projectionAccuracyVerified: false },
    })), { onConflict: "fingerprint", ignoreDuplicates: true }).select("id");
    if (evidence.error) throw new ScoutMaterializationError("projection_evidence_write_failed");
    evidenceInserted += evidence.data?.length || 0;
  }
  return {
    projectionsMapped: matched.length,
    snapshotsInserted,
    evidenceInserted,
    projectionsUnmapped: projections.length - matched.length,
  };
}
