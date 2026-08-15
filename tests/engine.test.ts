import { describe, expect, it } from "vitest";
import { sleeper } from "../src/lib/data/sleeper";
import { parseDepthCharts, parseInjuryReport, parsePlayerStats } from "../src/lib/data/nflverse";
import { deduplicate, extractEvidence, type RawNewsArticle } from "../src/lib/data/news";
import { calculateFeatureVector, startScore, waiverScore } from "../src/lib/engine/score";

describe("Sleeper Normalization & Client", () => {
  it("normalizes raw Sleeper player into internal Player object", () => {
    const raw = {
      player_id: "4034",
      full_name: "Christian McCaffrey",
      position: "RB",
      team: "SF",
      injury_status: "Questionable",
      bye_week: 9,
    };
    const player = sleeper.normalizePlayer("4034", raw);
    expect(player.id).toBe("sleeper_4034");
    expect(player.fullName).toBe("Christian McCaffrey");
    expect(player.position).toBe("RB");
    expect(player.status).toBe("Questionable");
    expect(player.byeWeek).toBe(9);
  });
});

describe("nflverse Ingestion Engine", () => {
  it("parses raw stats into PlayerSnapshots", () => {
    const rawStats = [
      {
        player_id: "nfl-jj",
        week: 1,
        season: 2026,
        fantasy_points_ppr: 19.8,
        projected_points_ppr: 19.8,
        snap_share: 0.94,
        target_share: 0.29,
      },
    ];
    const snapshots = parsePlayerStats(rawStats, 2026, 1);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].projectedPoints).toBe(19.8);
    expect(snapshots[0].targetShare).toBe(29);
    expect(snapshots[0].snapShare).toBe(94);
  });

  it("parses raw depth charts and injury reports into Evidence", () => {
    const depthData = [{ player_id: "p-1", full_name: "Justin Jefferson", team: "MIN", depth_position: "WR", depth_team: 1, season: 2026, week: 1 }];
    const depthEv = parseDepthCharts(depthData, 2026, 1);
    expect(depthEv[0].type).toBe("depth_chart");
    expect(depthEv[0].confidence).toBe(0.9);

    const injData = [{ player_id: "p-2", full_name: "CMC", team: "SF", report_status: "Out", report_primary_injury: "Calf", season: 2026, week: 1 }];
    const injEv = parseInjuryReport(injData, 2026, 1);
    expect(injEv[0].type).toBe("injury");
    expect(injEv[0].confidence).toBe(0.95);
  });
});

describe("News Intelligence & Conflict Resolution", () => {
  it("extracts evidence and deduplicates identical fingerprints", () => {
    const articles: RawNewsArticle[] = [
      {
        title: "Jefferson dominates targets",
        summary: "Justin Jefferson commanded a 30% target share in practice.",
        source: "Beat Writer A",
        url: "https://example.com/1",
        publishedAt: new Date().toISOString(),
        playerId: "p-jj",
        confidence: 0.9,
      },
      {
        title: "Jefferson dominates targets",
        summary: "Justin Jefferson commanded a 30% target share in practice.",
        source: "Syndicated Feed",
        url: "https://example.com/2",
        publishedAt: new Date().toISOString(),
        playerId: "p-jj",
        confidence: 0.8,
      },
    ];

    const evidence = extractEvidence(articles);
    const deduped = deduplicate(evidence);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].confidence).toBe(0.9);
  });

  it("lowers confidence when conflicting injury status reports exist for a player", () => {
    const articles: RawNewsArticle[] = [
      {
        title: "CMC ruled Out",
        summary: "McCaffrey is officially Out for Sunday.",
        source: "Source A",
        url: "https://example.com/a",
        publishedAt: new Date().toISOString(),
        playerId: "p-cmc",
        category: "injury",
        confidence: 0.9,
      },
      {
        title: "CMC Active",
        summary: "McCaffrey is Active and expected to play full workload.",
        source: "Source B",
        url: "https://example.com/b",
        publishedAt: new Date().toISOString(),
        playerId: "p-cmc",
        category: "injury",
        confidence: 0.9,
      },
    ];

    const evidence = extractEvidence(articles);
    const deduped = deduplicate(evidence);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].confidence).toBeLessThan(0.9);
    expect(deduped[1].confidence).toBeLessThan(0.9);
  });
});

describe("End-to-End Decision Pipeline Verification", () => {
  it("evaluates a complete player dataset into deterministic start and waiver scores", () => {
    const player = sleeper.normalizePlayer("101", {
      player_id: "101",
      full_name: "Isaiah Likely",
      position: "TE",
      team: "BAL",
    });

    const snapshots = parsePlayerStats([
      {
        player_id: "101",
        week: 1,
        season: 2026,
        fantasy_points_ppr: 15.4,
        projected_points_ppr: 15.4,
        snap_share: 0.78,
        target_share: 0.24,
      },
    ], 2026, 1);

    const fv = calculateFeatureVector({
      player,
      snapshot: snapshots[0],
      evidence: [],
    });

    const start = startScore(fv);
    const waiver = waiverScore(fv);

    expect(start).toBeGreaterThan(60);
    expect(waiver).toBeGreaterThan(60);
  });
});
