import type { SupabaseClient } from "@supabase/supabase-js";
import type { SleeperWeeklyProjection } from "@/lib/data/sleeper";
import { scoreYahooOffenseProjection } from "@/lib/engine/yahoo-projection";
import { buildDraftBoard, type DraftBoardInputPlayer, type DraftPosition } from "@/lib/services/draft-board";

const positions = new Set(["QB", "RB", "WR", "TE"]);
const sourceAgeMs = 24 * 60 * 60_000;
const syncAgeMs = 6 * 60 * 60_000;
const blockedStatus = /\b(out|ir|doubtful|suspended|inactive)\b/i;

export class YahooDraftBoardError extends Error {
  constructor(public readonly code: string, public readonly status = 503) {
    super(code);
    this.name = "YahooDraftBoardError";
  }
}

function fresh(value: unknown, now: number, maxAge: number): boolean {
  const time = Date.parse(String(value));
  return Number.isFinite(time) && time <= now + 5 * 60_000 && now - time <= maxAge;
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fromSnapshot(data: unknown, season: number, observedAt: string): SleeperWeeklyProjection | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (!row.projectedStats || typeof row.projectedStats !== "object" || Array.isArray(row.projectedStats)) return null;
  const stats = Object.fromEntries(Object.entries(row.projectedStats)
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value)));
  if (!Object.keys(stats).length) return null;
  return { sleeperId: String(row.providerPlayerId || ""), season, week: 0,
    ppr: numeric(row.projectedFantasyPointsPpr), halfPpr: numeric(row.projectedFantasyPointsHalfPpr),
    standard: numeric(row.projectedFantasyPointsStandard), stats, observedAt,
    adpPpr: numeric(row.adpPpr), adpHalfPpr: numeric(row.adpHalfPpr), adpStandard: numeric(row.adpStandard) };
}

function sourceAdp(projection: SleeperWeeklyProjection, receptionPoints: number): number | null {
  const value = receptionPoints === 1 ? projection.adpPpr
    : receptionPoints === 0.5 ? projection.adpHalfPpr
    : receptionPoints === 0 ? projection.adpStandard : null;
  return value != null && value >= 1 && value < 1000 ? value : null;
}

/** Owner-scoped Yahoo availability, exact source evidence, and league scoring. */
export async function getYahooDraftBoard(client: SupabaseClient, leagueId: string, userId: string, asOf = new Date()) {
  const now = asOf.getTime();
  const [league, member, scan] = await Promise.all([
    client.from("leagues").select("provider, provider_league_id, season, scoring")
      .eq("id", leagueId).maybeSingle(),
    client.from("league_memberships").select("roster_id")
      .eq("league_id", leagueId).eq("user_id", userId).maybeSingle(),
    client.from("league_available_scans").select("scan_id, observed_at, fresh_until, candidates_count, truncated, source_url")
      .eq("league_id", leagueId).maybeSingle(),
  ]);
  if (league.error || member.error || scan.error) throw new YahooDraftBoardError("draft_board_source_unavailable");
  if (!league.data || league.data.provider !== "yahoo") throw new YahooDraftBoardError("not_yahoo_league", 409);
  if (!member.data?.roster_id) throw new YahooDraftBoardError("owned_roster_unavailable", 409);
  const scoring = league.data.scoring && typeof league.data.scoring === "object" && !Array.isArray(league.data.scoring)
    ? league.data.scoring as Record<string, unknown> : {};
  if (scoring.draftStatus === "postdraft") throw new YahooDraftBoardError("draft_complete", 409);
  if (scoring.draftStatus !== "predraft" && scoring.draftStatus !== "drafting") {
    throw new YahooDraftBoardError("draft_status_unverified", 409);
  }
  const liveDraft = scoring.draftStatus === "drafting";
  const allowedYahooAge = liveDraft ? 5 * 60_000 : syncAgeMs;
  const modifiers = scoring.statModifiers;
  if (!modifiers || typeof modifiers !== "object" || Array.isArray(modifiers)) {
    throw new YahooDraftBoardError("scoring_rules_unavailable", 409);
  }
  const season = Number(league.data.season);
  if (!Number.isInteger(season) || season < 2020 || season > 2100) throw new YahooDraftBoardError("season_unavailable", 409);
  const sourceUrl = `https://api.sleeper.app/v1/projections/nfl/regular/${season}`;
  const expectedYahooUrl = `https://fantasysports.yahooapis.com/fantasy/v2/league/${league.data.provider_league_id}/players;status=A;sort=OR`;
  if (!scan.data || !fresh(scan.data.observed_at, now, allowedYahooAge)
    || Date.parse(String(scan.data.fresh_until)) <= now || scan.data.source_url !== expectedYahooUrl) {
    throw new YahooDraftBoardError("yahoo_available_scan_stale", 409);
  }
  const [link, roster, slots, assignments, leagueAssignments, available] = await Promise.all([
    client.from("provider_league_links").select("last_synced_at, roster_id")
      .eq("league_id", leagueId).eq("user_id", userId).eq("provider", "yahoo").eq("roster_id", member.data.roster_id).maybeSingle(),
    client.from("rosters").select("id, updated_at")
      .eq("id", member.data.roster_id).eq("league_id", leagueId).maybeSingle(),
    client.from("roster_slot_definitions").select("id, slot_type, eligible_positions, required")
      .eq("league_id", leagueId).limit(101),
    client.from("roster_assignments").select("player_id, slot_definition_id, designation")
      .eq("league_id", leagueId).eq("roster_id", member.data.roster_id).limit(101),
    client.from("roster_assignments").select("player_id").eq("league_id", leagueId).limit(2001),
    client.from("league_available_players")
      .select("player_id, provider_player_key, provider_status, provider_order, observed_at, fresh_until")
      .eq("league_id", leagueId).eq("scan_id", scan.data.scan_id).order("provider_order", { ascending: true }).limit(201),
  ]);
  if (link.error || roster.error || slots.error || assignments.error || leagueAssignments.error || available.error) {
    throw new YahooDraftBoardError("draft_board_source_unavailable");
  }
  if (!link.data || !roster.data || !fresh(link.data.last_synced_at, now, allowedYahooAge)
    || !fresh(roster.data.updated_at, now, allowedYahooAge)) throw new YahooDraftBoardError("yahoo_roster_sync_stale", 409);
  if ((slots.data || []).length > 100 || (assignments.data || []).length > 100
    || (leagueAssignments.data || []).length > 2000 || !slots.data?.length) {
    throw new YahooDraftBoardError("roster_slots_unavailable", 409);
  }
  if ((available.data || []).length !== Number(scan.data.candidates_count) || (available.data || []).length > 200
    || (available.data || []).some((row, index) => Number(row.provider_order) !== index + 1
      || !fresh(row.observed_at, now, allowedYahooAge) || Date.parse(String(row.fresh_until)) <= now)) {
    throw new YahooDraftBoardError("yahoo_available_scan_incomplete", 409);
  }
  const directSlots: Partial<Record<DraftPosition, number | null>> = {};
  // Yahoo imports preserve starter designation but do not yet map each starter
  // to a specific slot. Once any such starter exists, exact open direct slots
  // are unknown; do not present all slots as open or infer flex placement.
  const unmappedStarter = (assignments.data || []).some((row) => row.designation === "starter" && !row.slot_definition_id);
  const assignedSlotIds = new Set((assignments.data || [])
    .filter((row) => row.designation === "starter" && row.slot_definition_id).map((row) => String(row.slot_definition_id)));
  for (const slot of slots.data || []) {
    const eligible = Array.isArray(slot.eligible_positions) ? slot.eligible_positions : [];
    if (slot.required && eligible.length === 1 && positions.has(eligible[0]) && !assignedSlotIds.has(String(slot.id))) {
      const position = eligible[0] as DraftPosition;
      directSlots[position] = (directSlots[position] || 0) + 1;
    }
  }
  if (unmappedStarter) for (const position of positions) directSlots[position as DraftPosition] = null;
  const rostered = new Set((leagueAssignments.data || []).map((row) => String(row.player_id)));
  const ids = (available.data || []).map((row) => String(row.player_id));
  const playerRows = [];
  const snapshotRows = [];
  const evidenceRows = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const [players, snapshots, evidence] = await Promise.all([
      client.from("players").select("id, full_name, position").in("id", batch),
      client.from("player_snapshots").select("player_id, data, observed_at, fingerprint")
        .eq("season", season).eq("week", 0).eq("source", "sleeper_season_projections")
        .in("player_id", batch).order("observed_at", { ascending: false }).limit(501),
      client.from("evidence").select("id, player_id, fingerprint, observed_at")
        .eq("source", "sleeper_season_projections").eq("source_url", sourceUrl)
        .in("player_id", batch).order("observed_at", { ascending: false }).limit(501),
    ]);
    if (players.error || snapshots.error || evidence.error || (snapshots.data || []).length > 500 || (evidence.data || []).length > 500) {
      throw new YahooDraftBoardError("draft_projection_source_unavailable");
    }
    playerRows.push(...(players.data || []));
    snapshotRows.push(...(snapshots.data || []));
    evidenceRows.push(...(evidence.data || []));
  }
  const playersById = new Map(playerRows.map((row) => [String(row.id), row]));
  const evidenceByFingerprint = new Map(evidenceRows.map((row) => [String(row.fingerprint), row]));
  const latestById = new Map<string, typeof snapshotRows[number]>();
  for (const row of snapshotRows) if (!latestById.has(String(row.player_id))) latestById.set(String(row.player_id), row);
  // Yahoo omits categories with no modifier in some league settings. An absent
  // reception modifier therefore selects standard scoring for ADP display.
  const receptionPoints = Number((modifiers as Record<string, unknown>)["11"] ?? 0);
  const candidates: DraftBoardInputPlayer[] = [];
  let unsupportedScoring: string[] | null = null;
  for (const row of available.data || []) {
    const id = String(row.player_id);
    const player = playersById.get(id);
    if (!player || !positions.has(String(player.position)) || rostered.has(id)
      || blockedStatus.test(String(row.provider_status || ""))) continue;
    const snapshot = latestById.get(id);
    if (!snapshot || !fresh(snapshot.observed_at, now, sourceAgeMs)) continue;
    const evidence = evidenceByFingerprint.get(`sleeper_season_projection_${snapshot.fingerprint}`);
    if (!evidence || String(evidence.player_id) !== id || String(evidence.observed_at) !== String(snapshot.observed_at)) continue;
    const projection = fromSnapshot(snapshot.data, season, String(snapshot.observed_at));
    if (!projection) continue;
    const score = scoreYahooOffenseProjection(projection, modifiers as Record<string, unknown>);
    if (!score.ok) {
      if (score.code === "unsupported_scoring_rules" || score.code === "invalid_scoring_rules") unsupportedScoring = score.ids;
      continue;
    }
    if (score.points <= 0) continue;
    const touchdownPoints = score.formula.filter((part) => ["5", "10", "13"].includes(part.yahooStatId))
      .reduce((sum, part) => sum + part.projectedStat * part.coefficient, 0);
    candidates.push({ id, name: String(player.full_name), position: String(player.position) as DraftPosition,
      yahooOrder: Number(row.provider_order), projectedSeasonPoints: score.points,
      sleeperAdp: sourceAdp(projection, receptionPoints),
      touchdownShare: Math.max(0, Math.min(1, touchdownPoints / score.points)),
      providerStatus: row.provider_status ? String(row.provider_status) : null,
      observedAt: String(snapshot.observed_at), evidenceId: String(evidence.id),
      assumedZeroYahooStatIds: score.assumedZeroStatIds });
  }
  if (unsupportedScoring) throw new YahooDraftBoardError(`unsupported_scoring_rules:${unsupportedScoring.join(",")}`, 409);
  if (!candidates.length) throw new YahooDraftBoardError("draft_projections_unavailable", 409);
  return { ok: true as const, status: "ready" as const, season, draftStatus: scoring.draftStatus,
    availability: { count: Number(scan.data.candidates_count), truncated: Boolean(scan.data.truncated),
      observedAt: String(scan.data.observed_at), sourceUrl: String(scan.data.source_url) },
    projections: { sourceUrl, period: "full_season" as const, accuracyVerified: false, matchedCount: candidates.length },
    modes: { best: "League-scored season forecast, open direct slots, and position gap",
      value: "Best Pick plus relative Sleeper ADP gap among matched available players",
      safe: "Best Pick adjusted by touchdown dependence and Yahoo status; heuristic, not a floor forecast",
      upside: "Best Pick adjusted by touchdown dependence and position gap; heuristic, not a ceiling forecast" },
    players: buildDraftBoard(candidates, directSlots) };
}
