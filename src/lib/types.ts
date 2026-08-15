export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DST";

export type EvidenceType =
  | "injury"
  | "depth_chart"
  | "usage"
  | "transaction"
  | "news"
  | "projection";

export interface Player {
  id: string;
  sleeperId?: string;
  nflverseId?: string;
  fullName: string;
  team?: string;
  position: Position;
  byeWeek?: number;
  status?: string;
}

export interface PlayerSnapshot {
  playerId: string;
  week: number;
  season: number;
  projectedPoints?: number;
  floor?: number;
  ceiling?: number;
  snapShare?: number;
  routeShare?: number;
  targetShare?: number;
  rushShare?: number;
  redZoneShare?: number;
  injuryRisk?: number;
  roleCertainty?: number;
  matchupScore?: number;
  observedAt: string;
}

export interface Evidence {
  id: string;
  playerId: string;
  type: EvidenceType;
  source: string;
  sourceUrl?: string;
  observedAt: string;
  publishedAt?: string;
  confidence: number;
  summary: string;
  fingerprint: string;
}

export type RecommendationKind =
  | "draft"
  | "start"
  | "sit"
  | "add"
  | "drop"
  | "hold"
  | "watch";

export interface Recommendation {
  id: string;
  kind: RecommendationKind;
  subjectPlayerId: string;
  alternativePlayerId?: string;
  score: number;
  confidence: number;
  headline: string;
  reasonCodes: string[];
  evidenceIds: string[];
  computedAt: string;
  freshUntil: string;
  engineVersion: string;
}

export interface LeagueContext {
  leagueId: string;
  season: number;
  week: number;
  scoring: "standard" | "half_ppr" | "ppr" | "custom";
  rosterPositions: string[];
  rosterPlayerIds: string[];
  availablePlayerIds: string[];
}

export interface FeatureVector {
  projection: number;
  replacementValue: number;
  opportunity: number;
  marketDiscount: number;
  rosterFit: number;
  positionalScarcity: number;
  upside: number;
  scheduleFit: number;
  matchup: number;
  roleTrend: number;
  floor: number;
  ceiling: number;
  usageTrend: number;
  rosValue: number;
  rosterNeed: number;
  acquisitionEfficiency: number;
  injuryPenalty: number;
  uncertaintyPenalty: number;
  freshness: number;
  evidenceQuality: number;
  projectionAgreement: number;
  roleCertainty: number;
  injuryCertainty: number;
}
