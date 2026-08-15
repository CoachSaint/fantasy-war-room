export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DST";

/** A value's provenance is part of the value.  Do not use actuals as a
 * projection merely because both happen to be expressed in fantasy points. */
export type FantasyValueKind = "actual" | "projected" | "expected" | "ros";

export interface FantasyValue {
  kind: FantasyValueKind;
  fantasyPoints: number;
  floor?: number;
  ceiling?: number;
  source?: string;
  asOf?: string;
  season?: number;
  week?: number;
}

/** Sparse by design: an ingestion run will commonly have only one value kind. */
export interface FantasyValueSet {
  actual?: number;
  projected?: number;
  expected?: number;
  ros?: number;
}

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
  /** Canonical, provenance-explicit aliases. `projectedPoints` remains for v1 callers. */
  actualFantasyPoints?: number;
  projectedFantasyPoints?: number;
  expectedFantasyPoints?: number;
  restOfSeasonProjection?: number;
  values?: FantasyValueSet;
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
  scoring: ScoringPreset | ScoringProfile;
  /** v1 compatibility; new consumers should use rosterSlots. */
  rosterPositions: Array<RosterSlotType | string>;
  rosterSlots?: RosterSlotDefinition[];
  rosterPlayerIds: string[];
  availablePlayerIds: string[];
  teamCount?: number;
  benchSlots?: number;
  irSlots?: number;
  taxiSlots?: number;
}

export type ScoringPreset = "standard" | "half_ppr" | "ppr" | "custom";

/** Exact coefficients used by the deterministic engine. Values are points per
 * event unless otherwise noted. Unknown/custom rules can be retained in
 * bonuses without collapsing the profile to a preset. */
export interface ScoringProfile {
  preset?: ScoringPreset;
  passing?: {
    passYard?: number;
    passTd?: number;
    interception?: number;
    completion?: number;
    incompletion?: number;
    twoPoint?: number;
    bonus300?: number;
    bonus400?: number;
  };
  rushing?: {
    rushYard?: number;
    rushTd?: number;
    firstDown?: number;
    twoPoint?: number;
    bonus100?: number;
    bonus200?: number;
  };
  receiving?: {
    reception?: number;
    receptionByPosition?: Partial<Record<Position, number>>;
    receivingYard?: number;
    receivingTd?: number;
    firstDown?: number;
    twoPoint?: number;
    bonus100?: number;
    bonus200?: number;
  };
  misc?: {
    fumble?: number;
    fumbleLost?: number;
    returnYard?: number;
    returnTd?: number;
  };
  kicking?: Record<string, number>;
  defense?: Record<string, number>;
  bonuses?: Record<string, number>;
}

export type RosterSlotType =
  | "QB" | "RB" | "WR" | "TE" | "FLEX" | "SUPER_FLEX"
  | "WR_RB" | "WR_TE" | "K" | "DST" | "BENCH" | "IR" | "TAXI";

export interface RosterSlotDefinition {
  id?: string;
  slotType: RosterSlotType;
  slotOrder: number;
  eligiblePositions: Position[];
  required?: boolean;
  /** Useful for UI-created definitions; repeated rows remain canonical. */
  count?: number;
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
