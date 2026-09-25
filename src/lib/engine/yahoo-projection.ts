const offenseStats: Record<string, string | string[]> = {
  "4": "pass_yd", "5": "pass_td", "6": "pass_int", "8": "rush_att",
  "9": "rush_yd", "10": "rush_td", "11": "rec", "12": "rec_yd",
  "13": "rec_td", "15": "st_td", "16": ["pass_2pt", "rush_2pt", "rec_2pt"],
  "18": "fum_lost", "57": "off_fum_rec_td",
};

// Yahoo's published category IDs for kicking and team defense do not apply to
// an individual QB/RB/WR/TE projection. Unknown IDs still fail closed.
const nonOffenseIds = new Set([
  ...Array.from({ length: 38 }, (_, index) => String(index + 19)),
  "82",
]);

export type YahooProjectionScore =
  | { ok: true; points: number; assumedZeroStatIds: string[]; formula: Array<{ yahooStatId: string; projectedStat: number; coefficient: number }> }
  | { ok: false; code: "invalid_scoring_rules" | "unsupported_scoring_rules" | "projection_stats_unavailable"; ids: string[] };

/** Apply Yahoo's exact configured coefficients to available provider stat forecasts. */
export function scoreYahooOffenseProjection(
  projection: { stats: Record<string, number> },
  modifiers: Record<string, unknown>,
): YahooProjectionScore {
  if (!Object.keys(projection.stats).length) return { ok: false, code: "projection_stats_unavailable", ids: [] };
  const unsupported: string[] = [];
  const invalid: string[] = [];
  const assumedZeroStatIds: string[] = [];
  const formula: Array<{ yahooStatId: string; projectedStat: number; coefficient: number }> = [];
  for (const [yahooStatId, rawCoefficient] of Object.entries(modifiers)) {
    const coefficient = typeof rawCoefficient === "number" ? rawCoefficient : Number(rawCoefficient);
    if (!Number.isFinite(coefficient)) { invalid.push(yahooStatId); continue; }
    if (coefficient === 0 || nonOffenseIds.has(yahooStatId)) continue;
    const keys = offenseStats[yahooStatId];
    if (!keys) { unsupported.push(yahooStatId); continue; }
    const statKeys = Array.isArray(keys) ? keys : [keys];
    const missing = statKeys.some((key) => projection.stats[key] == null);
    if (missing) assumedZeroStatIds.push(yahooStatId);
    const projectedStat = statKeys.reduce((sum, key) => sum + (projection.stats[key] ?? 0), 0);
    formula.push({ yahooStatId, projectedStat, coefficient });
  }
  if (invalid.length) return { ok: false, code: "invalid_scoring_rules", ids: invalid };
  if (unsupported.length) return { ok: false, code: "unsupported_scoring_rules", ids: unsupported };
  if (!formula.length) return { ok: false, code: "invalid_scoring_rules", ids: [] };
  const points = Math.round(formula.reduce((sum, part) => sum + part.projectedStat * part.coefficient, 0) * 100) / 100;
  return { ok: true, points, assumedZeroStatIds, formula };
}
