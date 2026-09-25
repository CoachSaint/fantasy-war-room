import type { SupabaseClient } from "@supabase/supabase-js";
import type { SleeperWeeklyProjection } from "@/lib/data/sleeper";
import { scoreYahooOffenseProjection } from "@/lib/engine/yahoo-projection";
import { ensureNflGameStarts } from "@/lib/services/nfl-game-starts";

const engineVersion = "war-v0.1-yahoo-lineup";
const blockedStatus = /\b(out|ir|doubtful|suspended|inactive)\b/i;
const validPositions = new Set(["QB", "RB", "WR", "TE"]);

export class YahooLineupError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "YahooLineupError"; }
}

export type YahooLineupResult = {
  leagueId: string;
  status: "complete" | "skipped";
  playersScored: number;
  recommendationsInserted: number;
  reason?: string;
};

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function projectionFromRow(row: { player_id: string; data: unknown; observed_at: string }, season: number, week: number): SleeperWeeklyProjection | null {
  if (!row.data || typeof row.data !== "object" || Array.isArray(row.data)) return null;
  const data = row.data as Record<string, unknown>;
  if (!data.projectedStats || typeof data.projectedStats !== "object" || Array.isArray(data.projectedStats)) return null;
  const stats = Object.fromEntries(Object.entries(data.projectedStats)
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value)));
  return {
    sleeperId: String(data.providerPlayerId || ""), season, week,
    ppr: numeric(data.projectedFantasyPointsPpr),
    halfPpr: numeric(data.projectedFantasyPointsHalfPpr),
    standard: numeric(data.projectedFantasyPointsStandard),
    stats,
    observedAt: String(row.observed_at),
  };
}

/** Materialize only evidence-backed same-position swaps for the owned roster. */
export async function materializeYahooLineupForLeague(
  client: SupabaseClient,
  leagueId: string,
  asOf = new Date(),
): Promise<YahooLineupResult> {
  const league = await client.from("leagues")
    .select("id, provider, season, current_week, scoring")
    .eq("id", leagueId).single();
  if (league.error || !league.data) throw new YahooLineupError("league_context_unavailable");
  const skipped = async (reason: string): Promise<YahooLineupResult> => {
    const expired = await client.from("recommendations")
      .update({ fresh_until: asOf.toISOString() })
      .eq("league_id", leagueId).eq("engine_version", engineVersion)
      .gt("fresh_until", asOf.toISOString());
    if (expired.error) throw new YahooLineupError("lineup_recommendations_expire_failed");
    return { leagueId, status: "skipped", playersScored: 0, recommendationsInserted: 0, reason };
  };
  if (league.data.provider !== "yahoo") return skipped("not_yahoo_league");
  const scoring = league.data.scoring as { statModifiers?: Record<string, unknown> } | null;
  if (!scoring?.statModifiers || typeof scoring.statModifiers !== "object") {
    return skipped("scoring_rules_unavailable");
  }
  const season = Number(league.data.season);
  const week = Number(league.data.current_week);
  await ensureNflGameStarts(client, season, week);
  const membership = await client.from("league_memberships")
    .select("user_id, roster_id")
    .eq("league_id", leagueId).not("roster_id", "is", null).limit(65);
  if (membership.error) throw new YahooLineupError("league_memberships_unavailable");
  if ((membership.data || []).length > 64) throw new YahooLineupError("league_memberships_too_large");
  const members = (membership.data || []).filter((row) => row.roster_id);
  if (!members.length) return skipped("owned_roster_unavailable");
  const rosterIds = members.map((row) => String(row.roster_id));
  const rosterState = await client.from("rosters").select("id, updated_at")
    .eq("league_id", leagueId).in("id", rosterIds);
  if (rosterState.error) throw new YahooLineupError("owned_roster_state_unavailable");
  if ((rosterState.data || []).length !== rosterIds.length) return skipped("owned_roster_state_unavailable");
  if ((rosterState.data || []).some((row) => {
    const age = asOf.getTime() - new Date(String(row.updated_at)).getTime();
    return !Number.isFinite(age) || age < -5 * 60_000 || age > 6 * 60 * 60_000;
  })) return skipped("yahoo_roster_sync_stale");
  const rosterSyncedAt = new Map((rosterState.data || []).map((row) => [String(row.id), new Date(String(row.updated_at)).getTime()]));
  const matchupRows = await client.from("league_week_matchups")
    .select("team_a_roster_id, team_b_roster_id, team_a_projected_points, team_b_projected_points, status, observed_at")
    .eq("league_id", leagueId).eq("week", week).limit(33);
  if (matchupRows.error) throw new YahooLineupError("league_matchup_unavailable");
  if ((matchupRows.data || []).length > 32) throw new YahooLineupError("league_matchup_too_large");
  const matchupByRoster = new Map<string, { week: number; ownProjectedPoints: number;
    opponentProjectedPoints: number; status: string; observedAt: string }>();
  for (const row of matchupRows.data || []) {
    const own = Number(row.team_a_projected_points);
    const opponent = Number(row.team_b_projected_points);
    const observedAt = String(row.observed_at);
    const age = asOf.getTime() - new Date(observedAt).getTime();
    if (row.team_a_projected_points == null || row.team_b_projected_points == null ||
        !Number.isFinite(own) || !Number.isFinite(opponent) || own < 0 || opponent < 0 ||
        !Number.isFinite(age) || age < -5 * 60_000 || age > 6 * 60 * 60_000) continue;
    matchupByRoster.set(String(row.team_a_roster_id), { week, ownProjectedPoints: own,
      opponentProjectedPoints: opponent, status: String(row.status), observedAt });
    matchupByRoster.set(String(row.team_b_roster_id), { week, ownProjectedPoints: opponent,
      opponentProjectedPoints: own, status: String(row.status), observedAt });
  }
  const assignments = await client.from("roster_assignments")
    .select("roster_id, player_id, designation, provider_status")
    .eq("league_id", leagueId).in("roster_id", rosterIds).limit(1001);
  if (assignments.error) throw new YahooLineupError("roster_assignments_unavailable");
  if ((assignments.data || []).length > 1000) throw new YahooLineupError("roster_assignments_too_large");
  const ids = [...new Set((assignments.data || []).map((row) => String(row.player_id)))];
  if (!ids.length) return skipped("roster_empty");

  const players = [];
  const snapshots = [];
  const evidence = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const [playerRows, snapshotRows, evidenceRows] = await Promise.all([
      client.from("players").select("id, full_name, position, status").in("id", batch),
      client.from("player_snapshots").select("player_id, data, observed_at, fingerprint")
        .eq("season", season).eq("week", week).eq("source", "sleeper_weekly_projections")
        .in("player_id", batch).order("observed_at", { ascending: false }).limit(1000),
      client.from("evidence").select("id, player_id, observed_at, fingerprint")
        .eq("source", "sleeper_weekly_projections")
        .eq("source_url", `https://api.sleeper.app/v1/projections/nfl/regular/${season}/${week}`)
        .in("player_id", batch).order("observed_at", { ascending: false }).limit(1000),
    ]);
    if (playerRows.error || snapshotRows.error || evidenceRows.error) throw new YahooLineupError("lineup_source_unavailable");
    players.push(...(playerRows.data || []));
    snapshots.push(...(snapshotRows.data || []));
    evidence.push(...(evidenceRows.data || []));
  }
  const playerById = new Map(players.map((row) => [String(row.id), row]));
  const evidenceByFingerprint = new Map(evidence.map((row) => [String(row.fingerprint), { id: String(row.id), playerId: String(row.player_id) }]));
  const projectionById = new Map<string, { projection: SleeperWeeklyProjection; evidenceId: string }>();
  for (const row of snapshots) {
    const id = String(row.player_id);
    if (projectionById.has(id)) continue;
    const projection = projectionFromRow(row, season, week);
    const evidenceMatch = evidenceByFingerprint.get(`sleeper_projection_${String(row.fingerprint)}`);
    if (projection && evidenceMatch?.playerId === id) projectionById.set(id, { projection, evidenceId: evidenceMatch.id });
  }
  const maxAgeMs = 24 * 60 * 60 * 1000;
  const scored = new Map<string, { points: number; assumedZeroStatIds: string[]; observedAt: string; evidenceId: string }>();
  for (const [id, pair] of projectionById) {
    const { projection, evidenceId } = pair;
    const age = asOf.getTime() - new Date(projection.observedAt).getTime();
    if (!Number.isFinite(age) || age < -5 * 60_000 || age > maxAgeMs) continue;
    const score = scoreYahooOffenseProjection(projection, scoring.statModifiers);
    if (!score.ok) {
      if (score.code === "unsupported_scoring_rules") {
        return skipped(`unsupported_scoring_rules:${score.ids.join(",")}`);
      }
      continue;
    }
    scored.set(id, { points: score.points, assumedZeroStatIds: score.assumedZeroStatIds, observedAt: projection.observedAt, evidenceId });
  }
  const candidateRows = [];
  for (const member of members) {
    const rosterId = String(member.roster_id);
    const rosterFreshUntil = rosterSyncedAt.get(rosterId)! + 6 * 60 * 60_000;
    const teamMatchup = matchupByRoster.get(rosterId);
    const rosterAssignments = (assignments.data || []).filter((row) => String(row.roster_id) === rosterId);
    const starters = rosterAssignments.filter((row) => row.designation === "starter");
    const bench = rosterAssignments.filter((row) => row.designation === "bench");
    const usedBench = new Set<string>();
    for (const starter of starters) {
      const starterId = String(starter.player_id);
      const current = playerById.get(starterId);
      const currentScore = scored.get(starterId);
      if (!current || !currentScore || !validPositions.has(String(current.position))) continue;
      const alternatives = bench.flatMap((row) => {
        const id = String(row.player_id);
        const player = playerById.get(id);
        const score = scored.get(id);
        if (!player || !score || player.position !== current.position || usedBench.has(id)
          || blockedStatus.test(String(row.provider_status || player.status || ""))) return [];
        return [{ id, player, score, edge: score.points - currentScore.points }];
      }).filter((item) => item.edge >= 2).sort((a, b) => b.edge - a.edge);
      const best = alternatives[0];
      if (!best) continue;
      usedBench.add(best.id);
      const edge = Math.round(best.edge * 100) / 100;
      const assumed = [...new Set([...currentScore.assumedZeroStatIds, ...best.score.assumedZeroStatIds])];
      candidateRows.push({
        league_id: leagueId, roster_id: rosterId, user_id: String(member.user_id),
        kind: "start", subject_player_id: best.id, alternative_player_id: starterId,
        score: Math.min(100, Math.round(50 + edge * 5)),
        confidence: Math.max(35, 65 - assumed.length * 5),
        headline: `Start ${best.player.full_name} over ${current.full_name} (forecast edge ${edge} points)`,
        reason_codes: ["SAME_POSITION_SWAP", "LEAGUE_SCORING_PROJECTION", ...(assumed.length ? ["MISSING_STAT_PROJECTION_ASSUMED_ZERO"] : [])],
        evidence_ids: [best.score.evidenceId, currentScore.evidenceId],
        engine_version: engineVersion,
        computed_at: asOf.toISOString(),
        fresh_until: new Date(Math.min(
          rosterFreshUntil,
          new Date(currentScore.observedAt).getTime() + maxAgeMs,
          new Date(best.score.observedAt).getTime() + maxAgeMs,
        )).toISOString(),
        payload: {
          projectionSource: "sleeper_weekly_projections",
          scoringSource: "yahoo_stat_modifiers",
          targetSeason: season, targetWeek: week,
          projectedPoints: { recommended: best.score.points, current: currentScore.points },
          ...(teamMatchup ? { teamMatchup } : {}),
          confidenceMeaning: "heuristic_source_coverage_not_outcome_probability",
          assumedZeroYahooStatIds: assumed,
          scorer: "same_position_projection_edge_v1",
        },
      });
    }
  }
  let inserted = 0;
  if (candidateRows.length) {
    const result = await client.from("recommendations").insert(candidateRows).select("id");
    if (result.error) throw new YahooLineupError("lineup_recommendations_write_failed");
    inserted = result.data?.length || 0;
  }
  const old = await client.from("recommendations").update({ fresh_until: asOf.toISOString() })
    .eq("league_id", leagueId).eq("engine_version", engineVersion)
    .lt("computed_at", asOf.toISOString()).gt("fresh_until", asOf.toISOString());
  if (old.error) throw new YahooLineupError("lineup_recommendations_cleanup_failed");
  return { leagueId, status: "complete", playersScored: scored.size, recommendationsInserted: inserted };
}
