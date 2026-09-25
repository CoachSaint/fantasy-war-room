import { randomInt, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { YahooLeagueImport } from "../src/lib/data/yahoo";
import { persistYahooImports } from "../src/lib/integrations/yahoo-sync";
import { GET as getContext } from "../src/app/api/context/route";

const live = process.env.FWR_LIVE_TEST === "1";

function checked(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`${label}: ${error.message}`);
}

describe("shared Yahoo league hosted integration", () => {
  it.skipIf(!live)("joins two consented managers to one league without stealing either roster", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !serviceKey || !anonKey || new URL(url).hostname !== "fswsefqqlltmaktiqwge.supabase.co") {
      throw new Error("live_fixture_project_guard_failed");
    }
    const client = createClient(url, serviceKey, { auth: { persistSession: false } });
    const publicClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const id = randomUUID();
    const password = `${id}Aa!`;
    const leagueKey = `449.l.${randomInt(100000000, 999999999)}`;
    const teamKeys = [`${leagueKey}.t.1`, `${leagueKey}.t.2`] as const;
    const emails = [1, 2, 3].map((index) => `fwr-shared-${id}-${index}@example.com`);
    const users: string[] = [];
    const connectionIds: string[] = [];
    let leagueId: string | null = null;
    let workspaceId: string | null = null;
    const imported = (ownedTeamKey: string): YahooLeagueImport => ({
      leagueKey, leagueId: leagueKey.split(".")[2], name: "Disposable shared Yahoo fixture",
      season: 2026, currentWeek: 3, ownedTeamKey,
      rosterSlots: [{ slotType: "RB", count: 1, eligiblePositions: ["RB"], required: true }],
      scoringModifiers: { "9": 0.1 },
      teams: teamKeys.map((teamKey, index) => ({
        teamKey, teamId: String(index + 1), name: `Fixture team ${index + 1}`,
        ownedByCurrentUser: teamKey === ownedTeamKey, players: [],
      })),
      matchups: [{ week: 3, teamKeys: [teamKeys[0], teamKeys[1]],
        points: [null, null], projectedPoints: [null, null], status: "pre_event",
        winnerTeamKey: null, isTied: false, isPlayoffs: false }],
    });

    try {
      for (const email of emails) {
        const created = await client.auth.admin.createUser({ email, password, email_confirm: true });
        checked("create fixture user", created.error);
        if (!created.data.user) throw new Error("fixture_user_missing");
        users.push(created.data.user.id);
      }
      for (let index = 0; index < 2; index += 1) {
        const connectionId = randomUUID();
        connectionIds.push(connectionId);
        checked("fixture connection", (await client.from("provider_connections").insert({
          id: connectionId, user_id: users[index], provider: "yahoo",
          access_token_ciphertext: "fixture-not-a-token", refresh_token_ciphertext: "fixture-not-a-token",
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        })).error);
      }

      const first = await persistYahooImports(client, users[0], connectionIds[0], `fixture-guid-${id}-1`, [imported(teamKeys[0])]);
      leagueId = first.leagueIds[0];
      const firstLeague = await client.from("leagues").select("workspace_id").eq("id", leagueId).single();
      checked("read first league", firstLeague.error);
      if (!firstLeague.data) throw new Error("fixture_league_missing");
      workspaceId = String(firstLeague.data.workspace_id);

      // A different app account presenting the first Yahoo team must be
      // refused before it can join the existing workspace.
      await expect(persistYahooImports(client, users[2], randomUUID(), `fixture-guid-${id}-3`, [imported(teamKeys[0])]))
        .rejects.toMatchObject({ code: "yahoo_roster_already_claimed" });
      const refusedMember = await client.from("workspace_members").select("user_id")
        .eq("workspace_id", workspaceId).eq("user_id", users[2]);
      checked("read refused membership", refusedMember.error);
      expect(refusedMember.data).toHaveLength(0);

      const second = await persistYahooImports(client, users[1], connectionIds[1], `fixture-guid-${id}-2`, [imported(teamKeys[1])]);
      expect(second.leagueIds).toEqual([leagueId]);
      const leagues = await client.from("leagues").select("id").eq("provider", "yahoo").eq("provider_league_id", leagueKey);
      checked("read shared league", leagues.error);
      expect(leagues.data).toHaveLength(1);
      const rosters = await client.from("rosters").select("id, provider_roster_id, owner_user_id")
        .eq("league_id", leagueId);
      checked("read shared rosters", rosters.error);
      const rosterByTeam = new Map((rosters.data || []).map((roster) => [roster.provider_roster_id, roster]));
      expect(rosterByTeam.get(teamKeys[0])?.owner_user_id).toBe(users[0]);
      expect(rosterByTeam.get(teamKeys[1])?.owner_user_id).toBe(users[1]);
      const memberships = await client.from("league_memberships").select("user_id, roster_id")
        .eq("league_id", leagueId);
      checked("read league memberships", memberships.error);
      expect(new Map((memberships.data || []).map((member) => [member.user_id, member.roster_id])))
        .toEqual(new Map([[users[0], rosterByTeam.get(teamKeys[0])?.id], [users[1], rosterByTeam.get(teamKeys[1])?.id]]));
      const workspaceMembers = await client.from("workspace_members").select("user_id, role")
        .eq("workspace_id", workspaceId);
      checked("read workspace members", workspaceMembers.error);
      expect(new Map((workspaceMembers.data || []).map((member) => [member.user_id, member.role])))
        .toEqual(new Map([[users[0], "owner"], [users[1], "member"]]));

      for (let index = 0; index < 2; index += 1) {
        const signed = await publicClient.auth.signInWithPassword({ email: emails[index], password });
        checked("sign in fixture manager", signed.error);
        const token = signed.data.session?.access_token;
        if (!token) throw new Error("fixture_session_missing");
        const response = await getContext(new Request("http://localhost/api/context", {
          headers: { authorization: `Bearer ${token}` },
        }));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.status).toBe("ready");
        expect(body.data.memberships[0].league.id).toBe(leagueId);
        expect(body.data.memberships[0].roster.id).toBe(rosterByTeam.get(teamKeys[index])?.id);
      }
    } finally {
      if (leagueId) checked("cleanup shared league", (await client.from("leagues").delete().eq("id", leagueId)).error);
      if (connectionIds.length) checked("cleanup connections", (await client.from("provider_connections").delete().in("id", connectionIds)).error);
      if (workspaceId) checked("cleanup workspace", (await client.from("workspaces").delete().eq("id", workspaceId)).error);
      for (const userId of users) checked("cleanup fixture user", (await client.auth.admin.deleteUser(userId)).error);
    }
  }, 120_000);
});
