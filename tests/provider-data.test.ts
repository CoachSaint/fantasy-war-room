import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSleeperWeeklyProjections, sleeper } from "../src/lib/data/sleeper";
import {
  nflverse,
  nflverseReleaseAssetUrl,
  parseDepthCharts,
  parseInjuryReport,
  parsePlayerStats,
  parseLatestAvailablePlayerStats,
  parseYahooCrosswalk,
} from "../src/lib/data/nflverse";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider identity and availability", () => {
  it("keeps only actual weekly projection fields, not ADP-only filler", () => {
    const rows = parseSleeperWeeklyProjections({
      "96": { pts_ppr: 14.09, pts_half_ppr: 14.09, pts_std: 14.09, adp_dd_ppr: 161 },
      "19": { adp_dd_ppr: 1000 },
      invalid: { pts_ppr: 12 },
    }, 2026, 3, "2026-09-24T20:00:00.000Z");
    expect(rows).toEqual([{ sleeperId: "96", season: 2026, week: 3, ppr: 14.09, halfPpr: 14.09, standard: 14.09, observedAt: "2026-09-24T20:00:00.000Z" }]);
  });
  const league = {
    league_id: "league-1",
    name: "Test League",
    season: "2026",
    total_rosters: 2,
    scoring_settings: { rec: 1 },
    roster_positions: ["QB", "RB", "WR"],
    status: "in_season",
  };

  it("fails closed instead of borrowing the first roster", () => {
    const context = sleeper.normalizeRosterToLeagueContext(
      league,
      [
        { roster_id: 1, owner_id: "a", players: ["owned-by-a"], starters: [], reserve: [] },
        { roster_id: 2, owner_id: "b", players: ["owned-by-b"], starters: [], reserve: [] },
      ],
      99,
      {
        activePlayerIds: ["owned-by-a", "owned-by-b", "free-agent", "excluded"],
        excludedPlayerIds: ["excluded"],
        nflState: { week: 4, display_week: 4, season: "2026", season_type: "regular", leg: 1, league_season: "2026" },
      }
    );

    expect(context.rosterPlayerIds).toEqual([]);
    expect(context.availablePlayerIds).toEqual(["free-agent"]);
    expect(context.week).toBe(4);
  });

  it("derives an active pool from player records and excludes every roster slot", () => {
    const context = sleeper.normalizeRosterToLeagueContext(
      league,
      [{ roster_id: 1, owner_id: "a", players: ["p1"], starters: [], reserve: ["p2"] }],
      1,
      {
        players: {
          p1: { player_id: "p1", team: "KC", active: true },
          p2: { player_id: "p2", team: "KC", active: true },
          p3: { player_id: "p3", team: "KC", active: false },
          p4: { player_id: "p4", team: null, active: true },
        },
      }
    );

    expect(context.availablePlayerIds).toEqual([]);
  });
});

describe("nflverse release adapters", () => {
  it("uses release assets rather than the obsolete master tree", () => {
    expect(nflverseReleaseAssetUrl("stats_player", "stats_player_week_2026.csv")).toBe(
      "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv"
    );
  });

  it("filters stats to the requested season/week and preserves actual-vs-projected semantics", () => {
    const snapshots = parsePlayerStats([
      { player_id: "projected", season: 2026, week: 2, projected_points_ppr: 18, fantasy_points_ppr: 12 },
      { player_id: "wrong-week", season: 2026, week: 3, fantasy_points_ppr: 99 },
      { player_id: "actual", season: 2026, week: 2, fantasy_points_ppr: 14 },
      { player_id: "empty", season: 2026, week: 2 },
    ], 2026, 2);

    expect(snapshots.map((snapshot) => snapshot.playerId)).toEqual(["projected", "actual", "empty"]);
    expect(snapshots[0].projectedPoints).toBe(18);
    expect(snapshots[0].actualPoints).toBe(12);
    expect(snapshots[0].projectionSource).toBe("projected");
    expect(snapshots[1].projectionSource).toBe("actual");
    expect(snapshots[1].projectedPoints).toBeUndefined();
    expect(snapshots[1].floor).toBeUndefined();
    expect(snapshots[2].projectedPoints).toBeUndefined();
    expect(snapshots[2].floor).toBeUndefined();
  });

  it("uses the newest published historical stats week without calling actuals projections", () => {
    const selected = parseLatestAvailablePlayerStats([
      { player_id: "p1", player_name: "Player One", season: 2026, week: 1, fantasy_points_ppr: 11 },
      { player_id: "p1", player_name: "Player One", season: 2026, week: 2, fantasy_points_ppr: 17 },
      { player_id: "p1", player_name: "Player One", season: 2026, week: 4, fantasy_points_ppr: 22 },
    ], 2026, 3);
    expect(selected.week).toBe(2);
    expect(selected.snapshots).toHaveLength(1);
    expect(selected.snapshots[0].actualPoints).toBe(17);
    expect(selected.snapshots[0].projectedPoints).toBeUndefined();
  });

  it("joins Yahoo and GSIS IDs only from an unambiguous current roster week", () => {
    const crosswalk = parseYahooCrosswalk([
      { season: 2026, week: 2, game_type: "REG", yahoo_id: "10", gsis_id: "00-0000010" },
      { season: 2026, week: 3, game_type: "REG", yahoo_id: "10", sleeper_id: "510", gsis_id: "00-0000010" },
      { season: 2026, week: 3, game_type: "REG", yahoo_id: "20", gsis_id: "00-0000020" },
      { season: 2026, week: 3, game_type: "REG", yahoo_id: "20", gsis_id: "00-0000099" },
      { season: 2026, week: 3, game_type: "REG", yahoo_id: "40", gsis_id: "00-0000040" },
      { season: 2026, week: 3, game_type: "REG", yahoo_id: "41", gsis_id: "00-0000040" },
      { season: 2026, week: 4, game_type: "REG", yahoo_id: "30", gsis_id: "00-0000030" },
    ], 2026, 3);
    expect(crosswalk.week).toBe(3);
    expect([...crosswalk.ids]).toEqual([["10", "00-0000010"]]);
    expect([...crosswalk.sleeperIds]).toEqual([["510", "00-0000010"]]);
  });

  it("retains depth order and practice participation in evidence", () => {
    const depth = parseDepthCharts([
      { player_id: "p1", full_name: "Starter", team: "KC", depth_position: "WR", depth_team: 1, season: 2026, week: 2 },
      { player_id: "p2", full_name: "Other Week", team: "KC", depth_position: "WR", depth_team: 2, season: 2026, week: 3 },
    ], 2026, 2);
    const injury = parseInjuryReport([
      { player_id: "p1", full_name: "Starter", team: "KC", report_status: "Questionable", report_primary_injury: "Ankle", practice_status: "Limited", season: 2026, week: 2 },
    ], 2026, 2);

    expect(depth).toHaveLength(1);
    expect(depth[0].summary).toContain("WR1");
    expect(depth[0].fingerprint).toContain("d1");
    expect(injury[0].summary).toContain("Practice participation: Limited");
    expect(injury[0].sourceUrl).toContain("releases/download/injuries/");
  });

  it("normalizes the official dated depth schema and keeps only its latest snapshot", () => {
    const depth = parseDepthCharts([
      { gsis_id: "p1", player_name: "Starter", team: "KC", pos_abb: "WR", pos_rank: 2, dt: "2026-08-10" },
      { gsis_id: "p1", player_name: "Starter", team: "KC", pos_abb: "WR", pos_rank: 1, dt: "2026-08-17" },
      { gsis_id: "p2", player_name: "Older", team: "KC", pos_abb: "WR", pos_rank: 2, dt: "2026-08-10" },
    ], 2026, 2);

    expect(depth).toHaveLength(1);
    expect(depth[0].summary).toContain("WR1");
    expect(depth[0].summary).toContain("2026-08-17");
    expect(depth[0].publishedAt).toBe("2026-08-17T00:00:00.000Z");
  });

  it("degrades to an empty result on an unavailable release without demo substitution", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    await expect(nflverse.getPlayerSnapshots({ season: 2026, week: 2 })).resolves.toEqual([]);
  });
});
