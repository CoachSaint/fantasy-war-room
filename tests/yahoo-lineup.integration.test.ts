import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { materializeYahooLineupForLeague } from "../src/lib/services/yahoo-lineup";
import { materializeDailyBriefForLeague } from "../src/lib/services/daily-brief";
import { materializeYahooWaiversForLeague } from "../src/lib/services/yahoo-waivers";
import { refreshYahooDecisionsAfterImport } from "../src/lib/services/yahoo-decision-refresh";
import { runYahooSync } from "../src/lib/integrations/yahoo-runner";
import { GET as getBrief } from "../src/app/api/brief/route";
import { GET as getRecommendations } from "../src/app/api/recommendations/route";
import { GET as getHistory } from "../src/app/api/history/route";
import { GET as getAccuracy } from "../src/app/api/accuracy/route";
import { GET as getPlayers } from "../src/app/api/players/route";
import { POST as askCoach } from "../src/app/api/coach/chat/route";
import { GET as runScout } from "../src/app/api/scout/run/route";

const live = process.env.FWR_LIVE_TEST === "1";
const sourceUrl = "https://api.sleeper.app/v1/projections/nfl/regular/2026/3";

function checked(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`${label}: ${error.message}`);
}

describe("Yahoo lineup hosted database integration", () => {
  it.skipIf(!live)("writes owner-scoped source-backed swaps and retains their history on rerun", async () => {
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
    const opponentRosterId = randomUUID();
    const connectionId = randomUUID();
    const starterId = randomUUID();
    const benchId = randomUUID();
    const availableId = randomUUID();
    const scanId = randomUUID();
    const starterEvidenceId = randomUUID();
    const benchEvidenceId = randomUUID();
    const availableEvidenceId = randomUUID();
    const asOf = new Date();
    let userId: string | null = null;
    let outsiderId: string | null = null;
    const scoutRunIds: string[] = [];
    const previousCronSecret = process.env.CRON_SECRET;
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
      const noConsent = await runYahooSync(client, userId);
      expect(noConsent.status).toBe(409);
      expect(await noConsent.json()).toMatchObject({ error: "yahoo_connection_required" });
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
      checked("insert rosters", (await client.from("rosters").insert([
        { id: rosterId, league_id: leagueId, owner_user_id: userId,
          provider_roster_id: `fixture-${runId}`, current_faab: 72 },
        { id: opponentRosterId, league_id: leagueId, provider_roster_id: `fixture-opponent-${runId}` },
      ])).error);
      checked("insert Yahoo matchup fixture", (await client.from("league_week_matchups").insert({
        league_id: leagueId, provider: "yahoo", week: 3,
        provider_matchup_key: `fixture-${runId}|fixture-opponent-${runId}`,
        team_a_roster_id: rosterId, team_b_roster_id: opponentRosterId,
        team_a_projected_points: 110.5, team_b_projected_points: 99.25,
        status: "pre_event", observed_at: asOf.toISOString(),
      })).error);
      checked("insert membership", (await client.from("league_memberships").insert({
        league_id: leagueId, user_id: userId, roster_id: rosterId,
      })).error);
      // A disposable sync marker exercises Scout's freshness gate. It is not a
      // Yahoo token or evidence of real provider consent.
      checked("insert fixture connection", (await client.from("provider_connections").insert({
        id: connectionId, user_id: userId, provider: "yahoo",
        access_token_ciphertext: "fixture-not-a-token", refresh_token_ciphertext: "fixture-not-a-token",
        expires_at: new Date(asOf.getTime() + 60 * 60_000).toISOString(),
      })).error);
      checked("insert fixture league sync marker", (await client.from("provider_league_links").insert({
        connection_id: connectionId, user_id: userId, provider: "yahoo",
        provider_league_id: `fixture-${runId}`, provider_team_id: `fixture-${runId}`,
        league_id: leagueId, roster_id: rosterId, last_synced_at: asOf.toISOString(),
      })).error);
      checked("insert players", (await client.from("players").insert([
        { id: starterId, canonical_key: `fixture:${runId}:starter`, full_name: "Fixture Starter", position: "RB", status: "Active" },
        { id: benchId, canonical_key: `fixture:${runId}:bench`, full_name: "Fixture Bench", position: "RB", status: "Active" },
        { id: availableId, canonical_key: `fixture:${runId}:available`, full_name: "Fixture Available", position: "RB", status: "Active" },
      ])).error);
      checked("insert assignments", (await client.from("roster_assignments").insert([
        { league_id: leagueId, roster_id: rosterId, player_id: starterId, designation: "starter", provider_status: "Active" },
        { league_id: leagueId, roster_id: rosterId, player_id: benchId, designation: "bench", provider_status: "Active" },
      ])).error);

      checked("insert projection snapshots", (await client.from("player_snapshots").insert([
        { player_id: starterId, season: 2026, week: 3, source: "sleeper_weekly_projections", fingerprint: `${runId}-starter`, observed_at: asOf.toISOString(), data: { providerPlayerId: "fixture-starter", projectedStats: { rush_yd: 50, rush_td: 0 } } },
        { player_id: benchId, season: 2026, week: 3, source: "sleeper_weekly_projections", fingerprint: `${runId}-bench`, observed_at: asOf.toISOString(), data: { providerPlayerId: "fixture-bench", projectedStats: { rush_yd: 100, rush_td: 0 } } },
        { player_id: availableId, season: 2026, week: 3, source: "sleeper_weekly_projections", fingerprint: `${runId}-available`, observed_at: asOf.toISOString(), data: { providerPlayerId: "fixture-available", projectedStats: { rush_yd: 150, rush_td: 0 } } },
        ...([4, 5] as const).flatMap((week) => ([
          { player_id: starterId, season: 2026, week, source: "sleeper_weekly_projections", fingerprint: `${runId}-starter-${week}`, observed_at: asOf.toISOString(), data: { providerPlayerId: "fixture-starter", projectedStats: { rush_yd: 50 + week * 2, rush_td: 0 } } },
          { player_id: benchId, season: 2026, week, source: "sleeper_weekly_projections", fingerprint: `${runId}-bench-${week}`, observed_at: asOf.toISOString(), data: { providerPlayerId: "fixture-bench", projectedStats: { rush_yd: 80 + week * 2, rush_td: 0 } } },
          { player_id: availableId, season: 2026, week, source: "sleeper_weekly_projections", fingerprint: `${runId}-available-${week}`, observed_at: asOf.toISOString(), data: { providerPlayerId: "fixture-available", projectedStats: { rush_yd: 110 + week * 2, rush_td: 0 } } },
        ])),
      ])).error);
      checked("insert observed game snapshots", (await client.from("player_snapshots").insert(
        [1, 2, 3].map((week) => ({ player_id: starterId, season: 2026, week,
          source: "nflverse_stats_player", fingerprint: `${runId}-actual-${week}`,
          observed_at: asOf.toISOString(), data: { actualFantasyPoints: week * 4,
            snapShare: 70 + week, targetShare: 20 + week } }))
      )).error);
      checked("insert source evidence", (await client.from("evidence").insert([
        { id: starterEvidenceId, player_id: starterId, type: "projection", source: "sleeper_weekly_projections", source_url: sourceUrl, summary: "Disposable control fixture", confidence: 100, observed_at: asOf.toISOString(), fingerprint: `sleeper_projection_${runId}-starter` },
        { id: benchEvidenceId, player_id: benchId, type: "projection", source: "sleeper_weekly_projections", source_url: sourceUrl, summary: "Disposable control fixture", confidence: 100, observed_at: asOf.toISOString(), fingerprint: `sleeper_projection_${runId}-bench` },
        { id: availableEvidenceId, player_id: availableId, type: "projection", source: "sleeper_weekly_projections", source_url: sourceUrl, summary: "Disposable control fixture", confidence: 100, observed_at: asOf.toISOString(), fingerprint: `sleeper_projection_${runId}-available` },
        ...([4, 5] as const).flatMap((week) => ([
          { id: randomUUID(), player_id: starterId, type: "projection", source: "sleeper_weekly_projections", source_url: `https://api.sleeper.app/v1/projections/nfl/regular/2026/${week}`, summary: "Disposable control fixture", confidence: 100, observed_at: asOf.toISOString(), fingerprint: `sleeper_projection_${runId}-starter-${week}` },
          { id: randomUUID(), player_id: benchId, type: "projection", source: "sleeper_weekly_projections", source_url: `https://api.sleeper.app/v1/projections/nfl/regular/2026/${week}`, summary: "Disposable control fixture", confidence: 100, observed_at: asOf.toISOString(), fingerprint: `sleeper_projection_${runId}-bench-${week}` },
          { id: randomUUID(), player_id: availableId, type: "projection", source: "sleeper_weekly_projections", source_url: `https://api.sleeper.app/v1/projections/nfl/regular/2026/${week}`, summary: "Disposable control fixture", confidence: 100, observed_at: asOf.toISOString(), fingerprint: `sleeper_projection_${runId}-available-${week}` },
        ])),
      ])).error);
      checked("insert availability scan", (await client.from("league_available_scans").insert({
        league_id: leagueId, scan_id: scanId, observed_at: asOf.toISOString(),
        fresh_until: new Date(asOf.getTime() + 6 * 60 * 60_000).toISOString(),
        candidates_count: 1, truncated: false,
        source_url: "https://fantasysports.yahooapis.com/fantasy/v2/league/449.l.123/players;status=A",
      })).error);
      checked("insert available player", (await client.from("league_available_players").insert({
        league_id: leagueId, scan_id: scanId, player_id: availableId, provider_player_key: "449.p.33",
        provider_status: "Active", observed_at: asOf.toISOString(),
        fresh_until: new Date(asOf.getTime() + 6 * 60 * 60_000).toISOString(),
      })).error);

      const baseline = await materializeDailyBriefForLeague(client, leagueId, new Date(asOf.getTime() + 500));
      expect(baseline).toMatchObject({ briefsWritten: 1, changesFound: 0, baselinesFound: 0 });
      const first = await materializeYahooLineupForLeague(client, leagueId, new Date(asOf.getTime() + 1000));
      expect(first).toMatchObject({ status: "complete", playersScored: 2, recommendationsInserted: 1 });
      const firstWaivers = await materializeYahooWaiversForLeague(client, leagueId, new Date(asOf.getTime() + 1000));
      expect(firstWaivers).toMatchObject({ status: "complete", candidatesScored: 1, recommendationsInserted: 1 });
      const firstBrief = await materializeDailyBriefForLeague(client, leagueId, new Date(asOf.getTime() + 1500));
      expect(firstBrief).toMatchObject({ briefsWritten: 1, changesFound: 2, baselinesFound: 1 });
      const refreshed = await refreshYahooDecisionsAfterImport(client, [leagueId, leagueId], new Date(asOf.getTime() + 2000));
      expect(refreshed).toEqual([{ leagueId, status: "evaluated", recommendationsWritten: 2, briefsWritten: 1 }]);
      const rows = await client.from("recommendations")
        .select("user_id, roster_id, subject_player_id, alternative_player_id, evidence_ids, payload")
        .eq("league_id", leagueId).eq("kind", "start")
        .gt("fresh_until", new Date(asOf.getTime() + 2000).toISOString());
      checked("read recommendations", rows.error);
      expect(rows.data).toHaveLength(1);
      expect(rows.data?.[0]).toMatchObject({
        user_id: userId, roster_id: rosterId, subject_player_id: benchId, alternative_player_id: starterId,
        payload: { projectedPoints: { recommended: 10, current: 5 } },
      });
      expect(rows.data?.[0]?.evidence_ids).toEqual([benchEvidenceId, starterEvidenceId]);
      const waiverRows = await client.from("recommendations")
        .select("subject_player_id, alternative_player_id, evidence_ids, payload")
        .eq("league_id", leagueId).eq("kind", "add")
        .gt("fresh_until", new Date(asOf.getTime() + 2000).toISOString());
      checked("read waiver recommendations", waiverRows.error);
      expect(waiverRows.data).toHaveLength(1);
      expect(waiverRows.data?.[0]).toMatchObject({ subject_player_id: availableId, alternative_player_id: benchId,
        evidence_ids: [availableEvidenceId, benchEvidenceId], payload: {
          availabilityTruncated: false,
          faabRange: { version: "faab-range-v1", model: "heuristic_no_bid_history", remainingBalance: 72 },
          forecastOutlookWeeksRequested: [3, 4, 5],
          forecastOutlook: [
            { week: 3, addPoints: 15, dropPoints: 10, edge: 5 },
            { week: 4, addPoints: 11.8, dropPoints: 8.8, edge: 3 },
            { week: 5, addPoints: 12, dropPoints: 9, edge: 3 },
          ],
        } });
      const decisionHistory = await client.from("decision_events")
        .select("id, recommendation_id, recommendation_snapshot, response")
        .eq("league_id", leagueId).eq("user_id", userId);
      checked("read immutable decision history", decisionHistory.error);
      expect(decisionHistory.data).toHaveLength(4);
      expect(decisionHistory.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ response: null,
          recommendation_snapshot: expect.objectContaining({ kind: "start", headline: expect.stringContaining("Fixture Bench") }) }),
        expect.objectContaining({ response: null,
          recommendation_snapshot: expect.objectContaining({ kind: "add", headline: expect.stringContaining("Fixture Available") }) }),
      ]));
      const lockedDecision = await client.from("decision_events")
        .update({ confidence: 99 }).eq("id", decisionHistory.data![0].id);
      expect(lockedDecision.error?.message).toContain("decision_event_facts_immutable");
      const predictionHistory = await client.from("prediction_events")
        .select("id, prediction_type, target_season, target_week, predicted_mean")
        .eq("league_id", leagueId).eq("user_id", userId);
      checked("read prediction history", predictionHistory.error);
      expect(predictionHistory.data).toHaveLength(8);
      expect(predictionHistory.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ prediction_type: "weekly_points", target_season: 2026, target_week: 3 }),
      ]));
      const lockedPrediction = await client.from("prediction_events")
        .update({ predicted_mean: 999 }).eq("id", predictionHistory.data![0].id);
      expect(lockedPrediction.error?.message).toContain("prediction_event_facts_immutable");
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
      for (const table of ["league_available_players", "league_available_scans"]) {
        const endpoint = `${url}/rest/v1/${table}?select=*&league_id=eq.${leagueId}`;
        const ownerRead = await fetch(endpoint, { headers: { apikey: anonKey, authorization: `Bearer ${ownerToken}` } });
        expect(ownerRead.status).toBe(200);
        expect(await ownerRead.json()).toHaveLength(1);
        const outsiderRead = await fetch(endpoint, { headers: { apikey: anonKey, authorization: `Bearer ${outsiderToken}` } });
        expect(outsiderRead.status).toBe(200);
        expect(await outsiderRead.json()).toHaveLength(0);
      }
      const briefUrl = `http://localhost:3000/api/brief?leagueId=${leagueId}`;
      const ownerBrief = await getBrief(new Request(briefUrl, { headers: { authorization: `Bearer ${ownerToken}` } }));
      expect(ownerBrief.status).toBe(200);
      expect(await ownerBrief.json()).toMatchObject({ status: "ready", data: { leagueId } });
      expect((await getBrief(new Request(briefUrl, { headers: { authorization: `Bearer ${outsiderToken}` } }))).status).toBe(403);
      expect((await getBrief(new Request(briefUrl))).status).toBe(401);
      const recUrl = `http://localhost:3000/api/recommendations?leagueId=${leagueId}&kind=start`;
      const ownerRecs = await getRecommendations(new Request(recUrl, { headers: { authorization: `Bearer ${ownerToken}` } }));
      expect(ownerRecs.status).toBe(200);
      expect(await ownerRecs.json()).toMatchObject({ data: [{ confidenceMeaning: "heuristic_source_coverage_not_outcome_probability", projectedPoints: { recommended: 10, current: 5 },
        teamMatchup: { week: 3, ownProjectedPoints: 110.5, opponentProjectedPoints: 99.25, status: "pre_event" } }] });
      expect((await getRecommendations(new Request(recUrl, { headers: { authorization: `Bearer ${outsiderToken}` } }))).status).toBe(403);
      const historyUrl = `http://localhost:3000/api/history?leagueId=${leagueId}`;
      const ownerHistory = await getHistory(new Request(historyUrl, { headers: { authorization: `Bearer ${ownerToken}` } }));
      expect(ownerHistory.status).toBe(200);
      expect(await ownerHistory.json()).toMatchObject({ count: 4, data: expect.arrayContaining([
        expect.objectContaining({ recommendation_snapshot: expect.objectContaining({ kind: "start" }) }),
      ]) });
      expect((await getHistory(new Request(historyUrl, { headers: { authorization: `Bearer ${outsiderToken}` } }))).status).toBe(403);
      expect((await getHistory(new Request(historyUrl))).status).toBe(401);
      const accuracyUrl = `http://localhost:3000/api/accuracy?leagueId=${leagueId}`;
      const ownerAccuracy = await getAccuracy(new Request(accuracyUrl, { headers: { authorization: `Bearer ${ownerToken}` } }));
      expect(ownerAccuracy.status).toBe(200);
      expect(await ownerAccuracy.json()).toMatchObject({ decisionsRecorded: 4, predictionsRecorded: 8,
        accuracyStatus: "awaiting_verified_outcomes" });
      expect((await getAccuracy(new Request(accuracyUrl, { headers: { authorization: `Bearer ${outsiderToken}` } }))).status).toBe(403);
      const forgedDecision = await fetch(`${url}/rest/v1/decision_events`, { method: "POST",
        headers: { apikey: anonKey, authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId, league_id: leagueId,
          recommendation_id: decisionHistory.data![0].recommendation_id, confidence: 99,
          recommended_at: asOf.toISOString() }) });
      expect(forgedDecision.status).toBe(403);
      const playerUrl = `http://localhost:3000/api/players?leagueId=${leagueId}&playerId=${starterId}`;
      const ownerPlayer = await getPlayers(new Request(playerUrl, { headers: { authorization: `Bearer ${ownerToken}` } }));
      expect(ownerPlayer.status).toBe(200);
      const playerBody = await ownerPlayer.json();
      expect(playerBody.snapshots.filter((row: { source: string }) => row.source === "nflverse_stats_player")
        .map((row: { week: number }) => row.week)).toEqual([3, 2, 1]);
      expect(playerBody.snapshots.filter((row: { source: string }) => row.source === "sleeper_weekly_projections"))
        .toHaveLength(3);
      expect((await getPlayers(new Request(playerUrl, { headers: { authorization: `Bearer ${outsiderToken}` } }))).status).toBe(403);
      const ownerWaivers = await getRecommendations(new Request(`http://localhost:3000/api/recommendations?leagueId=${leagueId}&kind=add`,
        { headers: { authorization: `Bearer ${ownerToken}` } }));
      expect(ownerWaivers.status).toBe(200);
      expect(await ownerWaivers.json()).toMatchObject({ data: [{
        faabRange: { version: "faab-range-v1", remainingBalance: 72 },
        forecastOutlook: {
        requestedWeeks: [3, 4, 5], weeks: [{ week: 3 }, { week: 4 }, { week: 5 }],
      } }] });

      const coachUrl = "http://localhost:3000/api/coach/chat";
      const coachBody = JSON.stringify({ leagueId, messages: [{ role: "user", content: "Who should I start?" }] });
      const coachRequest = (token?: string) => new Request(coachUrl, { method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: coachBody });
      const ownerCoach = await askCoach(coachRequest(ownerToken));
      expect(ownerCoach.status).toBe(200);
      expect(await ownerCoach.json()).toMatchObject({ modelUsed: "structured-v1", source: "persisted-league-decisions", demo: false });
      expect((await askCoach(coachRequest(outsiderToken))).status).toBe(403);
      expect((await askCoach(coachRequest())).status).toBe(401);

      const currentLeagues = await client.from("leagues").select("id")
        .eq("provider", "yahoo").eq("season", 2026).eq("current_week", 3).limit(2);
      checked("guard disposable Scout scope", currentLeagues.error);
      if (currentLeagues.data?.length !== 1 || currentLeagues.data[0].id !== leagueId) {
        throw new Error("disposable_scout_scope_not_isolated");
      }
      process.env.CRON_SECRET = `${runId}-scout-control`;
      const scoutResponse = await runScout(new Request("http://localhost:3000/api/scout/run?season=2026&week=3", {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }));
      const scoutBody = await scoutResponse.json();
      if (typeof scoutBody.scoutRunId === "string") scoutRunIds.push(scoutBody.scoutRunId);
      expect(scoutResponse.status).toBe(200);
      expect(scoutBody).toMatchObject({ ok: true, status: "completed" });
      expect(scoutBody.steps).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "league_roster_freshness", status: "success" }),
        expect.objectContaining({ name: "feature_scoring", status: "success" }),
        expect.objectContaining({ name: "waiver_scoring", status: "success" }),
        expect.objectContaining({ name: "daily_brief_materialization", status: "success" }),
      ]));

      checked("revoke fixture connection", (await client.from("provider_connections")
        .update({ status: "revoked" }).eq("id", connectionId)).error);
      const revokedResponse = await runScout(new Request("http://localhost:3000/api/scout/run?season=2026&week=3", {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }));
      const revokedBody = await revokedResponse.json();
      if (typeof revokedBody.scoutRunId === "string") scoutRunIds.push(revokedBody.scoutRunId);
      expect(revokedResponse.status).toBe(503);
      expect(revokedBody).toMatchObject({ ok: false, status: "degraded", error: "yahoo_league_sync_stale" });
      expect(revokedBody.steps).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "league_roster_freshness", status: "skipped" }),
      ]));

      checked("expire availability scan", (await client.from("league_available_scans").update({
        fresh_until: new Date(asOf.getTime() + 2500).toISOString(),
      }).eq("league_id", leagueId)).error);
      const staleWaivers = await materializeYahooWaiversForLeague(client, leagueId, new Date(asOf.getTime() + 3000));
      expect(staleWaivers).toMatchObject({ status: "skipped", reason: "yahoo_availability_scan_stale", recommendationsInserted: 0 });
      const expiredWaivers = await client.from("recommendations").select("fresh_until").eq("league_id", leagueId).eq("kind", "add");
      checked("read expired waiver", expiredWaivers.error);
      expect(expiredWaivers.data?.length).toBeGreaterThanOrEqual(2);
      expect(expiredWaivers.data?.every((row) => new Date(String(row.fresh_until)).getTime() <= asOf.getTime() + 3000)).toBe(true);
      const staleAddApi = await getRecommendations(new Request(`http://localhost:3000/api/recommendations?leagueId=${leagueId}&kind=add`,
        { headers: { authorization: `Bearer ${ownerToken}` } }));
      expect(staleAddApi.status).toBe(200);
      expect(await staleAddApi.json()).toMatchObject({ data: [], count: 0, demo: false });
    } finally {
      if (previousCronSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousCronSecret;
      if (scoutRunIds.length) checked("cleanup Scout runs", (await client.from("scout_runs").delete().in("id", scoutRunIds)).error);
      checked("cleanup briefs", (await client.from("daily_briefs").delete().eq("league_id", leagueId)).error);
      checked("cleanup decisions", (await client.from("decision_events").delete().eq("league_id", leagueId)).error);
      checked("cleanup predictions", (await client.from("prediction_events").delete().eq("league_id", leagueId)).error);
      checked("cleanup recommendations", (await client.from("recommendations").delete().eq("league_id", leagueId)).error);
      checked("cleanup availability rows", (await client.from("league_available_players").delete().eq("league_id", leagueId)).error);
      checked("cleanup availability scan", (await client.from("league_available_scans").delete().eq("league_id", leagueId)).error);
      checked("cleanup assignments", (await client.from("roster_assignments").delete().eq("league_id", leagueId)).error);
      checked("cleanup membership", (await client.from("league_memberships").delete().eq("league_id", leagueId)).error);
      checked("cleanup league sync marker", (await client.from("provider_league_links").delete().eq("connection_id", connectionId)).error);
      checked("cleanup fixture connection", (await client.from("provider_connections").delete().eq("id", connectionId)).error);
      checked("cleanup Yahoo matchup fixture", (await client.from("league_week_matchups").delete().eq("league_id", leagueId)).error);
      checked("cleanup roster", (await client.from("rosters").delete().eq("league_id", leagueId)).error);
      checked("cleanup league", (await client.from("leagues").delete().eq("id", leagueId)).error);
      checked("cleanup snapshots", (await client.from("player_snapshots").delete().in("player_id", [starterId, benchId, availableId])).error);
      checked("cleanup evidence", (await client.from("evidence").delete().in("player_id", [starterId, benchId, availableId])).error);
      checked("cleanup players", (await client.from("players").delete().in("id", [starterId, benchId, availableId])).error);
      checked("cleanup workspace membership", (await client.from("workspace_members").delete().eq("workspace_id", workspaceId)).error);
      checked("cleanup workspace", (await client.from("workspaces").delete().eq("id", workspaceId)).error);
      if (userId) checked("cleanup user", (await client.auth.admin.deleteUser(userId)).error);
      if (outsiderId) checked("cleanup outsider", (await client.auth.admin.deleteUser(outsiderId)).error);
    }
  }, 120_000);
});
