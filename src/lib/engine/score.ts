import type { Evidence, FeatureVector, LeagueContext, Player, PlayerSnapshot } from "@/lib/types";

export const ENGINE_VERSION = "war-v0.1.0";

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

const weighted = (entries: Array<[number, number]>) =>
  entries.reduce((total, [value, weight]) => total + clamp(value) * weight, 0);

export function draftScore(f: FeatureVector) {
  const base = weighted([
    [(f.projection + f.replacementValue) / 2, 0.28],
    [f.opportunity, 0.18],
    [f.marketDiscount, 0.15],
    [f.rosterFit, 0.12],
    [f.positionalScarcity, 0.1],
    [f.upside, 0.1],
    [f.scheduleFit, 0.07],
  ]);
  return Math.round(clamp(base - f.injuryPenalty * 0.12 - f.uncertaintyPenalty * 0.08));
}

export function startScore(f: FeatureVector) {
  const base = weighted([
    [f.projection, 0.34],
    [f.opportunity, 0.2],
    [(f.matchup + f.scheduleFit) / 2, 0.14],
    [f.roleTrend, 0.12],
    [f.floor, 0.1],
    [f.ceiling, 0.1],
  ]);
  return Math.round(clamp(base - f.injuryPenalty * 0.13 - f.uncertaintyPenalty * 0.08));
}

export function waiverScore(f: FeatureVector) {
  const base = weighted([
    [f.opportunity, 0.22],
    [f.usageTrend, 0.18],
    [f.rosValue, 0.16],
    [f.rosterNeed, 0.14],
    [f.scheduleFit, 0.12],
    [f.upside, 0.1],
    [f.acquisitionEfficiency, 0.08],
  ]);
  return Math.round(clamp(base - f.injuryPenalty * 0.08 - f.uncertaintyPenalty * 0.08));
}

export function confidenceScore(f: FeatureVector) {
  return Math.round(
    clamp(
      weighted([
        [f.freshness, 0.26],
        [f.evidenceQuality, 0.24],
        [f.projectionAgreement, 0.18],
        [f.roleCertainty, 0.18],
        [f.injuryCertainty, 0.14],
      ]),
    ),
  );
}

export interface CalculateFeatureVectorInput {
  player: Player;
  snapshot?: PlayerSnapshot;
  evidence?: Evidence[];
  leagueContext?: LeagueContext;
}

export function calculateFeatureVector(input: CalculateFeatureVectorInput): FeatureVector {
  const { player, snapshot, evidence = [], leagueContext } = input;

  const positionalScarcityMap: Record<string, number> = {
    TE: 85,
    RB: 80,
    WR: 65,
    QB: 50,
    DST: 30,
    K: 20,
  };

  const positionalBaselineMap: Record<string, number> = {
    QB: 15.0,
    RB: 8.5,
    WR: 8.0,
    TE: 5.5,
    K: 7.0,
    DST: 6.0,
  };

  const positionalScarcity = positionalScarcityMap[player.position] ?? 50;
  const baselinePPG = positionalBaselineMap[player.position] ?? 8.0;

  const projPoints = snapshot?.projectedPoints ?? baselinePPG;
  const projection = clamp(Math.round(projPoints * 4.0));
  const pointsAboveReplacement = projPoints - baselinePPG;
  const replacementValue = clamp(Math.round(50 + pointsAboveReplacement * 4.5));

  const targetShare = snapshot?.targetShare ?? 10;
  const snapShare = snapshot?.snapShare ?? 50;
  const rushShare = snapshot?.rushShare ?? 10;
  const redZoneShare = snapshot?.redZoneShare ?? 10;
  const opportunity = clamp(
    Math.round(targetShare * 2.2 + snapShare * 0.4 + rushShare * 1.5 + redZoneShare * 0.5)
  );

  const floor = snapshot?.floor != null ? clamp(Math.round(snapshot.floor * 5.0)) : clamp(Math.round(projection * 0.7));
  const ceiling = snapshot?.ceiling != null ? clamp(Math.round(snapshot.ceiling * 3.2)) : clamp(Math.round(projection * 1.3));
  const upside = clamp(Math.round(ceiling - floor * 0.5));

  const matchup = snapshot?.matchupScore ?? 50;
  const scheduleFit = player.byeWeek ? 75 : 80;

  let baseInjuryRisk = snapshot?.injuryRisk ?? 0;
  if (player.status === "Questionable") baseInjuryRisk = Math.max(baseInjuryRisk, 35);
  else if (player.status === "Out" || player.status === "IR") baseInjuryRisk = Math.max(baseInjuryRisk, 90);

  const injuryEvs = evidence.filter((e) => e.type === "injury");
  for (const e of injuryEvs) {
    const text = e.summary.toLowerCase();
    if (text.includes("out") || text.includes("ir")) baseInjuryRisk = Math.max(baseInjuryRisk, 95);
    else if (text.includes("limited") || text.includes("questionable")) baseInjuryRisk = Math.max(baseInjuryRisk, 40);
  }
  const injuryPenalty = clamp(baseInjuryRisk);

  let freshness = 30;
  if (snapshot?.observedAt || evidence.length > 0) {
    const newestTime = Math.max(
      snapshot ? new Date(snapshot.observedAt).getTime() : 0,
      ...evidence.map((e) => new Date(e.observedAt).getTime())
    );
    const ageHours = (Date.now() - newestTime) / (1000 * 60 * 60);
    freshness = ageHours <= 2 ? 100 : clamp(Math.round(100 - (ageHours - 2) * 1.2));
  }

  const evidenceQuality = evidence.length > 0
    ? Math.round(evidence.reduce((sum, e) => sum + e.confidence * 100, 0) / evidence.length)
    : 40;

  const uncertaintyPenalty = clamp(
    Math.round(100 - evidenceQuality + (snapshot ? 0 : 40) + (evidence.length === 0 ? 30 : 0))
  );

  let rosterFit = 60;
  let rosterNeed = 60;
  if (leagueContext && leagueContext.rosterPlayerIds.length > 0) {
    rosterFit = 80;
    rosterNeed = 80;
  }

  return {
    projection,
    replacementValue,
    opportunity,
    marketDiscount: 50,
    rosterFit,
    positionalScarcity,
    upside,
    scheduleFit,
    matchup,
    roleTrend: snapshot?.roleCertainty ?? 75,
    floor,
    ceiling,
    usageTrend: 75,
    rosValue: Math.round((projection + replacementValue + opportunity) / 3),
    rosterNeed,
    acquisitionEfficiency: 60,
    injuryPenalty,
    uncertaintyPenalty,
    freshness,
    evidenceQuality,
    projectionAgreement: 80,
    roleCertainty: snapshot?.roleCertainty ?? 75,
    injuryCertainty: clamp(Math.round(100 - injuryPenalty * 0.7)),
  };
}

export interface WARResult {
  warScore: number;
  rawWar: number;
  pointsAboveReplacement: number;
  weeklyWinsAdded: number;
  replacementBaseline: number;
}

export function calculateWAR(
  player: Player,
  snapshot?: PlayerSnapshot,
  replacementBaselineOverride?: number
): WARResult {
  const baselines: Record<string, number> = {
    QB: 15.0,
    RB: 8.5,
    WR: 8.0,
    TE: 5.5,
    K: 7.0,
    DST: 6.0,
  };

  const baseline = replacementBaselineOverride ?? baselines[player.position] ?? 8.0;
  const ppg = snapshot?.projectedPoints ?? baseline;
  const pointsAboveReplacement = parseFloat((ppg - baseline).toFixed(2));
  const weeklyWinsAdded = parseFloat((pointsAboveReplacement * 0.035).toFixed(3));
  const rawWar = parseFloat((weeklyWinsAdded * 17).toFixed(2));
  const warScore = Math.min(100, Math.max(0, Math.round(50 + pointsAboveReplacement * 4.0)));

  return {
    warScore,
    rawWar,
    pointsAboveReplacement,
    weeklyWinsAdded,
    replacementBaseline: baseline,
  };
}
