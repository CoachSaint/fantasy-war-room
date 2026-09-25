import { describe, expect, it } from "vitest";
import { scoreYahooOffenseProjection } from "../src/lib/engine/yahoo-projection";
import type { SleeperWeeklyProjection } from "../src/lib/data/sleeper";

const projection: SleeperWeeklyProjection = {
  sleeperId: "96", season: 2026, week: 3, ppr: 14, halfPpr: 14, standard: 14,
  stats: { pass_yd: 200, pass_td: 2, pass_int: 1, rush_yd: 20, rush_td: 0, fum_lost: 0.5 },
  observedAt: "2026-09-24T20:00:00.000Z",
};

describe("Yahoo offense projection scoring", () => {
  it("applies configured Yahoo coefficients and keeps the formula inspectable", () => {
    const scored = scoreYahooOffenseProjection(projection, {
      "4": 0.04, "5": 6, "6": -2, "9": 0.1, "10": 6, "18": -2,
      "19": 3, "32": 1, "50": 10,
    });
    expect(scored).toMatchObject({ ok: true, points: 19, assumedZeroStatIds: [] });
    if (scored.ok) expect(scored.formula).toContainEqual({ yahooStatId: "4", projectedStat: 200, coefficient: 0.04 });
  });

  it("reports missing provider stat fields used as zero and rejects unknown scoring IDs", () => {
    expect(scoreYahooOffenseProjection(projection, { "4": 0.04, "15": 6 })).toMatchObject({ ok: true, assumedZeroStatIds: ["15"] });
    expect(scoreYahooOffenseProjection(projection, { "4": 0.04, "999": 2 })).toEqual({ ok: false, code: "unsupported_scoring_rules", ids: ["999"] });
  });
});
