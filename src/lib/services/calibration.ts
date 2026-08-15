export const CALIBRATION_VERSION = "calibration-v1";

export interface CalibrationObservation {
  id?: string;
  predicted: number;
  actual: number;
  probability?: number;
  outcome?: 0 | 1 | boolean;
  intervalLower?: number;
  intervalUpper?: number;
  predictedRank?: number;
  actualRank?: number;
}

export interface CalibrationMetric {
  value: number | null;
  sampleSize: number;
}

export interface CalibrationResult {
  version: string;
  sampleSize: number;
  mae: CalibrationMetric;
  rmse: CalibrationMetric;
  brier: CalibrationMetric;
  intervalCoverage: CalibrationMetric;
  rankCorrelation: CalibrationMetric;
}

export class CalibrationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationValidationError";
  }
}

function finite(value: number | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function rank(values: number[]): number[] {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index);
  const result = Array.from({ length: values.length }, () => 0);
  let start = 0;
  while (start < sorted.length) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1;
    const average = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) result[sorted[index].index] = average;
    start = end;
  }
  return result;
}

function correlation(left: number[], right: number[]): number | null {
  if (left.length < 2 || left.length !== right.length) return null;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] - leftMean;
    const b = right[index] - rightMean;
    numerator += a * b;
    leftVariance += a * a;
    rightVariance += b * b;
  }
  if (leftVariance === 0 || rightVariance === 0) return null;
  return numerator / Math.sqrt(leftVariance * rightVariance);
}

function metric(value: number | null, sampleSize: number): CalibrationMetric {
  return { value: value == null ? null : Number(value.toFixed(6)), sampleSize };
}

function validate(observations: CalibrationObservation[]): void {
  if (!Array.isArray(observations)) throw new CalibrationValidationError("observations must be an array");
  observations.forEach((observation, index) => {
    if (!finite(observation.predicted) || !finite(observation.actual)) throw new CalibrationValidationError(`predicted and actual must be finite at observation ${index}`);
    if (observation.probability != null && (!finite(observation.probability) || observation.probability < 0 || observation.probability > 1)) throw new CalibrationValidationError(`probability must be between 0 and 1 at observation ${index}`);
    if ((observation.intervalLower != null && !finite(observation.intervalLower)) || (observation.intervalUpper != null && !finite(observation.intervalUpper))) throw new CalibrationValidationError(`interval bounds must be finite at observation ${index}`);
    if (observation.intervalLower != null && observation.intervalUpper != null && observation.intervalLower > observation.intervalUpper) throw new CalibrationValidationError(`interval lower bound exceeds upper bound at observation ${index}`);
    if (observation.outcome != null && observation.outcome !== true && observation.outcome !== false && observation.outcome !== 0 && observation.outcome !== 1) throw new CalibrationValidationError(`outcome must be binary at observation ${index}`);
  });
}

/** Compute calibration without mutating or sorting the caller's observations. */
export function calculateCalibration(observations: readonly CalibrationObservation[]): CalibrationResult {
  const copied = observations.map((observation) => ({ ...observation }));
  validate(copied);
  const errors = copied.map((observation) => Math.abs(observation.predicted - observation.actual));
  const squaredErrors = copied.map((observation) => (observation.predicted - observation.actual) ** 2);
  const brierRows = copied.filter((observation) => observation.probability != null && observation.outcome != null);
  const intervalRows = copied.filter((observation) => observation.intervalLower != null && observation.intervalUpper != null);
  const rankRows = copied.filter((observation) => finite(observation.predictedRank) && finite(observation.actualRank));
  const predictedRanks = rankRows.length ? rankRows.map((observation) => observation.predictedRank as number) : copied.map((observation) => observation.predicted);
  const actualRanks = rankRows.length ? rankRows.map((observation) => observation.actualRank as number) : copied.map((observation) => observation.actual);
  const brier = brierRows.length
    ? brierRows.reduce((sum, observation) => sum + (observation.probability! - (observation.outcome === true || observation.outcome === 1 ? 1 : 0)) ** 2, 0) / brierRows.length
    : null;
  const coverage = intervalRows.length
    ? intervalRows.filter((observation) => observation.actual >= observation.intervalLower! && observation.actual <= observation.intervalUpper!).length / intervalRows.length
    : null;
  return {
    version: CALIBRATION_VERSION,
    sampleSize: copied.length,
    mae: metric(errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null, errors.length),
    rmse: metric(squaredErrors.length ? Math.sqrt(squaredErrors.reduce((sum, value) => sum + value, 0) / squaredErrors.length) : null, squaredErrors.length),
    brier: metric(brier, brierRows.length),
    intervalCoverage: metric(coverage, intervalRows.length),
    rankCorrelation: metric(correlation(rank(predictedRanks), rank(actualRanks)), predictedRanks.length),
  };
}
