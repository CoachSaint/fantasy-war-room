import type { Evidence, PlayerSnapshot } from "@/lib/types";

/** Raw fields shared by the nflverse CSV and JSON release assets. */
export interface NflverseRawStat {
  player_id?: string;
  gsis_id?: string;
  player_name?: string;
  position?: string;
  recent_team?: string;
  team?: string;
  season?: number | string;
  week?: number | string;
  /** Actual fantasy points scored in the row's game/week. */
  fantasy_points_ppr?: number | string;
  fantasy_points?: number | string;
  /** Optional projections supplied by a release or configured upstream. */
  projected_points_ppr?: number | string;
  projected_points?: number | string;
  snap_share?: number | string;
  target_share?: number | string;
  rush_share?: number | string;
  red_zone_share?: number | string;
  route_share?: number | string;
  targets?: number | string;
  carries?: number | string;
}

export interface NflverseRawDepth {
  player_id?: string;
  gsis_id?: string;
  full_name?: string;
  player_name?: string;
  team?: string;
  club_code?: string;
  depth_position?: string;
  depth_team?: number | string;
  depth_chart_order?: number | string;
  depth_rank?: number | string;
  position?: string;
  /** Official nflverse depth-chart release fields. */
  dt?: string;
  pos_abb?: string;
  pos_slot?: string;
  pos_rank?: number | string;
  season?: number | string;
  week?: number | string;
}

export interface NflverseRawInjury {
  player_id?: string;
  gsis_id?: string;
  full_name?: string;
  player_name?: string;
  team?: string;
  club_code?: string;
  position?: string;
  season?: number | string;
  week?: number | string;
  report_status?: string;
  report_primary_injury?: string;
  practice_status?: string;
  practice_participation?: string;
  practice?: string;
}

/** Metadata makes it impossible for callers to mistake actuals for projections. */
export interface NflverseSnapshot extends PlayerSnapshot {
  actualPoints?: number;
  projectionSource?: "projected" | "actual";
  fullName?: string;
  team?: string;
  position?: string;
}

export interface NflverseAdapter {
  getPlayerSnapshots(input: { season: number; week: number }): Promise<NflverseSnapshot[]>;
  getLatestAvailablePlayerSnapshots(input: { season: number; week: number }): Promise<{ week: number | null; snapshots: NflverseSnapshot[] }>;
  getRecentPlayerSnapshots(input: { season: number; week: number }): Promise<{ week: number | null; weeks: number[]; snapshots: NflverseSnapshot[] }>;
  getYahooCrosswalk(input: { season: number; week: number }): Promise<NflverseCrosswalk>;
  getEvidence(input: { season: number; week: number }): Promise<Evidence[]>;
  parsePlayerStats(data: NflverseRawStat[], season: number, week: number): PlayerSnapshot[];
  parseDepthCharts(data: NflverseRawDepth[], season: number, week: number): Evidence[];
  parseInjuryReport(data: NflverseRawInjury[], season: number, week: number): Evidence[];
}

const DEFAULT_RELEASE_BASE = "https://github.com/nflverse/nflverse-data/releases/download";

/**
 * Build an official release-asset URL. The base is configurable for mirrors and
 * deterministic tests, while never falling back to the obsolete master tree.
 */
export function nflverseReleaseAssetUrl(tag: string, asset: string): string {
  const configuredBase = typeof process !== "undefined"
    ? process.env.NFLVERSE_RELEASE_BASE_URL
    : undefined;
  const base = (configuredBase || DEFAULT_RELEASE_BASE).replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(tag)}/${asset.split("/").map(encodeURIComponent).join("/")}`;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function percentage(value: unknown): number | undefined {
  const parsed = numberValue(value);
  if (parsed == null) return undefined;
  return Math.round((parsed <= 1 ? parsed * 100 : parsed));
}

function matchesSeasonWeek(row: { season?: unknown; week?: unknown }, season: number, week: number): boolean {
  const rowSeason = numberValue(row.season);
  const rowWeek = numberValue(row.week);
  return rowSeason === season && rowWeek === week;
}

function csvRows(input: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value !== "")) rows.push(row);

  const header = rows.shift() || [];
  return rows.map((values) => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""])));
}

const MAX_RELEASE_BYTES = 8_000_000;

async function readReleaseAsset(url: string): Promise<unknown[]> {
  const response = await fetch(url, { next: { revalidate: 3600 } });
  if (!response.ok) return [];

  const declaredSize = Number(response.headers?.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_RELEASE_BYTES) {
    await response.body?.cancel();
    return [];
  }

  // Bound the bytes while streaming. Some mirrors omit Content-Length, and a
  // full depth-chart asset can be much larger than a small server function.
  const responseWithText = response as Response & { text?: () => Promise<string> };
  if (response.body || typeof responseWithText.text === "function") {
    let body = "";
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bytesRead = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesRead += value.byteLength;
        if (bytesRead > MAX_RELEASE_BYTES) {
          await reader.cancel();
          return [];
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } else {
      body = await responseWithText.text!();
      if (new TextEncoder().encode(body).length > MAX_RELEASE_BYTES) return [];
    }
    const trimmed = body.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      const parsed: unknown = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    }
    return csvRows(body);
  }

  const parsed: unknown = await response.json();
  return Array.isArray(parsed) ? parsed : [];
}

export function parsePlayerStats(
  data: NflverseRawStat[],
  season: number,
  week: number
): NflverseSnapshot[] {
  const now = new Date().toISOString();
  return data.filter((row) => matchesSeasonWeek(row, season, week)).map((row, idx) => {
    const playerId = row.player_id || row.gsis_id || `nflv_player_${idx}`;
    const actualPoints = numberValue(row.fantasy_points_ppr ?? row.fantasy_points);
    const projectedPoints = numberValue(row.projected_points_ppr ?? row.projected_points);
    const floor = projectedPoints == null ? undefined : Math.max(0, Number((projectedPoints * 0.65).toFixed(1)));
    const ceiling = projectedPoints == null ? undefined : Number((projectedPoints * 1.45).toFixed(1));
    const snapshot: NflverseSnapshot = {
      playerId,
      fullName: row.player_name,
      team: row.team || row.recent_team,
      position: row.position,
      week: numberValue(row.week) ?? week,
      season: numberValue(row.season) ?? season,
      projectedPoints: projectedPoints == null ? undefined : Number(projectedPoints.toFixed(1)),
      floor,
      ceiling,
      snapShare: percentage(row.snap_share),
      routeShare: percentage(row.route_share),
      targetShare: percentage(row.target_share),
      rushShare: percentage(row.rush_share),
      redZoneShare: percentage(row.red_zone_share),
      injuryRisk: undefined,
      roleCertainty: undefined,
      matchupScore: undefined,
      observedAt: now,
      actualPoints,
      projectionSource: projectedPoints == null ? (actualPoints == null ? undefined : "actual") : "projected",
    };
    return snapshot;
  });
}

/** Select the newest published week at or before the requested provider week. */
export function parseLatestAvailablePlayerStats(
  data: NflverseRawStat[], season: number, requestedWeek: number
): { week: number | null; snapshots: NflverseSnapshot[] } {
  const availableWeeks = data
    .filter((row) => numberValue(row.season) === season && row.player_id && row.player_name)
    .map((row) => numberValue(row.week))
    .filter((week): week is number => week != null && Number.isInteger(week) && week <= requestedWeek);
  if (!availableWeeks.length) return { week: null, snapshots: [] };
  const week = Math.max(...availableWeeks);
  return { week, snapshots: parsePlayerStats(data, season, week) };
}

/** Keep a bounded observed history, including a partial current week. */
export function parseRecentPlayerStats(
  data: NflverseRawStat[], season: number, requestedWeek: number
): { week: number | null; weeks: number[]; snapshots: NflverseSnapshot[] } {
  const weeks = [...new Set(data
    .filter((row) => numberValue(row.season) === season && row.player_id && row.player_name)
    .map((row) => numberValue(row.week))
    .filter((week): week is number => week != null && Number.isInteger(week) && week <= requestedWeek))]
    .sort((a, b) => a - b).slice(-3);
  return { week: weeks.at(-1) ?? null, weeks,
    snapshots: weeks.flatMap((week) => parsePlayerStats(data, season, week)) };
}

export interface NflverseWeeklyRosterId {
  season?: number | string;
  week?: number | string;
  game_type?: string;
  gsis_id?: string;
  yahoo_id?: string;
  sleeper_id?: string;
  full_name?: string;
  team?: string;
  position?: string;
  status?: string;
}

export interface NflverseRosterPlayer {
  fullName: string;
  team: string | null;
  position: "QB" | "RB" | "WR" | "TE" | "K";
  status: string | null;
}

export interface NflverseCrosswalk {
  week: number | null;
  ids: Map<string, string>;
  sleeperIds: Map<string, string>;
  players: Map<string, NflverseRosterPlayer>;
}

const fantasyRosterPositions = new Set<NflverseRosterPlayer["position"]>(["QB", "RB", "WR", "TE", "K"]);

/** Exact provider IDs and fantasy player records from one published roster week. */
export function parseYahooCrosswalk(
  data: NflverseWeeklyRosterId[], season: number, requestedWeek: number
): NflverseCrosswalk {
  const eligible = data.filter((row) =>
    numberValue(row.season) === season &&
    (row.game_type === "REG" || row.game_type === "POST") &&
    numberValue(row.week) != null && numberValue(row.week)! <= requestedWeek &&
    /^00-\d+$/.test(String(row.gsis_id || ""))
  );
  const week = eligible.length ? Math.max(...eligible.map((row) => numberValue(row.week)!)) : null;
  if (week == null) return { week: null, ids: new Map(), sleeperIds: new Map(), players: new Map() };
  const ids = new Map<string, string>();
  const ambiguous = new Set<string>();
  const yahooByGsis = new Map<string, string>();
  const sleeperIds = new Map<string, string>();
  const ambiguousSleeper = new Set<string>();
  const players = new Map<string, NflverseRosterPlayer>();
  const ambiguousPlayers = new Set<string>();
  for (const row of eligible.filter((item) => numberValue(item.week) === week)) {
    const gsisId = String(row.gsis_id);
    const position = String(row.position || "") as NflverseRosterPlayer["position"];
    const fullName = String(row.full_name || "").trim();
    if (fullName && fantasyRosterPositions.has(position)) {
      const player = { fullName, team: row.team || null, position, status: row.status || null };
      const previous = players.get(gsisId);
      if (previous && JSON.stringify(previous) !== JSON.stringify(player)) ambiguousPlayers.add(gsisId);
      else players.set(gsisId, player);
    }
    if (/^\d+$/.test(String(row.yahoo_id || ""))) {
      const yahooId = String(row.yahoo_id);
      const previous = ids.get(yahooId);
      if (previous && previous !== gsisId) ambiguous.add(yahooId);
      else ids.set(yahooId, gsisId);
      const previousYahoo = yahooByGsis.get(gsisId);
      if (previousYahoo && previousYahoo !== yahooId) {
        ambiguous.add(previousYahoo);
        ambiguous.add(yahooId);
      } else yahooByGsis.set(gsisId, yahooId);
    }
    if (/^\d+$/.test(String(row.sleeper_id || ""))) {
      const sleeperId = String(row.sleeper_id);
      const previous = sleeperIds.get(sleeperId);
      if (previous && previous !== gsisId) ambiguousSleeper.add(sleeperId);
      else sleeperIds.set(sleeperId, gsisId);
    }
  }
  for (const yahooId of ambiguous) ids.delete(yahooId);
  for (const sleeperId of ambiguousSleeper) sleeperIds.delete(sleeperId);
  for (const gsisId of ambiguousPlayers) players.delete(gsisId);
  return { week, ids, sleeperIds, players };
}

export function parseDepthCharts(
  data: NflverseRawDepth[],
  season: number,
  week: number
): Evidence[] {
  const explicitWeekRows = data.filter((row) => numberValue(row.season) === season && numberValue(row.week) === week);
  const datedSeasonRows = data.filter((row) => {
    if (!row.dt || numberValue(row.week) != null) return false;
    const date = new Date(`${row.dt}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return false;
    // NFL seasons begin in the named calendar year and can continue through
    // February of the following year.
    const month = date.getUTCMonth() + 1;
    const inferredSeason = month <= 2 ? date.getUTCFullYear() - 1 : date.getUTCFullYear();
    return inferredSeason === season;
  });
  const latestDate = datedSeasonRows.reduce<string | null>((latest, row) => !latest || String(row.dt) > latest ? String(row.dt) : latest, null);
  const selectedRows = explicitWeekRows.length > 0
    ? explicitWeekRows
    : latestDate
      ? datedSeasonRows.filter((row) => row.dt === latestDate)
      : [];

  return selectedRows.map((row, idx) => {
    const playerId = row.player_id || row.gsis_id || `nflv_player_${idx}`;
    const name = row.full_name || row.player_name || playerId;
    const team = row.team || row.club_code || "NFL";
    const pos = row.depth_position || row.position || row.pos_abb || row.pos_slot || "POS";
    const depth = numberValue(row.depth_team ?? row.depth_chart_order ?? row.depth_rank ?? row.pos_rank);
    const depthLabel = depth == null ? "unranked" : String(depth);
    const publishedAt = row.dt ? new Date(`${row.dt}T00:00:00Z`).toISOString() : new Date().toISOString();
    const period = row.dt ? `provider snapshot dated ${row.dt}` : `Week ${week}`;
    const summary = `${name} listed as ${pos}${depthLabel === "unranked" ? "" : depthLabel} on ${team} depth chart (${period}).`;
    const fingerprint = `depth_${playerId}_s${season}_${row.dt || `w${week}`}_d${depthLabel}`;

    return {
      id: `ev_depth_${playerId}_s${season}_w${week}_${idx}`,
      playerId,
      type: "depth_chart",
      source: "nflverse_depth_charts",
      sourceUrl: nflverseReleaseAssetUrl("depth_charts", `depth_charts_${season}.csv`),
      observedAt: publishedAt,
      publishedAt,
      confidence: depth == null ? 0.8 : 0.9,
      summary,
      fingerprint,
    };
  });
}

export function parseInjuryReport(
  data: NflverseRawInjury[],
  season: number,
  week: number
): Evidence[] {
  const now = new Date().toISOString();
  return data.filter((row) => matchesSeasonWeek(row, season, week) &&
    (!row.position || fantasyRosterPositions.has(row.position as NflverseRosterPlayer["position"])))
    .map((row, idx) => {
    const playerId = row.player_id || row.gsis_id || `nflv_player_${idx}`;
    const name = row.full_name || row.player_name || playerId;
    const team = row.team || row.club_code || "NFL";
    const status = row.report_status || "Unspecified";
    const practice = row.practice_status || row.practice_participation || row.practice;
    const injury = row.report_primary_injury || "Undisclosed";
    const practiceText = practice ? ` Practice participation: ${practice}.` : "";

    const summary = `${name} (${team}) - Injury Status: ${status}. Detail: ${injury}.${practiceText}`;
    const statusKey = `${status}_${practice || "none"}`.toLowerCase().replace(/\s+/g, "_");
    const fingerprint = `injury_${playerId}_s${season}_w${week}_${statusKey}`;
    const confidence = status.toLowerCase().includes("out") ? 0.95 : 0.85;

    return {
      id: `ev_inj_${playerId}_s${season}_w${week}_${idx}`,
      playerId,
      type: "injury",
      source: "nflverse_injuries",
      sourceUrl: nflverseReleaseAssetUrl("injuries", `injuries_${season}.csv`),
      observedAt: now,
      publishedAt: now,
      confidence,
      summary,
      fingerprint,
    };
  });
}

export const nflverse: NflverseAdapter = {
  parsePlayerStats,
  parseDepthCharts,
  parseInjuryReport,

  async getPlayerSnapshots({ season, week }: { season: number; week: number }) {
    const url = nflverseReleaseAssetUrl("stats_player", `stats_player_week_${season}.csv`);
    try {
      const raw = await readReleaseAsset(url);
      return parsePlayerStats(raw as NflverseRawStat[], season, week);
    } catch {
      // A missing release is a bounded degraded result; never substitute demo data.
      return [];
    }
  },

  async getLatestAvailablePlayerSnapshots({ season, week }: { season: number; week: number }) {
    const url = nflverseReleaseAssetUrl("stats_player", `stats_player_week_${season}.csv`);
    try {
      const raw = await readReleaseAsset(url);
      return parseLatestAvailablePlayerStats(raw as NflverseRawStat[], season, week);
    } catch {
      return { week: null, snapshots: [] };
    }
  },

  async getRecentPlayerSnapshots({ season, week }: { season: number; week: number }) {
    const url = nflverseReleaseAssetUrl("stats_player", `stats_player_week_${season}.csv`);
    try {
      const raw = await readReleaseAsset(url);
      return parseRecentPlayerStats(raw as NflverseRawStat[], season, week);
    } catch {
      return { week: null, weeks: [], snapshots: [] };
    }
  },

  async getYahooCrosswalk({ season, week }: { season: number; week: number }) {
    const url = nflverseReleaseAssetUrl("weekly_rosters", `roster_weekly_${season}.csv`);
    try {
      const raw = await readReleaseAsset(url);
      return parseYahooCrosswalk(raw as NflverseWeeklyRosterId[], season, week);
    } catch {
      return { week: null, ids: new Map(), sleeperIds: new Map(), players: new Map() };
    }
  },

  async getEvidence({ season, week }: { season: number; week: number }) {
    const evidenceList: Evidence[] = [];
    const assets = [
      ["depth_charts", `depth_charts_${season}.csv`, parseDepthCharts] as const,
      ["injuries", `injuries_${season}.csv`, parseInjuryReport] as const,
    ];

    for (const [tag, asset, parser] of assets) {
      try {
        const raw = await readReleaseAsset(nflverseReleaseAssetUrl(tag, asset));
        evidenceList.push(...parser(raw as never[], season, week));
      } catch {
        // Keep successful sources and explicitly degrade only the unavailable source.
      }
    }
    return evidenceList;
  },
};
