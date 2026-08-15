import { describe, expect, it } from "vitest";
import {
  calculateFeatureVector,
  calculateReplacementLevel,
  canFillRosterSlots,
  countEligibleStartingSlots,
  isPlayerEligibleForSlot,
} from "../src/lib/engine/score";
import type { LeagueContext, Player } from "../src/lib/types";

const context: LeagueContext = {
  leagueId: "league-1",
  season: 2026,
  week: 1,
  scoring: {
    preset: "custom",
    receiving: { reception: 0.5, receivingYard: 0.1, receivingTd: 6 },
  },
  rosterPositions: [],
  rosterSlots: [
    { slotType: "QB", slotOrder: 0, eligiblePositions: ["QB"] },
    { slotType: "RB", slotOrder: 1, eligiblePositions: ["RB"] },
    { slotType: "WR", slotOrder: 2, eligiblePositions: ["WR"] },
    { slotType: "FLEX", slotOrder: 3, eligiblePositions: ["RB", "WR", "TE"] },
    { slotType: "BENCH", slotOrder: 4, eligiblePositions: ["QB", "RB", "WR", "TE"] },
  ],
  rosterPlayerIds: [],
  availablePlayerIds: [],
  teamCount: 10,
};

const player = (id: string, position: Player["position"]): Player => ({
  id,
  fullName: id,
  position,
});

describe("V2 canonical values and roster feasibility", () => {
  it("uses expected/projected values and never actual-only points as a projection", () => {
    const actualOnly = calculateFeatureVector({
      player: player("rb-1", "RB"),
      snapshot: {
        playerId: "rb-1",
        season: 2026,
        week: 1,
        actualFantasyPoints: 30,
        observedAt: "2026-09-13T12:00:00.000Z",
      },
      asOf: "2026-09-13T13:00:00.000Z",
    });
    const expected = calculateFeatureVector({
      player: player("rb-1", "RB"),
      snapshot: {
        playerId: "rb-1",
        season: 2026,
        week: 1,
        actualFantasyPoints: 30,
        expectedFantasyPoints: 17,
        observedAt: "2026-09-13T12:00:00.000Z",
      },
      asOf: "2026-09-13T13:00:00.000Z",
    });
    expect(actualOnly.projection).toBe(Math.round(8.5 * 4));
    expect(expected.projection).toBe(68);
  });

  it("calculates replacement rank from actual starter slots and team count", () => {
    expect(countEligibleStartingSlots("RB", context)).toBe(2);
    const candidates = Array.from({ length: 20 }, (_, index) => ({
      player: player(`rb-${index}`, "RB"),
      value: 20 - index,
    }));
    const result = calculateReplacementLevel({ position: "RB", leagueContext: context, candidates });
    expect(result.rank).toBe(20);
    expect(result.baseline).toBe(1);
  });

  it("matches players to slots without consuming a flex-eligible player too early", () => {
    const slots = context.rosterSlots!;
    expect(isPlayerEligibleForSlot(player("te-1", "TE"), slots[3])).toBe(true);
    expect(canFillRosterSlots([
      player("rb-1", "RB"),
      player("wr-1", "WR"),
      player("te-1", "TE"),
      player("qb-1", "QB"),
    ], context)).toBe(true);
    expect(canFillRosterSlots([
      player("rb-1", "RB"),
      player("qb-1", "QB"),
    ], context)).toBe(false);
  });
});
