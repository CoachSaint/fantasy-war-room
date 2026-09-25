import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { GET as getBoard } from "../src/app/api/draft/board/route";

const live = process.env.FWR_LIVE_TEST === "1";
function checked(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`${label}: ${error.message}`);
}

describe("Yahoo draft board hosted database integration", () => {
  it.skipIf(!live)("uses owned Yahoo availability and source evidence, rejects outsiders and stale draft data", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !serviceKey || !anonKey || new URL(url).hostname !== "fswsefqqlltmaktiqwge.supabase.co") {
      throw new Error("live_fixture_project_or_key_missing");
    }
    const client = createClient(url, serviceKey, { auth: { persistSession: false } });
    const publicClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const runId = randomUUID();
    const workspaceId = randomUUID();
    const leagueId = randomUUID();
    const rosterId = randomUUID();
    const connectionId = randomUUID();
    const scanId = randomUUID();
    const playerIds = [randomUUID(), randomUUID()];
    const providerLeagueId = "449.l.12345";
    const sourceUrl = "https://api.sleeper.app/v1/projections/nfl/regular/2026";
    const yahooUrl = `https://fantasysports.yahooapis.com/fantasy/v2/league/${providerLeagueId}/players;status=A;sort=OR`;
    const now = new Date();
    const password = `${runId}Aa!`;
    const users: string[] = [];
    try {
      for (const label of ["owner", "outsider"]) {
        const created = await client.auth.admin.createUser({ email: `fwr-board-${label}-${runId}@example.com`, password, email_confirm: true });
        checked(`create ${label}`, created.error);
        if (!created.data.user) throw new Error("fixture_user_missing");
        users.push(created.data.user.id);
      }
      checked("insert workspace", (await client.from("workspaces").insert({
        id: workspaceId, name: "Disposable draft board fixture", created_by: users[0],
      })).error);
      checked("insert league", (await client.from("leagues").insert({
        id: leagueId, workspace_id: workspaceId, owner_id: users[0], provider: "yahoo",
        provider_league_id: providerLeagueId, name: "Disposable draft board fixture",
        season: 2026, current_week: 1,
        scoring: { draftStatus: "predraft", statModifiers: { "9": 0.1, "10": 6, "11": 1 } },
      })).error);
      checked("insert roster", (await client.from("rosters").insert({
        id: rosterId, league_id: leagueId, owner_user_id: users[0],
        provider_roster_id: `${providerLeagueId}.t.1`, updated_at: now.toISOString(),
      })).error);
      checked("insert membership", (await client.from("league_memberships").insert({
        league_id: leagueId, user_id: users[0], roster_id: rosterId,
      })).error);
      checked("insert connection", (await client.from("provider_connections").insert({
        id: connectionId, user_id: users[0], provider: "yahoo",
        access_token_ciphertext: "fixture-not-a-token", refresh_token_ciphertext: "fixture-not-a-token",
        expires_at: new Date(now.getTime() + 60 * 60_000).toISOString(),
      })).error);
      checked("insert league link", (await client.from("provider_league_links").insert({
        connection_id: connectionId, user_id: users[0], provider: "yahoo",
        provider_league_id: providerLeagueId, provider_team_id: `${providerLeagueId}.t.1`,
        league_id: leagueId, roster_id: rosterId, last_synced_at: now.toISOString(),
      })).error);
      checked("insert slot", (await client.from("roster_slot_definitions").insert({
        league_id: leagueId, slot_type: "RB", slot_order: 0, eligible_positions: ["RB"], required: true,
      })).error);
      checked("insert players", (await client.from("players").insert(playerIds.map((id, index) => ({
        id, canonical_key: `fixture:${runId}:${index}`, full_name: `Fixture Runner ${index + 1}`, position: "RB", status: "Active",
      })))).error);
      checked("insert scan", (await client.from("league_available_scans").insert({
        league_id: leagueId, scan_id: scanId, observed_at: now.toISOString(),
        fresh_until: new Date(now.getTime() + 6 * 60 * 60_000).toISOString(),
        candidates_count: 2, truncated: false, source_url: yahooUrl,
      })).error);
      checked("insert Yahoo available players", (await client.from("league_available_players").insert(playerIds.map((id, index) => ({
        league_id: leagueId, scan_id: scanId, player_id: id, provider_player_key: `449.p.${index + 1}`,
        provider_order: index + 1, provider_status: "Active", observed_at: now.toISOString(),
        fresh_until: new Date(now.getTime() + 6 * 60 * 60_000).toISOString(),
      })))).error);
      checked("insert season snapshots", (await client.from("player_snapshots").insert(playerIds.map((id, index) => ({
        player_id: id, season: 2026, week: 0, source: "sleeper_season_projections",
        fingerprint: `${runId}-${index}`, observed_at: now.toISOString(),
        data: { providerPlayerId: String(1000 + index), projectedStats: { rush_yd: 1000 - index * 300, rush_td: 10 - index * 3 },
          projectedFantasyPointsPpr: 220 - index * 70, adpPpr: 40 + index * 20 },
      })))).error);
      checked("insert evidence", (await client.from("evidence").insert(playerIds.map((id, index) => ({
        player_id: id, type: "projection", source: "sleeper_season_projections", source_url: sourceUrl,
        summary: "Disposable season projection fixture", confidence: 100, observed_at: now.toISOString(),
        fingerprint: `sleeper_season_projection_${runId}-${index}`,
      })))).error);
      const owner = await publicClient.auth.signInWithPassword({
        email: `fwr-board-owner-${runId}@example.com`, password,
      });
      checked("sign in owner", owner.error);
      const ownerToken = owner.data.session?.access_token;
      if (!ownerToken) throw new Error("owner_token_missing");
      const request = (token: string) => new Request(`http://localhost/api/draft/board?leagueId=${leagueId}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const ready = await getBoard(request(ownerToken));
      expect(ready.status).toBe(200);
      const body = await ready.json();
      expect(body).toMatchObject({ status: "ready", availability: { count: 2 },
        projections: { matchedCount: 2, accuracyVerified: false } });
      expect(body.players).toHaveLength(2);
      expect(body.players[0]).toMatchObject({ name: "Fixture Runner 1", projectedSeasonPoints: 160,
        yahooOrder: 1, openDirectStarterSlots: 1, sleeperAdp: 40,
        assumedZeroYahooStatIds: ["11"] });
      expect(body.players[0].evidenceId).toBeTruthy();
      const outsider = await publicClient.auth.signInWithPassword({
        email: `fwr-board-outsider-${runId}@example.com`, password,
      });
      checked("sign in outsider", outsider.error);
      const outsiderToken = outsider.data.session?.access_token;
      if (!outsiderToken) throw new Error("outsider_token_missing");
      expect((await getBoard(request(outsiderToken))).status).toBe(403);
      const old = new Date(now.getTime() - 7 * 60 * 60_000).toISOString();
      checked("expire scan freshness", (await client.from("league_available_scans").update({ observed_at: old })
        .eq("league_id", leagueId)).error);
      const stale = await getBoard(request(ownerToken));
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ error: "yahoo_available_scan_stale" });
    } finally {
      checked("cleanup league", (await client.from("leagues").delete().eq("id", leagueId)).error);
      checked("cleanup connection", (await client.from("provider_connections").delete().eq("id", connectionId)).error);
      checked("cleanup workspace", (await client.from("workspaces").delete().eq("id", workspaceId)).error);
      checked("cleanup players", (await client.from("players").delete().in("id", playerIds)).error);
      for (const userId of users) checked("cleanup fixture user", (await client.auth.admin.deleteUser(userId)).error);
    }
  }, 120_000);
});
