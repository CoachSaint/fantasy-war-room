export const WAIVER_BID_VERSION = "faab-range-v1";

export interface WaiverBidInput {
  league: {
    teamCount: number;
    week: number;
    totalWeeks?: number;
  };
  budget: {
    remaining: number;
    initial?: number;
  };
  player: {
    score: number;
    confidence?: number;
  };
  /** All 0-100 scales; confidence is the only 0-1 scale. */
  needScore: number;
  scarcityScore: number;
  expectedCompetitorCount?: number;
  minimumBid?: number;
}

export interface WaiverBidRange {
  version: string;
  minimum: number;
  recommended: number;
  maximum: number;
  remainingBudget: number;
  budgetShareRecommended: number;
  factors: {
    seasonUrgency: number;
    need: number;
    scarcity: number;
    competition: number;
    confidence: number;
  };
}

export class WaiverBidValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WaiverBidValidationError";
  }
}

function scale(value: number | undefined, fallback: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isFinite(result)) throw new WaiverBidValidationError("FAAB inputs must be finite");
  if (result < 0 || result > 100) throw new WaiverBidValidationError(`${label} must be between 0 and 100`);
  return result;
}

function integer(value: number): number {
  return Math.max(0, Math.round(value));
}

/** Calculate a bounded, explainable FAAB range without changing the input. */
export function calculateWaiverBidRange(input: WaiverBidInput): WaiverBidRange {
  const { league, budget, player } = input;
  if (!Number.isInteger(league.teamCount) || league.teamCount < 2 || league.teamCount > 32) throw new WaiverBidValidationError("teamCount must be between 2 and 32");
  const totalWeeks = league.totalWeeks ?? 18;
  if (!Number.isInteger(league.week) || league.week < 0 || league.week > totalWeeks || !Number.isInteger(totalWeeks) || totalWeeks < 1 || totalWeeks > 30) throw new WaiverBidValidationError("week must be within the configured season");
  if (!Number.isFinite(budget.remaining) || budget.remaining < 0) throw new WaiverBidValidationError("remaining budget must be non-negative");
  const initialBudget = budget.initial ?? Math.max(100, budget.remaining);
  if (!Number.isFinite(initialBudget) || initialBudget <= 0 || budget.remaining > initialBudget) throw new WaiverBidValidationError("initial budget must be positive and cover remaining budget");
  const score = scale(player.score, 0, "player score");
  const confidence = scale(player.confidence == null ? undefined : player.confidence * 100, 70, "confidence");
  const need = scale(input.needScore, 0, "need score");
  const scarcity = scale(input.scarcityScore, 0, "scarcity score");
  const maxCompetitors = league.teamCount - 1;
  const expectedCompetitors = input.expectedCompetitorCount == null ? maxCompetitors * 0.5 : input.expectedCompetitorCount;
  if (!Number.isFinite(expectedCompetitors) || expectedCompetitors < 0 || expectedCompetitors > maxCompetitors) throw new WaiverBidValidationError("expected competitors must fit the league");
  const competitorRatio = (expectedCompetitors / maxCompetitors);
  const seasonUrgency = 0.75 + (league.week / totalWeeks) * 0.5;
  const needFactor = 0.75 + (need / 100) * 0.75;
  const scarcityFactor = 0.8 + (scarcity / 100) * 0.6;
  const competitionFactor = 0.8 + competitorRatio * 0.6;
  const confidenceFactor = 0.75 + (confidence / 100) * 0.5;
  const quality = 0.02 + (score / 100) * 0.18;
  const recommendedRaw = budget.remaining * quality * seasonUrgency * needFactor * scarcityFactor * competitionFactor * confidenceFactor;
  if (input.minimumBid != null && (!Number.isFinite(input.minimumBid) || input.minimumBid < 0)) throw new WaiverBidValidationError("minimum bid must be non-negative");
  const minimumBid = Math.max(0, Math.min(budget.remaining, integer(input.minimumBid ?? (budget.remaining > 0 ? 1 : 0))));
  const recommended = integer(Math.max(minimumBid, Math.min(budget.remaining, recommendedRaw)));
  const minimum = integer(Math.max(minimumBid, Math.min(recommended, recommended * 0.7)));
  const maximum = integer(Math.max(recommended, Math.min(budget.remaining, recommended * 1.35 + 1)));
  return {
    version: WAIVER_BID_VERSION,
    minimum,
    recommended,
    maximum,
    remainingBudget: budget.remaining,
    budgetShareRecommended: budget.remaining ? Number((recommended / budget.remaining).toFixed(6)) : 0,
    factors: {
      seasonUrgency: Number(seasonUrgency.toFixed(6)),
      need: Number(needFactor.toFixed(6)),
      scarcity: Number(scarcityFactor.toFixed(6)),
      competition: Number(competitionFactor.toFixed(6)),
      confidence: Number(confidenceFactor.toFixed(6)),
    },
  };
}
