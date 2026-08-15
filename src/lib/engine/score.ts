import type { FeatureVector } from "@/lib/types";

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
