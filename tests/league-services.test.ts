import { describe, expect, it } from "vitest";
import type { LeagueContext, Player } from "../src/lib/types";
import { canonicalizeLeagueSetup, leagueSetupToContext, verifyLeagueSetup } from "../src/lib/services/league-setup";
import { optimizeLineup } from "../src/lib/services/lineup-optimizer";
import { findWaiverAvailablePlayers } from "../src/lib/services/waiver-availability";

const baseSetup = {
  league: { leagueId: "lg-1", name: "Operators", season: 2026, week: 2, teamCount: 2, benchSlots: 2 },
  scoring: { preset: "custom" as const, passing: { passYard: 0.04, passTd: 4, interception: -2 }, receiving: { reception: 1, receivingYard: 0.1, receivingTd: 6 } },
  rosterSlots: [
    { id: "qb", slotType: "QB" as const, slotOrder: 0, eligiblePositions: ["QB" as const] },
    { id: "flex", slotType: "FLEX" as const, slotOrder: 1, eligiblePositions: ["RB" as const, "WR" as const, "TE" as const] },
    { id: "bench", slotType: "BENCH" as const, slotOrder: 2, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DST"] as const, required: false, count: 2 },
  ],
  teams: [{ id: "team-b", name: "Beta" }, { id: "team-a", name: "Alpha" }],
  managers: [{ managerId: "m-2", displayName: "Two" }, { managerId: "m-1", displayName: "One" }],
  managerMappings: [{ teamId: "team-b", managerId: "m-2" }, { teamId: "team-a", managerId: "m-1" }],
  knownPlayerIds: ["p-qb", "p-wr", "p-rb"],
  playerAssignments: [{ playerId: "p-qb", teamId: "team-a" }, { playerId: "p-wr", teamId: "team-a" }],
};

describe("league setup contracts", () => {
  it("canonicalizes a valid setup deterministically and creates a context", () => {
    const first = canonicalizeLeagueSetup(baseSetup);
    const second = canonicalizeLeagueSetup({ ...baseSetup, teams: [...baseSetup.teams].reverse(), managers: [...baseSetup.managers].reverse() });
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.teams.map((team) => team.id)).toEqual(["team-a", "team-b"]);
    expect(first.rosterSlots[0]).toMatchObject({ id: "qb", required: true, count: 1 });
    const context = leagueSetupToContext(first, ["p-qb", "p-rb"]);
    expect(context.rosterPlayerIds).toEqual(["p-qb"]);
    expect(context.availablePlayerIds).toEqual(["p-rb"]);
    expect(context.rosterSlots).toHaveLength(3);
  });

  it("rejects duplicates, unresolved assignments, illegal slots, and missing mappings", () => {
    const result = verifyLeagueSetup({
      ...baseSetup,
      teams: [{ id: "team-a", name: "Alpha" }, { id: "team-a", name: "Alpha" }],
      managerMappings: [{ teamId: "team-a", managerId: "m-1" }],
      playerAssignments: [{ playerId: "unknown", teamId: "team-a" }, { playerId: "unknown", teamId: "team-a" }],
      rosterSlots: [{ id: "bad", slotType: "QB", slotOrder: 0, eligiblePositions: ["WR"] }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "duplicate_team_id", "duplicate_team_name", "unresolved_player", "duplicate_player_assignment", "illegal_slot_positions",
    ]));
  });

  it("rejects unknown scoring keys and manager mappings", () => {
    const result = verifyLeagueSetup({
      ...baseSetup,
      scoring: { custom: 1 },
      managerMappings: [{ teamId: "missing", managerId: "missing" }, { teamId: "team-a", managerId: "m-1" }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === "unrecognized_keys")).toBe(true);
    const mappingResult = verifyLeagueSetup({ ...baseSetup, managerMappings: [{ teamId: "missing", managerId: "missing" }, { teamId: "team-a", managerId: "m-1" }] });
    expect(mappingResult.errors.some((error) => error.code === "unknown_team")).toBe(true);
    expect(mappingResult.errors.some((error) => error.code === "unknown_manager")).toBe(true);
  });
});

const player = (id: string, position: Player["position"], name: string): Player => ({ id, position, fullName: name, team: "TST" });
const snapshot = (points: number) => ({ playerId: "x", season: 2026, week: 2, projectedPoints: points, observedAt: "2026-01-01T00:00:00.000Z" });

describe("lineup and waiver services", () => {
  const league: LeagueContext = {
    leagueId: "lg-1", season: 2026, week: 2, scoring: "ppr", rosterPositions: ["QB", "FLEX", "BENCH"], rosterPlayerIds: [], availablePlayerIds: [],
    rosterSlots: [
      { id: "qb", slotType: "QB", slotOrder: 0, eligiblePositions: ["QB"], required: true },
      { id: "flex", slotType: "FLEX", slotOrder: 1, eligiblePositions: ["RB", "WR", "TE"], required: true },
      { id: "bench", slotType: "BENCH", slotOrder: 2, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DST"], required: false, count: 2 },
    ],
  };

  it("optimizes required slots by projection and reports impossible lineups", () => {
    const result = optimizeLineup({
      league,
      candidates: [
        { player: player("qb", "QB", "Quarterback"), snapshot: snapshot(20) },
        { player: player("wr-high", "WR", "High WR"), snapshot: snapshot(18) },
        { player: player("rb-low", "RB", "Low RB"), snapshot: snapshot(8) },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.assignments.map((assignment) => assignment.playerId)).toEqual(["qb", "wr-high"]);
    expect(result.totalProjectedPoints).toBe(38);

    const impossible = optimizeLineup({ league, candidates: [{ player: player("only-wr", "WR", "Only WR"), snapshot: snapshot(10) }] });
    expect(impossible.valid).toBe(false);
    expect(impossible.unfilledRequiredSlotIds).toContain("qb_1");
  });

  it("returns only verified free agents and records rejection reasons", () => {
    const result = findWaiverAvailablePlayers({
      league: { ...league, availablePlayerIds: ["free", "rostered", "excluded"] },
      players: [player("free", "WR", "Free Agent"), player("rostered", "WR", "Rostered"), player("excluded", "WR", "Excluded"), player("missing", "WR", "Missing")],
      rosteredPlayerIds: ["rostered"],
      excludedPlayerIds: ["excluded"],
    });
    expect(result.available.map((candidate) => candidate.id)).toEqual(["free"]);
    expect(result.rejected).toEqual(expect.arrayContaining([
      { playerId: "rostered", reason: "rostered" },
      { playerId: "excluded", reason: "excluded" },
      { playerId: "missing", reason: "not_in_active_pool" },
    ]));
  });
});
