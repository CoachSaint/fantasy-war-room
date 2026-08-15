import { describe, expect, it } from "vitest";
import { confidenceScore, draftScore, startScore, waiverScore } from "../src/lib/engine/score";
import type { FeatureVector } from "../src/lib/types";

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
});
