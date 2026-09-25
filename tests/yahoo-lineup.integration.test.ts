import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { materializeYahooLineupForLeague } from "../src/lib/services/yahoo-lineup";
import { materializeDailyBriefForLeague } from "../src/lib/services/daily-brief";
import { GET as getBrief } from "../src/app/api/brief/route";
import { GET as getRecommendations } from "../src/app/api/recommendations/route";

const live = process.env.FWR_LIVE_TEST === "1";
const sourceUrl = "https://api.sleeper.app/v1/projections/nfl/regular/2026/3";

function checked(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`${label}: ${error.message}`);
}

describe("Yahoo lineup hosted database integration", () => {
  it.skipIf(!live)("writes one owner-scoped source-backed swap and replaces it on rerun", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url) throw new Error("live_fixture_url_missing");
    if (!serviceKey) throw new Error("live_fixture_service_key_missing");
    if (!anonKey) throw new Error("live_fixture_anon_key_missing");
    if (new URL(url).hostname !== "fswsefqqlltmaktiqwge.supabase.co") throw new Error("live_fixture_project_guard_failed");
    const client = createClient(url, serviceKey, { auth: { persistSession: false } });
    const runId = randomUUID();
    const workspaceId = randomUUID();
    const leagueId = randomUUID();
    const rosterId = randomUUID();
    const starterId = randomUUID();
    const benchId = randomUUID();
    const starterEvidenceId = randomUUID();
    const benchEvidenceId = randomUUID();
    const asOf = new Date();
    let userId: string | null = null;
    let outsiderId: string | null = null;
    const password = `${runId}Aa!`;
    const ownerEmail = `fwr-lineup-${runId}@example.com`;
    const outsiderEmail = `fwr-outsider-${runId}@example.com`;
    try {
      const user = await client.auth.admin.createUser({
        email: ownerEmail, password,
        email_confirm: true,
      });
      checked("create disposable user", user.error);
      if (!user.data.user) throw new Error("disposable_user_missing");
      userId = user.data.user.id;
      const outsider = await client.auth.admin.createUser({ email: outsiderEmail, password, email_confirm: true });
      checked("create disposable outsider", outsider.error);
      if (!outsider.data.user) throw new Error("disposable_outsider_missing");
      outsiderId = outsider.data.user.id;

      checked("insert workspace", (await client.from("workspaces").insert({
        id: workspaceId, name: "Disposable lineup fixture", created_by: userId,
      })).error);
      checked("insert league", (await client.from("leagues").insert({
        id: leagueId, workspace_id: workspaceId, owner_id: userId, provider: "yahoo", provider_league_id: `fixture-${runId}`,
        name: "Disposable lineup integration fixture", season: 2026, current_week: 3,
        scoring: { statModifiers: { "9": 0.1, "10": 6 } },
      })).error);
      checked("insert roster", (await client.from("rosters").insert({
        id: rosterId, league_id: leagueId, owner_user_id: userId, provider_roster_id: `fixture-${runId}`,
      })).error);
      checked("insert membership", (await client.from("league_memberships").insert({
        league_id: leagueId, user_id: userId, roster_id: rosterId,
      })).error);
      checked("insert players", (await client.from("players").insert([
        { id: starterId, canonical_key: `fixture:${runId}:starter`, full_name: "Fixture Starter", position: "RB", status: "Active" },
        { id: benchId, canonical_key: `fixture:${runId}:bench`, full_name: "Fixture Bench", position: "RB", status: "Active" },
      ])).error);
      checked("insert assignments", (await client.from("roster_assignments").insert([
        { league_id: leagueId, roster_id: rosterId, player_id: starterId, designation: "starter" },
        { league_id: leagueId, roster_id: rosterId, player_id: benchId, designation: "bench" },
      ])).error);

      checked("insert projection snapshots", (await client.from("player_snapshots").insert([
        { player_id: starterId, season: 2026, week: 3, source: "sleeper_weekly_projections", fingerprint: `${runId}-starter`, observed_at: asOf.toISOString(), data: { providerPlayerId: "fixture-starter", projectedStats: { rush_yd: 50, rush_td: 0 } } },
        { player_id: benchId, season: 2026, week: 3, source: "sleeper_weekly_projections", fingerprint: `${runId}-bench`, observed_at: asOf.toISOString(), data: { providerPlayerId: "fixture-bench", projectedStats: { rush_yd: 100, rush_td: 0 } } },
      ])).error);
      checked("insert source evidence", (await client.from("evidence").insert([
        { id: starterEvidenceId, player_id: starterId, type: "projection", source: "sleeper_weekly_projections", source_url: sourceUrl, summary: "Disposable control fixture", confidence: 100, observed_at: asOf.toISOString(), fingerprint: `${runId}-starter-evidence` },
        { id: benchEvidenceId, player_id: benchId, type: "projection", source: "sleeper_weekly_projections", source_url: sourceUrl, summary: "Disposable control fixture", confidence: 100, observed_at: asOf.toISOString(), fingerprint: `${runId}-bench-evidence` },
      ])).error);

      const baseline = await materializeDailyBriefForLeague(client, leagueId, new Date(asOf.getTime() + 500));
      expect(baseline).toMatchObject({ briefsWritten: 1, changesFound: 0, baselinesFound: 0 });
      const first = await materializeYahooLineupForLeague(client, leagueId, new Date(asOf.getTime() + 1000));
      expect(first).toMatchObject({ status: "complete", playersScored: 2, recommendationsInserted: 1 });
      const firstBrief = await materializeDailyBriefForLeague(client, leagueId, new Date(asOf.getTime() + 1500));
      expect(firstBrief).toMatchObject({ briefsWritten: 1, changesFound: 1, baselinesFound: 1 });
      const second = await materializeYahooLineupForLeague(client, leagueId, new Date(asOf.getTime() + 2000));
      expect(second).toMatchObject({ status: "complete", playersScored: 2, recommendationsInserted: 1 });
      const secondBrief = await materializeDailyBriefForLeague(client, leagueId, new Date(asOf.getTime() + 2500));
      expect(secondBrief).toMatchObject({ briefsWritten: 1, changesFound: 0, baselinesFound: 1 });
      const rows = await client.from("recommendations")
        .select("user_id, roster_id, subject_player_id, alternative_player_id, evidence_ids, payload")
        .eq("league_id", leagueId);
      checked("read recommendations", rows.error);
      expect(rows.data).toHaveLength(1);
      expect(rows.data?.[0]).toMatchObject({
        user_id: userId, roster_id: rosterId, subject_player_id: benchId, alternative_player_id: starterId,
        payload: { projectedPoints: { recommended: 10, current: 5 } },
      });
      expect(rows.data?.[0]?.evidence_ids).toEqual([benchEvidenceId, starterEvidenceId]);
      const briefs = await client.from("daily_briefs").select("payload").eq("league_id", leagueId)
        .order("computed_at", { ascending: false }).limit(1);
      checked("read daily brief", briefs.error);
      expect(briefs.data?.[0]?.payload).toMatchObject({ baseline: { status: "available" }, changes: [] });

      const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });
      const ownerLogin = await anonClient.auth.signInWithPassword({ email: ownerEmail, password });
      checked("owner sign-in", ownerLogin.error);
      const ownerToken = ownerLogin.data.session?.access_token;
      if (!ownerToken) throw new Error("owner_token_missing");
      const outsiderLogin = await anonClient.auth.signInWithPassword({ email: outsiderEmail, password });
      checked("outsider sign-in", outsiderLogin.error);
      const outsiderToken = outsiderLogin.data.session?.access_token;
      if (!outsiderToken) throw new Error("outsider_token_missing");
      const briefUrl = `http://localhost:3000/api/brief?leagueId=${leagueId}`;
      const ownerBrief = await getBrief(new Request(briefUrl, { headers: { authorization: `Bearer ${ownerToken}` } }));
      expect(ownerBrief.status).toBe(200);
      expect(await ownerBrief.json()).toMatchObject({ status: "ready", data: { leagueId } });
      expect((await getBrief(new Request(briefUrl, { headers: { authorization: `Bearer ${outsiderToken}` } }))).status).toBe(403);
      expect((await getBrief(new Request(briefUrl))).status).toBe(401);
      const recUrl = `http://localhost:3000/api/recommendations?leagueId=${leagueId}`;
      const ownerRecs = await getRecommendations(new Request(recUrl, { headers: { authorization: `Bearer ${ownerToken}` } }));
      expect(ownerRecs.status).toBe(200);
      expect(await ownerRecs.json()).toMatchObject({ data: [{ confidenceMeaning: "heuristic_source_coverage_not_outcome_probability", projectedPoints: { recommended: 10, current: 5 } }] });
      expect((await getRecommendations(new Request(recUrl, { headers: { authorization: `Bearer ${outsiderToken}` } }))).status).toBe(403);
    } finally {
      checked("cleanup briefs", (await client.from("daily_briefs").delete().eq("league_id", leagueId)).error);
      checked("cleanup recommendations", (await client.from("recommendations").delete().eq("league_id", leagueId)).error);
      checked("cleanup assignments", (await client.from("roster_assignments").delete().eq("league_id", leagueId)).error);
      checked("cleanup membership", (await client.from("league_memberships").delete().eq("league_id", leagueId)).error);
      checked("cleanup roster", (await client.from("rosters").delete().eq("league_id", leagueId)).error);
      checked("cleanup league", (await client.from("leagues").delete().eq("id", leagueId)).error);
      checked("cleanup snapshots", (await client.from("player_snapshots").delete().in("player_id", [starterId, benchId])).error);
      checked("cleanup evidence", (await client.from("evidence").delete().in("player_id", [starterId, benchId])).error);
      checked("cleanup players", (await client.from("players").delete().in("id", [starterId, benchId])).error);
      checked("cleanup workspace membership", (await client.from("workspace_members").delete().eq("workspace_id", workspaceId)).error);
      checked("cleanup workspace", (await client.from("workspaces").delete().eq("id", workspaceId)).error);
      if (userId) checked("cleanup user", (await client.auth.admin.deleteUser(userId)).error);
      if (outsiderId) checked("cleanup outsider", (await client.auth.admin.deleteUser(outsiderId)).error);
    }
  }, 45_000);
});
