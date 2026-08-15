import type { Evidence, PlayerSnapshot } from "@/lib/types";

export interface NflverseRawStat {
  player_id?: string;
  gsis_id?: string;
  player_name?: string;
  position?: string;
  recent_team?: string;
  team?: string;
  season?: number;
  week?: number;
  fantasy_points_ppr?: number;
  fantasy_points?: number;
  snap_share?: number;
  target_share?: number;
  rush_share?: number;
  red_zone_share?: number;
  route_share?: number;
  targets?: number;
  carries?: number;
}

export interface NflverseRawDepth {
  player_id?: string;
  gsis_id?: string;
  full_name?: string;
  player_name?: string;
  team?: string;
  depth_position?: string;
  depth_team?: number | string;
  position?: string;
}

export interface NflverseRawInjury {
  player_id?: string;
  gsis_id?: string;
  full_name?: string;
  player_name?: string;
  team?: string;
  report_status?: string;
  report_primary_injury?: string;
  practice_status?: string;
}

export interface NflverseAdapter {
  getPlayerSnapshots(input: { season: number; week: number }): Promise<PlayerSnapshot[]>;
  getEvidence(input: { season: number; week: number }): Promise<Evidence[]>;
  parsePlayerStats(data: NflverseRawStat[], season: number, week: number): PlayerSnapshot[];
  parseDepthCharts(data: NflverseRawDepth[], season: number, week: number): Evidence[];
  parseInjuryReport(data: NflverseRawInjury[], season: number, week: number): Evidence[];
}

export function parsePlayerStats(
  data: NflverseRawStat[],
  season: number,
  week: number
): PlayerSnapshot[] {
  const now = new Date().toISOString();
  return data.map((row, idx) => {
    const playerId = row.player_id || row.gsis_id || `nflv_player_${idx}`;
    const ppg = row.fantasy_points_ppr ?? row.fantasy_points ?? 10.0;
    const floor = Math.max(0, parseFloat((ppg * 0.65).toFixed(1)));
    const ceiling = parseFloat((ppg * 1.45).toFixed(1));

    return {
      playerId,
      week: row.week ?? week,
      season: row.season ?? season,
      projectedPoints: parseFloat(ppg.toFixed(1)),
      floor,
      ceiling,
      snapShare: row.snap_share != null ? Math.round(row.snap_share * 100) : undefined,
      routeShare: row.route_share != null ? Math.round(row.route_share * 100) : undefined,
      targetShare: row.target_share != null ? Math.round(row.target_share * 100) : undefined,
      rushShare: row.rush_share != null ? Math.round(row.rush_share * 100) : undefined,
      redZoneShare: row.red_zone_share != null ? Math.round(row.red_zone_share * 100) : undefined,
      injuryRisk: 10,
      roleCertainty: 85,
      matchupScore: 75,
      observedAt: now,
    };
  });
}

export function parseDepthCharts(
  data: NflverseRawDepth[],
  season: number,
  week: number
): Evidence[] {
  const now = new Date().toISOString();
  return data.map((row, idx) => {
    const playerId = row.player_id || row.gsis_id || `nflv_player_${idx}`;
    const name = row.full_name || row.player_name || playerId;
    const team = row.team || "NFL";
    const pos = row.depth_position || row.position || "POS";
    const depth = row.depth_team ?? 1;

    const summary = `${name} listed as ${pos}${depth} on ${team} depth chart for Week ${week}.`;
    const fingerprint = `depth_${playerId}_w${week}_d${depth}`;

    return {
      id: `ev_depth_${playerId}_w${week}_${idx}`,
      playerId,
      type: "depth_chart",
      source: "nflverse_depth_charts",
      sourceUrl: `https://github.com/nflverse/nflverse-data/releases/tag/depth_charts`,
      observedAt: now,
      publishedAt: now,
      confidence: 0.9,
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
  return data.map((row, idx) => {
    const playerId = row.player_id || row.gsis_id || `nflv_player_${idx}`;
    const name = row.full_name || row.player_name || playerId;
    const team = row.team || "NFL";
    const status = row.report_status || row.practice_status || "Questionable";
    const injury = row.report_primary_injury || "Undisclosed";

    const summary = `${name} (${team}) - Injury Status: ${status}. Detail: ${injury}.`;
    const fingerprint = `injury_${playerId}_w${week}_${status.toLowerCase().replace(/\s+/g, "_")}`;
    const confidence = status.toLowerCase().includes("out") ? 0.95 : 0.85;

    return {
      id: `ev_inj_${playerId}_w${week}_${idx}`,
      playerId,
      type: "injury",
      source: "nflverse_injuries",
      sourceUrl: `https://github.com/nflverse/nflverse-data/releases/tag/injuries`,
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
    try {
      const res = await fetch(
        `https://raw.githubusercontent.com/nflverse/nflverse-data/master/data/player_stats/player_stats_${season}.json`,
        { next: { revalidate: 3600 } }
      );
      if (res.ok) {
        const raw = await res.json();
        const filtered = Array.isArray(raw) ? raw.filter((r) => r.week === week) : [];
        if (filtered.length > 0) {
          return parsePlayerStats(filtered, season, week);
        }
      }
    } catch {
      // Fallback gracefully on network error
    }
    return [];
  },

  async getEvidence({ season, week }: { season: number; week: number }) {
    const evidenceList: Evidence[] = [];
    try {
      const depthRes = await fetch(
        `https://raw.githubusercontent.com/nflverse/nflverse-data/master/data/depth_charts/depth_charts_${season}.json`,
        { next: { revalidate: 3600 } }
      );
      if (depthRes.ok) {
        const rawDepth = await depthRes.json();
        if (Array.isArray(rawDepth)) {
          evidenceList.push(...parseDepthCharts(rawDepth.slice(0, 50), season, week));
        }
      }
    } catch {}

    try {
      const injRes = await fetch(
        `https://raw.githubusercontent.com/nflverse/nflverse-data/master/data/injuries/injuries_${season}.json`,
        { next: { revalidate: 1800 } }
      );
      if (injRes.ok) {
        const rawInj = await injRes.json();
        if (Array.isArray(rawInj)) {
          evidenceList.push(...parseInjuryReport(rawInj.slice(0, 50), season, week));
        }
      }
    } catch {}

    return evidenceList;
  },
};
