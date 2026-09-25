import type { SupabaseClient } from "@supabase/supabase-js";
import type { SleeperWeeklyProjection } from "@/lib/data/sleeper";
import { scoreYahooOffenseProjection } from "@/lib/engine/yahoo-projection";

const engineVersion = "war-v0.1-yahoo-waiver";
const blockedStatus = /\b(out|ir|doubtful|suspended|inactive)\b/i;
const offensivePositions = new Set(["QB", "RB", "WR", "TE"]);
const projectionAgeMs = 24 * 60 * 60_000;
const rosterAgeMs = 6 * 60 * 60_000;

export class YahooWaiverError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "YahooWaiverError"; }
}

export type YahooWaiverResult = {
  leagueId: string;
  status: "complete" | "skipped";
  candidatesScored: number;
  recommendationsInserted: number;
  reason?: string;
};

type ScoredPlayer = {
  id: string; name: string; position: string; points: number; evidenceId: string;
  observedAt: string; assumedZeroStatIds: string[];
};

function asProjection(row: { data: unknown; observed_at: string }, season: number, week: number): SleeperWeeklyProjection | null {
  if (!row.data || typeof row.data !== "object" || Array.isArray(row.data)) return null;
  const data = row.data as Record<string, unknown>;
  if (!data.projectedStats || typeof data.projectedStats !== "object" || Array.isArray(data.projectedStats)) return null;
  const stats = Object.fromEntries(Object.entries(data.projectedStats)
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value)));
  return { sleeperId: String(data.providerPlayerId || ""), season, week, ppr: null, halfPpr: null,
    standard: null, stats, observedAt: String(row.observed_at) };
}

/** Only suggest current-week same-position bench upgrades verified available by Yahoo. */
export async function materializeYahooWaiversForLeague(
  client: SupabaseClient, leagueId: string, asOf = new Date(),
): Promise<YahooWaiverResult> {
  const skipped = async (reason: string): Promise<YahooWaiverResult> => {
    const expired = await client.from("recommendations").update({ fresh_until: asOf.toISOString() })
      .eq("league_id", leagueId).eq("engine_version", engineVersion).gt("fresh_until", asOf.toISOString());
    if (expired.error) throw new YahooWaiverError("waiver_recommendations_expire_failed");
    return { leagueId, status: "skipped", candidatesScored: 0, recommendationsInserted: 0, reason };
  };
  const league = await client.from("leagues").select("id, provider, season, current_week, scoring")
    .eq("id", leagueId).single();
  if (league.error || !league.data) throw new YahooWaiverError("waiver_league_unavailable");
  if (league.data.provider !== "yahoo") return skipped("not_yahoo_league");
  const scoring = league.data.scoring as { statModifiers?: Record<string, unknown> } | null;
  if (!scoring?.statModifiers || typeof scoring.statModifiers !== "object") return skipped("scoring_rules_unavailable");
  const season = Number(league.data.season);
  const week = Number(league.data.current_week);
  const forecastWeeks = Array.from({ length: 1 + Math.max(0, Math.min(18, week + 2) - week) },
    (_, offset) => week + offset);
  const scan = await client.from("league_available_scans")
    .select("scan_id, observed_at, fresh_until, candidates_count, truncated, source_url")
    .eq("league_id", leagueId).maybeSingle();
  if (scan.error) throw new YahooWaiverError(scan.error.code === "42P01" ? "yahoo_availability_migration_required" : "waiver_scan_unavailable");
  if (!scan.data) return skipped("yahoo_availability_scan_missing");
  const scanObservedAt = new Date(String(scan.data.observed_at)).getTime();
  const scanFreshUntil = new Date(String(scan.data.fresh_until)).getTime();
  if (!Number.isFinite(scanObservedAt) || !Number.isFinite(scanFreshUntil)
    || scanObservedAt > asOf.getTime() + 5 * 60_000 || scanFreshUntil <= asOf.getTime()) {
    return skipped("yahoo_availability_scan_stale");
  }
  const available = await client.from("league_available_players")
    .select("player_id, provider_player_key, provider_status, observed_at, fresh_until")
    .eq("league_id", leagueId).eq("scan_id", String(scan.data.scan_id))
    .gt("fresh_until", asOf.toISOString()).limit(201);
  if (available.error) throw new YahooWaiverError("waiver_candidates_unavailable");
  if ((available.data || []).length !== Number(scan.data.candidates_count) || (available.data || []).length > 200) {
    throw new YahooWaiverError("waiver_candidate_scan_mismatch");
  }
  if (!available.data?.length) return skipped("yahoo_available_candidates_empty");

  const memberships = await client.from("league_memberships").select("user_id, roster_id")
    .eq("league_id", leagueId).not("roster_id", "is", null).limit(65);
  if (memberships.error) throw new YahooWaiverError("waiver_memberships_unavailable");
  if ((memberships.data || []).length > 64) throw new YahooWaiverError("waiver_memberships_too_large");
  const members = (memberships.data || []).filter((row) => row.roster_id);
  if (!members.length) return skipped("owned_roster_unavailable");
  const rosterIds = members.map((row) => String(row.roster_id));
  const [rosters, assignments, leagueAssignments] = await Promise.all([
    client.from("rosters").select("id, updated_at").eq("league_id", leagueId).in("id", rosterIds),
    client.from("roster_assignments").select("roster_id, player_id, designation")
      .eq("league_id", leagueId).in("roster_id", rosterIds).limit(1001),
    client.from("roster_assignments").select("player_id").eq("league_id", leagueId).limit(2001),
  ]);
  if (rosters.error || assignments.error || leagueAssignments.error) throw new YahooWaiverError("waiver_roster_unavailable");
  if ((assignments.data || []).length > 1000 || (leagueAssignments.data || []).length > 2000) {
    throw new YahooWaiverError("waiver_roster_limit_exceeded");
  }
  if ((rosters.data || []).length !== rosterIds.length) return skipped("owned_roster_unavailable");
  const rosterSyncedAt = new Map((rosters.data || []).map((row) => [String(row.id), new Date(String(row.updated_at)).getTime()]));
  if ([...rosterSyncedAt.values()].some((time) => !Number.isFinite(time)
    || time > asOf.getTime() + 5 * 60_000 || time + rosterAgeMs <= asOf.getTime())) {
    return skipped("yahoo_roster_sync_stale");
  }
  const rostered = new Set((leagueAssignments.data || []).map((row) => String(row.player_id)));
  const candidates = available.data.filter((row) => !rostered.has(String(row.player_id))
    && !blockedStatus.test(String(row.provider_status || "")));
  const ids = [...new Set([
    ...candidates.map((row) => String(row.player_id)),
    ...(assignments.data || []).filter((row) => row.designation === "bench").map((row) => String(row.player_id)),
  ])];
  if (!ids.length) return skipped("waiver_projection_candidates_missing");

  const playerRows = [];
  const snapshotRows = [];
  const evidenceRows = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const [players, snapshots, evidence] = await Promise.all([
      client.from("players").select("id, full_name, position, status").in("id", batch),
      client.from("player_snapshots").select("player_id, week, data, observed_at, fingerprint")
        .eq("season", season).in("week", forecastWeeks).eq("source", "sleeper_weekly_projections")
        .in("player_id", batch).order("observed_at", { ascending: false }).limit(3001),
      client.from("evidence").select("id, player_id, observed_at, fingerprint")
        .eq("source", "sleeper_weekly_projections")
        .in("source_url", forecastWeeks.map((forecastWeek) =>
          `https://api.sleeper.app/v1/projections/nfl/regular/${season}/${forecastWeek}`))
        .in("player_id", batch).order("observed_at", { ascending: false }).limit(3001),
    ]);
    if (players.error || snapshots.error || evidence.error) throw new YahooWaiverError("waiver_projection_source_unavailable");
    if ((snapshots.data || []).length > 3000 || (evidence.data || []).length > 3000) {
      throw new YahooWaiverError("waiver_projection_history_limit_exceeded");
    }
    playerRows.push(...(players.data || []));
    snapshotRows.push(...(snapshots.data || []));
    evidenceRows.push(...(evidence.data || []));
  }
  const playersById = new Map(playerRows.map((row) => [String(row.id), row]));
  const evidenceByFingerprint = new Map(evidenceRows.map((row) => [String(row.fingerprint), { id: String(row.id), playerId: String(row.player_id) }]));
  const scoredByWeek = new Map(forecastWeeks.map((forecastWeek) => [forecastWeek, new Map<string, ScoredPlayer>()]));
  for (const row of snapshotRows) {
    const id = String(row.player_id);
    const forecastWeek = Number(row.week);
    const weekScores = scoredByWeek.get(forecastWeek);
    if (!weekScores || weekScores.has(id)) continue;
    const projection = asProjection(row, season, forecastWeek);
    const player = playersById.get(id);
    const evidenceMatch = evidenceByFingerprint.get(`sleeper_projection_${String(row.fingerprint)}`);
    if (!projection || !player || evidenceMatch?.playerId !== id || !offensivePositions.has(String(player.position))) continue;
    const age = asOf.getTime() - new Date(projection.observedAt).getTime();
    if (!Number.isFinite(age) || age < -5 * 60_000 || age > projectionAgeMs) continue;
    const points = scoreYahooOffenseProjection(projection, scoring.statModifiers);
    if (!points.ok) {
      if (forecastWeek === week && points.code === "unsupported_scoring_rules") {
        return skipped(`unsupported_scoring_rules:${points.ids.join(",")}`);
      }
      continue;
    }
    weekScores.set(id, { id, name: String(player.full_name), position: String(player.position), points: points.points,
      evidenceId: evidenceMatch.id, observedAt: projection.observedAt, assumedZeroStatIds: points.assumedZeroStatIds });
  }
  const scored = scoredByWeek.get(week)!;
  const recommendations = [];
  for (const member of members) {
    const rosterId = String(member.roster_id);
    const usedAvailable = new Set<string>();
    const bench = (assignments.data || []).filter((row) => String(row.roster_id) === rosterId && row.designation === "bench")
      .map((row) => scored.get(String(row.player_id))).filter((row): row is ScoredPlayer => Boolean(row));
    const pairs = candidates.flatMap((row) => {
      const candidate = scored.get(String(row.player_id));
      if (!candidate) return [];
      return bench.filter((drop) => drop.position === candidate.position)
        .map((drop) => ({ candidate, drop, edge: candidate.points - drop.points }));
    }).filter((pair) => pair.edge >= 3).sort((a, b) => b.edge - a.edge);
    const usedDrop = new Set<string>();
    let rosterRecommendations = 0;
    for (const pair of pairs) {
      if (rosterRecommendations >= 3) break;
      if (usedAvailable.has(pair.candidate.id) || usedDrop.has(pair.drop.id)) continue;
      usedAvailable.add(pair.candidate.id);
      usedDrop.add(pair.drop.id);
      rosterRecommendations += 1;
      const edge = Math.round(pair.edge * 100) / 100;
      const assumptions = [...new Set([...pair.candidate.assumedZeroStatIds, ...pair.drop.assumedZeroStatIds])];
      const forecastOutlook = forecastWeeks.flatMap((forecastWeek) => {
        const forecastCandidate = scoredByWeek.get(forecastWeek)?.get(pair.candidate.id);
        const forecastDrop = scoredByWeek.get(forecastWeek)?.get(pair.drop.id);
        if (!forecastCandidate || !forecastDrop) return [];
        return [{ week: forecastWeek, addPoints: forecastCandidate.points, dropPoints: forecastDrop.points,
          edge: Math.round((forecastCandidate.points - forecastDrop.points) * 100) / 100,
          observedAt: new Date(Math.min(Date.parse(forecastCandidate.observedAt), Date.parse(forecastDrop.observedAt))).toISOString(),
          assumedZeroYahooStatIds: [...new Set([...forecastCandidate.assumedZeroStatIds, ...forecastDrop.assumedZeroStatIds])],
          sourceUrl: `https://api.sleeper.app/v1/projections/nfl/regular/${season}/${forecastWeek}` }];
      });
      recommendations.push({
        league_id: leagueId, roster_id: rosterId, user_id: String(member.user_id), kind: "add",
        subject_player_id: pair.candidate.id, alternative_player_id: pair.drop.id,
        score: Math.min(100, Math.round(50 + edge * 5)),
        confidence: Math.max(35, 60 - assumptions.length * 5),
        headline: `Consider adding ${pair.candidate.name} and dropping ${pair.drop.name} (Week ${week} forecast edge ${edge} points)`,
        reason_codes: ["YAHOO_LEAGUE_AVAILABLE", "SAME_POSITION_BENCH_UPGRADE", "CURRENT_WEEK_FORECAST_ONLY",
          ...(assumptions.length ? ["MISSING_STAT_PROJECTION_ASSUMED_ZERO"] : [])],
        evidence_ids: [pair.candidate.evidenceId, pair.drop.evidenceId], engine_version: engineVersion,
        computed_at: asOf.toISOString(),
        fresh_until: new Date(Math.min(scanFreshUntil, rosterSyncedAt.get(rosterId)! + rosterAgeMs,
          new Date(pair.candidate.observedAt).getTime() + projectionAgeMs,
          new Date(pair.drop.observedAt).getTime() + projectionAgeMs)).toISOString(),
        payload: {
          projectionSource: "sleeper_weekly_projections", scoringSource: "yahoo_stat_modifiers",
          availabilitySourceUrl: String(scan.data.source_url), availabilityObservedAt: String(scan.data.observed_at),
          availabilityTruncated: Boolean(scan.data.truncated), targetSeason: season, targetWeek: week,
          projectedPoints: { recommended: pair.candidate.points, current: pair.drop.points },
          confidenceMeaning: "heuristic_source_coverage_not_outcome_probability",
          assumedZeroYahooStatIds: assumptions,
          forecastOutlook,
          forecastOutlookWeeksRequested: forecastWeeks,
          scope: "current_week_bench_upgrade_with_source_backed_outlook_no_faab_or_ros_claim",
        },
      });
    }
  }
  let inserted = 0;
  if (recommendations.length) {
    const written = await client.from("recommendations").insert(recommendations).select("id");
    if (written.error) throw new YahooWaiverError("waiver_recommendations_write_failed");
    inserted = written.data?.length || 0;
  }
  const old = await client.from("recommendations").delete().eq("league_id", leagueId)
    .eq("engine_version", engineVersion).lt("computed_at", asOf.toISOString());
  if (old.error) throw new YahooWaiverError("waiver_recommendations_cleanup_failed");
  return { leagueId, status: "complete", candidatesScored: candidates.filter((row) => scored.has(String(row.player_id))).length,
    recommendationsInserted: inserted };
}
