import type { Position } from "@/lib/types";

export const DRAFT_SIMULATOR_VERSION = "draft-survival-v1";

export interface DraftSimulationPlayer {
  playerId: string;
  position: Position;
  adp: number;
  projection?: number;
}

export interface DraftSimulationHorizon {
  unit: "picks" | "rounds";
  count: 1 | 2 | 3;
}

export interface DraftSimulationInput {
  players: DraftSimulationPlayer[];
  seed: string | number;
  currentOverallPick: number;
  teamCount: number;
  horizon: DraftSimulationHorizon;
  simulations?: number;
  targetPlayerIds?: string[];
  /** Optional opponent positional pressure, expressed from 0 to 100. */
  opponentNeed?: Partial<Record<Position, number>>;
}

export interface DraftSurvivalPlayerResult {
  playerId: string;
  position: Position;
  adp: number;
  survivalProbability: number;
  expectedSelectionOverall: number | null;
  selectionProbability: number;
}

export interface DraftSimulationResult {
  version: string;
  seed: string;
  simulations: number;
  horizon: DraftSimulationHorizon;
  simulatedPicks: number;
  players: DraftSurvivalPlayerResult[];
}

export class DraftSimulationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftSimulationValidationError";
  }
}

function seedNumber(seed: string | number): number {
  if (typeof seed === "number") {
    if (!Number.isFinite(seed)) throw new DraftSimulationValidationError("seed must be finite");
    return seed >>> 0;
  }
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomGenerator(seed: number): () => number {
  let state = seed || 0x9e3779b9;
  return () => {
    state = Math.imul(state ^ (state >>> 16), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    return ((state ^= state >>> 16) >>> 0) / 4294967296;
  };
}

function boundedNeed(value: number | undefined): number {
  const normalized = value ?? 0;
  return Math.max(0, Math.min(100, normalized));
}

function selectionWeight(player: DraftSimulationPlayer, overallPick: number, opponentNeed: Partial<Record<Position, number>>): number {
  const adpPressure = Math.max(-6, Math.min(6, (overallPick - player.adp) / 18));
  const needPressure = boundedNeed(opponentNeed[player.position]) / 100;
  const projectionPressure = player.projection == null || !Number.isFinite(player.projection)
    ? 1
    : 1 + Math.max(0, Math.min(100, player.projection)) / 500;
  return Math.exp(adpPressure) * (0.85 + needPressure * 0.5) * projectionPressure;
}

function chooseIndex(players: DraftSimulationPlayer[], overallPick: number, need: Partial<Record<Position, number>>, random: () => number): number {
  const weights = players.map((player) => selectionWeight(player, overallPick, need));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = random() * total;
  for (let index = 0; index < players.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return index;
  }
  return players.length - 1;
}

function validateInput(input: DraftSimulationInput): void {
  if (!Number.isInteger(input.currentOverallPick) || input.currentOverallPick < 1) throw new DraftSimulationValidationError("currentOverallPick must be a positive integer");
  if (!Number.isInteger(input.teamCount) || input.teamCount < 2 || input.teamCount > 32) throw new DraftSimulationValidationError("teamCount must be between 2 and 32");
  if (!input.horizon || ![1, 2, 3].includes(input.horizon.count) || !["picks", "rounds"].includes(input.horizon.unit)) throw new DraftSimulationValidationError("horizon must be 1 to 3 picks or rounds");
  const simulations = input.simulations ?? 1000;
  if (!Number.isInteger(simulations) || simulations < 1 || simulations > 10_000) throw new DraftSimulationValidationError("simulations must be between 1 and 10000");
  if (!input.players.length) throw new DraftSimulationValidationError("at least one player is required");
  const ids = new Set<string>();
  for (const player of input.players) {
    if (!player.playerId || ids.has(player.playerId)) throw new DraftSimulationValidationError(`duplicate or empty player id: ${player.playerId}`);
    if (!Number.isFinite(player.adp) || player.adp < 1) throw new DraftSimulationValidationError(`invalid ADP for ${player.playerId}`);
    ids.add(player.playerId);
  }
}

/** Simulate only a bounded horizon; input arrays and objects are never mutated. */
export function simulateDraftSurvival(input: DraftSimulationInput): DraftSimulationResult {
  validateInput(input);
  const simulations = input.simulations ?? 1000;
  const simulatedPicks = input.horizon.unit === "picks" ? input.horizon.count : input.horizon.count * input.teamCount;
  const players = [...input.players].sort((a, b) => a.adp - b.adp || a.playerId.localeCompare(b.playerId));
  const targets = new Set(input.targetPlayerIds || players.map((player) => player.playerId));
  for (const target of targets) if (!players.some((player) => player.playerId === target)) throw new DraftSimulationValidationError(`unknown target player: ${target}`);
  const survivorCounts = new Map(players.map((player) => [player.playerId, 0]));
  const selectionCounts = new Map(players.map((player) => [player.playerId, 0]));
  const selectionSums = new Map(players.map((player) => [player.playerId, 0]));

  for (let simulation = 0; simulation < simulations; simulation += 1) {
    const random = randomGenerator((seedNumber(input.seed) + simulation * 0x9e3779b9) >>> 0);
    const available = [...players];
    const selectedAt = new Map<string, number>();
    for (let pick = 0; pick < simulatedPicks && available.length; pick += 1) {
      const index = chooseIndex(available, input.currentOverallPick + pick + 1, input.opponentNeed || {}, random);
      const [selected] = available.splice(index, 1);
      selectedAt.set(selected.playerId, input.currentOverallPick + pick + 1);
    }
    for (const player of players) {
      if (!targets.has(player.playerId)) continue;
      const selection = selectedAt.get(player.playerId);
      if (selection == null) survivorCounts.set(player.playerId, (survivorCounts.get(player.playerId) || 0) + 1);
      else {
        selectionCounts.set(player.playerId, (selectionCounts.get(player.playerId) || 0) + 1);
        selectionSums.set(player.playerId, (selectionSums.get(player.playerId) || 0) + selection);
      }
    }
  }

  return {
    version: DRAFT_SIMULATOR_VERSION,
    seed: String(input.seed),
    simulations,
    horizon: { ...input.horizon },
    simulatedPicks,
    players: players.filter((player) => targets.has(player.playerId)).map((player) => {
      const selected = selectionCounts.get(player.playerId) || 0;
      return {
        playerId: player.playerId,
        position: player.position,
        adp: player.adp,
        survivalProbability: Number(((survivorCounts.get(player.playerId) || 0) / simulations).toFixed(6)),
        expectedSelectionOverall: selected ? Number(((selectionSums.get(player.playerId) || 0) / selected).toFixed(3)) : null,
        selectionProbability: Number((selected / simulations).toFixed(6)),
      };
    }),
  };
}
