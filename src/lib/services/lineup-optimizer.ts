import type { LeagueContext, Player, PlayerSnapshot, Position, RosterSlotDefinition, RosterSlotType } from "@/lib/types";

export interface LineupCandidate {
  player: Player;
  snapshot?: PlayerSnapshot;
  locked?: boolean;
}

export interface LineupOptimizationInput {
  league: LeagueContext;
  candidates: LineupCandidate[];
  lockedPlayerIds?: string[];
  excludedPlayerIds?: string[];
}

export interface LineupAssignment {
  playerId: string;
  slotId: string;
  slotType: RosterSlotType;
  points: number;
}

export interface LineupOptimizationResult {
  valid: boolean;
  assignments: LineupAssignment[];
  benchPlayerIds: string[];
  unfilledRequiredSlotIds: string[];
  totalProjectedPoints: number;
  errors: string[];
}

const directPositions: Record<string, Position[]> = {
  QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"], DST: ["DST"],
  FLEX: ["RB", "WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  WR_RB: ["WR", "RB"], WR_TE: ["WR", "TE"],
  BENCH: ["QB", "RB", "WR", "TE", "K", "DST"],
  IR: ["QB", "RB", "WR", "TE", "K", "DST"],
  TAXI: ["QB", "RB", "WR", "TE", "K", "DST"],
};

function slotsForLeague(context: LeagueContext): RosterSlotDefinition[] {
  if (context.rosterSlots?.length) {
    return context.rosterSlots.flatMap((slot, index) => Array.from({ length: Math.max(1, slot.count ?? 1) }, (_, count) => ({
      ...slot,
      id: `${slot.id || `slot_${index + 1}`}_${count + 1}`,
      slotOrder: slot.slotOrder + count,
    })));
  }
  return context.rosterPositions.map((slotType, index) => {
    const normalized = String(slotType).toUpperCase() as RosterSlotType;
    return {
      id: `slot_${index + 1}`,
      slotType: normalized,
      slotOrder: index,
      eligiblePositions: directPositions[normalized] || [],
      required: !["BENCH", "IR", "TAXI"].includes(normalized),
      count: 1,
    };
  });
}

function points(candidate: LineupCandidate): number {
  const snapshot = candidate.snapshot;
  const value = snapshot?.expectedFantasyPoints
    ?? snapshot?.projectedFantasyPoints
    ?? snapshot?.projectedPoints
    ?? snapshot?.values?.expected
    ?? snapshot?.values?.projected;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function eligible(candidate: LineupCandidate, slot: RosterSlotDefinition): boolean {
  const allowed = slot.eligiblePositions.length ? slot.eligiblePositions : directPositions[slot.slotType] || [];
  return allowed.includes(candidate.player.position);
}

function assignmentKey(assignments: Map<number, number>, slots: RosterSlotDefinition[], candidates: LineupCandidate[]): string {
  return slots.map((_, index) => {
    const candidateIndex = assignments.get(index);
    return candidateIndex == null ? "~" : candidates[candidateIndex].player.id;
  }).join("|");
}

export function optimizeLineup(input: LineupOptimizationInput): LineupOptimizationResult {
  const errors: string[] = [];
  const excluded = new Set(input.excludedPlayerIds || []);
  const seen = new Set<string>();
  const candidates = input.candidates
    .filter((candidate) => {
      if (excluded.has(candidate.player.id)) return false;
      if (seen.has(candidate.player.id)) {
        errors.push(`duplicate candidate: ${candidate.player.id}`);
        return false;
      }
      seen.add(candidate.player.id);
      return true;
    })
    .sort((a, b) => a.player.id.localeCompare(b.player.id));
  const locked = new Set(input.lockedPlayerIds || candidates.filter((candidate) => candidate.locked).map((candidate) => candidate.player.id));
  const slots = slotsForLeague(input.league).sort((a, b) => a.slotOrder - b.slotOrder || String(a.id).localeCompare(String(b.id)));
  const startingSlots = slots.filter((slot) => slot.required !== false && !["BENCH", "IR", "TAXI"].includes(slot.slotType));
  const requiredSlotIds = startingSlots.map((slot) => String(slot.id));
  if (errors.length) return { valid: false, assignments: [], benchPlayerIds: [], unfilledRequiredSlotIds: requiredSlotIds, totalProjectedPoints: 0, errors };

  let bestScore = Number.NEGATIVE_INFINITY;
  let bestKey = "";
  let bestAssignments = new Map<number, number>();
  const visit = (slotIndex: number, used: Set<number>, assignment: Map<number, number>, score: number): void => {
    if (slotIndex >= startingSlots.length) {
      const key = assignmentKey(assignment, startingSlots, candidates);
      if (score > bestScore || (score === bestScore && (bestKey === "" || key < bestKey))) {
        bestScore = score;
        bestKey = key;
        bestAssignments = new Map(assignment);
      }
      return;
    }
    const slot = startingSlots[slotIndex];
    const eligibleCandidates = candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate, index }) => !used.has(index) && eligible(candidate, slot))
      .sort((a, b) => Number(locked.has(b.candidate.player.id)) - Number(locked.has(a.candidate.player.id)) || points(b.candidate) - points(a.candidate) || a.candidate.player.id.localeCompare(b.candidate.player.id));
    for (const { candidate, index } of eligibleCandidates) {
      used.add(index);
      assignment.set(slotIndex, index);
      visit(slotIndex + 1, used, assignment, score + points(candidate));
      assignment.delete(slotIndex);
      used.delete(index);
    }
    if (slot.required === false) visit(slotIndex + 1, used, assignment, score);
  };
  visit(0, new Set(), new Map(), 0);

  const assignments: LineupAssignment[] = [];
  const used = new Set<number>();
  bestAssignments.forEach((candidateIndex, slotIndex) => {
    used.add(candidateIndex);
    const slot = startingSlots[slotIndex];
    assignments.push({ playerId: candidates[candidateIndex].player.id, slotId: String(slot.id), slotType: slot.slotType, points: points(candidates[candidateIndex]) });
  });
  assignments.sort((a, b) => startingSlots.findIndex((slot) => String(slot.id) === a.slotId) - startingSlots.findIndex((slot) => String(slot.id) === b.slotId));
  const unfilledRequiredSlotIds = requiredSlotIds.filter((slotId) => !assignments.some((assignment) => assignment.slotId === slotId));
  const benchSlots = slots.filter((slot) => ["BENCH", "IR", "TAXI"].includes(slot.slotType));
  const benchPlayerIds: string[] = [];
  for (const candidate of candidates) {
    const candidateIndex = candidates.indexOf(candidate);
    if (used.has(candidateIndex)) continue;
    const benchSlot = benchSlots.find((slot) => eligible(candidate, slot));
    if (!benchSlot) continue;
    benchPlayerIds.push(candidate.player.id);
    if (benchPlayerIds.length >= benchSlots.reduce((sum, slot) => sum + Math.max(1, slot.count ?? 1), 0)) break;
  }
  return {
    valid: errors.length === 0 && unfilledRequiredSlotIds.length === 0,
    assignments,
    benchPlayerIds,
    unfilledRequiredSlotIds,
    totalProjectedPoints: assignments.reduce((sum, assignment) => sum + assignment.points, 0),
    errors,
  };
}
