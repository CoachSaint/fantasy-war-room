import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { GET as getSignals } from "../src/app/api/today/signals/route";

const live = process.env.FWR_LIVE_TEST === "1";
function checked(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`${label}: ${error.message}`);
}

describe("Today roster signals hosted database integration", () => {
  it.skipIf(!live)("shows only owned evidence-backed reports and recent game movement", async () => {
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
    const playerIds = [randomUUID(), randomUUID()];
    const now = new Date();
    const earlier = new Date(now.getTime() - 60 * 60_000).toISOString();
    const password = `${runId}Aa!`;
    const users: string[] = [];
    try {
      for (const label of ["owner", "outsider"]) {
        const created = await client.auth.admin.createUser({
          email: `fwr-signals-${label}-${runId}@example.com`, password, email_confirm: true,
        });
        checked(`create ${label}`, created.error);
        if (!created.data.user) throw new Error("fixture_user_missing");
        users.push(created.data.user.id);
      }
      checked("insert workspace", (await client.from("workspaces").insert({
        id: workspaceId, name: "Disposable Today signals fixture", created_by: users[0],
      })).error);
      checked("insert league", (await client.from("leagues").insert({
        id: leagueId, workspace_id: workspaceId, owner_id: users[0], provider: "yahoo",
        provider_league_id: `fixture-${runId}`, name: "Disposable Today signals fixture",
        season: 2026, current_week: 3, scoring: { statModifiers: { "9": 0.1 } },
      })).error);
      checked("insert roster", (await client.from("rosters").insert({
        id: rosterId, league_id: leagueId, owner_user_id: users[0], updated_at: now.toISOString(),
      })).error);
      checked("insert membership", (await client.from("league_memberships").insert({
        league_id: leagueId, user_id: users[0], roster_id: rosterId,
      })).error);
      checked("insert players", (await client.from("players").insert(playerIds.map((id, index) => ({
        id, canonical_key: `fixture:${runId}:${index}`, full_name: `Fixture Signal ${index + 1}`,
        position: "RB", status: "Active",
      })))).error);
      checked("insert assignments", (await client.from("roster_assignments").insert(playerIds.map((id) => ({
        league_id: leagueId, roster_id: rosterId, player_id: id, designation: "starter",
      })))).error);
      checked("insert observed games", (await client.from("player_snapshots").insert(playerIds.flatMap((id, index) => [
        { player_id: id, season: 2026, week: 2, source: "nflverse_stats_player",
          fingerprint: `${runId}-${index}-week2`, observed_at: earlier,
          data: { actualFantasyPoints: index === 0 ? 10 : 18 } },
        { player_id: id, season: 2026, week: 3, source: "nflverse_stats_player",
          fingerprint: `${runId}-${index}-week3`, observed_at: now.toISOString(),
          data: { actualFantasyPoints: index === 0 ? 18 : 9 } },
      ]))).error);
      checked("insert injury evidence", (await client.from("evidence").insert([
        { player_id: playerIds[0], type: "injury", source: "nflverse_injuries",
          source_url: "https://github.com/nflverse/nfldata/releases", summary: "Fixture Signal 1 - Injury Status: Questionable. Detail: Knee.",
          confidence: 85, observed_at: earlier,
          fingerprint: `injury_${runId}_s2026_w3_questionable_limited` },
        { player_id: playerIds[0], type: "injury", source: "nflverse_injuries",
          source_url: "https://github.com/nflverse/nfldata/releases", summary: "Fixture Signal 1 - Injury Status: Out. Detail: Knee.",
          confidence: 95, observed_at: now.toISOString(),
          fingerprint: `injury_${runId}_s2026_w3_out_none` },
      ])).error);
      const owner = await publicClient.auth.signInWithPassword({
        email: `fwr-signals-owner-${runId}@example.com`, password,
      });
      checked("sign in owner", owner.error);
      const ownerToken = owner.data.session?.access_token;
      if (!ownerToken) throw new Error("owner_token_missing");
      const request = (token: string) => new Request(`http://localhost/api/today/signals?leagueId=${leagueId}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const ready = await getSignals(request(ownerToken));
      expect(ready.status).toBe(200);
      const body = await ready.json();
      expect(body.injuries).toHaveLength(1);
      expect(body.injuries[0]).toMatchObject({ playerName: "Fixture Signal 1", status: "Out",
        previousStatus: "Questionable", changed: true });
      expect(body.risers).toMatchObject([{ playerName: "Fixture Signal 1", change: 8,
        priorWeek: 2, latestWeek: 3 }]);
      expect(body.fallers).toMatchObject([{ playerName: "Fixture Signal 2", change: -9,
        priorWeek: 2, latestWeek: 3 }]);
      const outsider = await publicClient.auth.signInWithPassword({
        email: `fwr-signals-outsider-${runId}@example.com`, password,
      });
      checked("sign in outsider", outsider.error);
      const outsiderToken = outsider.data.session?.access_token;
      if (!outsiderToken) throw new Error("outsider_token_missing");
      expect((await getSignals(request(outsiderToken))).status).toBe(403);
      checked("age roster", (await client.from("rosters").update({
        updated_at: new Date(now.getTime() - 7 * 60 * 60_000).toISOString(),
      }).eq("id", rosterId)).error);
      const stale = await getSignals(request(ownerToken));
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ error: "yahoo_roster_sync_stale" });
    } finally {
      checked("cleanup league", (await client.from("leagues").delete().eq("id", leagueId)).error);
      checked("cleanup workspace", (await client.from("workspaces").delete().eq("id", workspaceId)).error);
      checked("cleanup players", (await client.from("players").delete().in("id", playerIds)).error);
      for (const userId of users) checked("cleanup fixture user", (await client.auth.admin.deleteUser(userId)).error);
    }
  }, 120_000);
});
