import { describe, expect, it } from "vitest";
import {
  calculateFeatureVector,
  calculateWAR,
  confidenceScore,
  draftScore,
  startScore,
  waiverScore,
} from "../src/lib/engine/score";
import type { Evidence, FeatureVector, Player, PlayerSnapshot } from "../src/lib/types";

const base: FeatureVector = {
  projection: 80,
  replacementValue: 80,
  opportunity: 80,
  marketDiscount: 80,
  rosterFit: 80,
  positionalScarcity: 80,
  upside: 80,
  scheduleFit: 80,
  matchup: 80,
  roleTrend: 80,
  floor: 80,
  ceiling: 80,
  usageTrend: 80,
  rosValue: 80,
  rosterNeed: 80,
  acquisitionEfficiency: 80,
  injuryPenalty: 0,
  uncertaintyPenalty: 0,
  freshness: 80,
  evidenceQuality: 80,
  projectionAgreement: 80,
  roleCertainty: 80,
  injuryCertainty: 80,
};

describe("decision scores", () => {
  it("keeps balanced input near its normalized value", () => {
    expect(draftScore(base)).toBe(80);
    expect(startScore(base)).toBe(80);
    expect(waiverScore(base)).toBe(80);
    expect(confidenceScore(base)).toBe(80);
  });

  it("penalizes injury and uncertainty", () => {
    const risky = { ...base, injuryPenalty: 100, uncertaintyPenalty: 100 };
    expect(draftScore(risky)).toBeLessThan(draftScore(base));
    expect(startScore(risky)).toBeLessThan(startScore(base));
    expect(waiverScore(risky)).toBeLessThan(waiverScore(base));
  });

  it("clamps extreme outputs to 0-100", () => {
    const extremeLow: FeatureVector = {
      ...base,
      projection: 0,
      opportunity: 0,
      injuryPenalty: 500,
      uncertaintyPenalty: 500,
    };
    expect(draftScore(extremeLow)).toBe(0);
    expect(startScore(extremeLow)).toBe(0);
    expect(waiverScore(extremeLow)).toBe(0);

    const extremeHigh: FeatureVector = {
      ...base,
      projection: 200,
      opportunity: 200,
      marketDiscount: 200,
      rosterFit: 200,
      positionalScarcity: 200,
      upside: 200,
      scheduleFit: 200,
      roleTrend: 200,
      floor: 200,
      ceiling: 200,
      usageTrend: 200,
      rosValue: 200,
      rosterNeed: 200,
      acquisitionEfficiency: 200,
    };
    expect(draftScore(extremeHigh)).toBe(100);
    expect(startScore(extremeHigh)).toBe(100);
  });
});

describe("calculateFeatureVector", () => {
  const player: Player = {
    id: "p-jj",
    fullName: "Justin Jefferson",
    position: "WR",
    team: "MIN",
    byeWeek: 6,
    status: "Active",
  };

  const snapshot: PlayerSnapshot = {
    playerId: "p-jj",
    week: 1,
    season: 2026,
    projectedPoints: 19.8,
    floor: 14.2,
    ceiling: 28.5,
    snapShare: 94,
    targetShare: 29,
    observedAt: new Date().toISOString(),
  };

  const evidence: Evidence[] = [
    {
      id: "ev-1",
      playerId: "p-jj",
      type: "usage",
      source: "nflverse",
      observedAt: new Date().toISOString(),
      confidence: 0.95,
      summary: "High target share",
      fingerprint: "jj_usage",
    },
  ];

  it("computes accurate feature vectors for active players", () => {
    const fv = calculateFeatureVector({ player, snapshot, evidence });
    expect(fv.projection).toBeGreaterThan(70);
    expect(fv.opportunity).toBeGreaterThan(70);
    expect(fv.injuryPenalty).toBe(0);
    expect(fv.freshness).toBe(100);
  });

  it("applies injury penalty when player status is Out or IR", () => {
    const injuredPlayer = { ...player, status: "Out" };
    const fv = calculateFeatureVector({ player: injuredPlayer, snapshot, evidence });
    expect(fv.injuryPenalty).toBeGreaterThanOrEqual(90);
  });
});

describe("calculateWAR", () => {
  const player: Player = {
    id: "p-cmc",
    fullName: "Christian McCaffrey",
    position: "RB",
    team: "SF",
  };

  it("calculates positive WAR for elite performers", () => {
    const snapshot: PlayerSnapshot = {
      playerId: "p-cmc",
      week: 1,
      season: 2026,
      projectedPoints: 21.5,
      observedAt: new Date().toISOString(),
    };

    const war = calculateWAR(player, snapshot);
    expect(war.pointsAboveReplacement).toBeGreaterThan(10);
    expect(war.warScore).toBeGreaterThan(80);
    expect(war.rawWar).toBeGreaterThan(6.0);
  });

  it("calculates 50 WAR score for replacement level players", () => {
    const snapshot: PlayerSnapshot = {
      playerId: "p-cmc",
      week: 1,
      season: 2026,
      projectedPoints: 8.5,
      observedAt: new Date().toISOString(),
    };

    const war = calculateWAR(player, snapshot);
    expect(war.pointsAboveReplacement).toBe(0);
    expect(war.warScore).toBe(50);
  });
});
