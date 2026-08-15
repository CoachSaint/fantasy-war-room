import { describe, expect, it } from "vitest";
import { calculateCalibration } from "../src/lib/services/calibration";
import { simulateDraftSurvival, DraftSimulationValidationError } from "../src/lib/services/draft-simulator";
import { calculateWaiverBidRange, WaiverBidValidationError } from "../src/lib/services/waiver-bid";

describe("seeded draft survival simulation", () => {
  const input = {
    players: [
      { playerId: "elite", position: "WR" as const, adp: 2, projection: 25 },
      { playerId: "mid", position: "RB" as const, adp: 20, projection: 18 },
      { playerId: "late", position: "TE" as const, adp: 80, projection: 12 },
    ],
    seed: "stable-seed",
    currentOverallPick: 1,
    teamCount: 12,
    horizon: { unit: "picks" as const, count: 1 as const },
    simulations: 500,
    targetPlayerIds: ["mid", "late"],
  };

  it("is deterministic, bounded, and respects target selection", () => {
    const first = simulateDraftSurvival(input);
    const second = simulateDraftSurvival({ ...input, players: [...input.players] });
    expect(first).toEqual(second);
    expect(first.version).toBe("draft-survival-v1");
    expect(first.simulatedPicks).toBe(1);
    expect(first.players.map((player) => player.playerId)).toEqual(["mid", "late"]);
    expect(first.players.every((player) => player.survivalProbability >= 0 && player.survivalProbability <= 1)).toBe(true);
    expect(first.players[1].survivalProbability).toBeGreaterThan(first.players[0].survivalProbability);
  });

  it("supports a bounded round horizon and rejects malformed pools", () => {
    const result = simulateDraftSurvival({ ...input, horizon: { unit: "rounds", count: 2 }, simulations: 20 });
    expect(result.simulatedPicks).toBe(24);
    expect(() => simulateDraftSurvival({ ...input, players: [{ ...input.players[0], playerId: "" }] })).toThrow(DraftSimulationValidationError);
    expect(() => simulateDraftSurvival({ ...input, players: [...input.players, input.players[0]] })).toThrow("duplicate");
  });
});

describe("calibration metrics", () => {
  it("computes deterministic MAE, RMSE, Brier, coverage, and rank correlation", () => {
    const result = calculateCalibration([
      { predicted: 10, actual: 8, probability: 0.8, outcome: 1, intervalLower: 7, intervalUpper: 11 },
      { predicted: 20, actual: 22, probability: 0.2, outcome: 0, intervalLower: 15, intervalUpper: 19 },
      { predicted: 30, actual: 27, probability: 0.7, outcome: true, intervalLower: 25, intervalUpper: 35 },
    ]);
    expect(result.sampleSize).toBe(3);
    expect(result.mae.value).toBe(2.333333);
    expect(result.rmse.value).toBe(2.380476);
    expect(result.brier.value).toBe(0.056667);
    expect(result.intervalCoverage.value).toBe(0.666667);
    expect(result.rankCorrelation.value).toBe(1);
  });

  it("returns null for unavailable metrics and rejects invalid probabilities", () => {
    expect(calculateCalibration([{ predicted: 1, actual: 1 }]).brier.value).toBeNull();
    expect(calculateCalibration([{ predicted: 1, actual: 1 }]).rankCorrelation.value).toBeNull();
    expect(() => calculateCalibration([{ predicted: 1, actual: 1, probability: 2 }])).toThrow("between 0 and 1");
  });
});

describe("league-aware FAAB range", () => {
  const bidInput = {
    league: { teamCount: 12, week: 12, totalWeeks: 18 },
    budget: { remaining: 100, initial: 100 },
    player: { score: 85, confidence: 0.9 },
    needScore: 90,
    scarcityScore: 80,
    expectedCompetitorCount: 8,
  };

  it("returns a bounded deterministic range that responds to need and scarcity", () => {
    const strong = calculateWaiverBidRange(bidInput);
    const weak = calculateWaiverBidRange({ ...bidInput, needScore: 10, scarcityScore: 10, league: { ...bidInput.league, week: 1 } });
    expect(strong.minimum).toBeLessThanOrEqual(strong.recommended);
    expect(strong.recommended).toBeLessThanOrEqual(strong.maximum);
    expect(strong.maximum).toBeLessThanOrEqual(100);
    expect(strong.recommended).toBeGreaterThan(weak.recommended);
    expect(strong.version).toBe("faab-range-v1");
  });

  it("handles an exhausted budget and rejects invalid league inputs", () => {
    const exhausted = calculateWaiverBidRange({ ...bidInput, budget: { remaining: 0, initial: 100 } });
    expect(exhausted.minimum).toBe(0);
    expect(exhausted.recommended).toBe(0);
    expect(exhausted.maximum).toBe(0);
    expect(() => calculateWaiverBidRange({ ...bidInput, league: { ...bidInput.league, teamCount: 1 } })).toThrow(WaiverBidValidationError);
    expect(() => calculateWaiverBidRange({ ...bidInput, budget: { remaining: 101, initial: 100 } })).toThrow("cover remaining");
    expect(() => calculateWaiverBidRange({ ...bidInput, needScore: 101 })).toThrow("between 0 and 100");
  });
});
