import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { POST as createSetup } from "../src/app/api/leagues/setup/route";

const live = process.env.FWR_LIVE_TEST === "1";

function checked(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`${label}: ${error.message}`);
}

describe("manual setup hosted transaction", () => {
  it.skipIf(!live)("creates one complete graph and rolls back a late failure", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !serviceKey || !anonKey) throw new Error("hosted_fixture_credentials_missing");
    if (new URL(url).hostname !== "fswsefqqlltmaktiqwge.supabase.co") throw new Error("hosted_fixture_project_guard_failed");
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const runId = randomUUID();
    const playerId = randomUUID();
    const email = `fwr-setup-${runId}@example.com`;
    const outsiderEmail = `fwr-setup-outsider-${runId}@example.com`;
    const password = `${runId}Aa!`;
    const failedWorkspaceId = randomUUID();
    const failedLeagueId = randomUUID();
    const failedRosterId = randomUUID();
    let userId: string | null = null;
    let outsiderId: string | null = null;
    let workspaceId: string | null = null;
    let leagueId: string | null = null;
    let secondLeagueId: string | null = null;
    try {
      const owner = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      checked("create owner", owner.error);
      userId = owner.data.user?.id || null;
      if (!userId) throw new Error("owner_id_missing");
      const outsider = await admin.auth.admin.createUser({ email: outsiderEmail, password, email_confirm: true });
      checked("create outsider", outsider.error);
      outsiderId = outsider.data.user?.id || null;
      if (!outsiderId) throw new Error("outsider_id_missing");
      checked("create player", (await admin.from("players").insert({
        id: playerId, canonical_key: `fixture:${runId}`, full_name: "Setup Fixture Player",
        position: "RB", status: "Active",
      })).error);

      const setup = {
        league: { leagueId: `fixture-${runId}`, name: "Atomic Setup Fixture", season: 2026, week: 3, teamCount: 2 },
        scoring: { preset: "custom", receiving: { reception: 1 } },
        rosterSlots: [
          { slotType: "RB", slotOrder: 0, eligiblePositions: ["RB"] },
          { slotType: "BENCH", slotOrder: 1, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DST"], count: 2 },
        ],
        teams: [{ id: "team-one", name: "One" }, { id: "team-two", name: "Two" }],
        managers: [{ managerId: "owner-manager", displayName: "Owner" }, { managerId: "other-manager", displayName: "Other" }],
        managerMappings: [{ teamId: "team-one", managerId: "owner-manager" }, { teamId: "team-two", managerId: "other-manager" }],
        knownPlayerIds: [playerId], playerAssignments: [{ playerId, teamId: "team-one" }],
      };
      const login = await anon.auth.signInWithPassword({ email, password });
      checked("owner sign-in", login.error);
      const token = login.data.session?.access_token;
      if (!token) throw new Error("owner_token_missing");
      const response = await createSetup(new Request("http://localhost:3000/api/leagues/setup", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ setup, managerId: "owner-manager" }),
      }));
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(201);
      expect(body).toMatchObject({ ok: true, status: "ready", data: { setupRequired: false } });
      workspaceId = body.data.workspaceId;
      leagueId = body.data.leagueId;
      const rosterId = body.data.rosterId;
      for (const [table, expected] of [
        ["workspaces", 1], ["workspace_members", 1], ["leagues", 1],
        ["league_scoring_rules", 1], ["roster_slot_definitions", 3],
        ["rosters", 2], ["league_memberships", 1], ["manager_preferences", 1],
        ["roster_assignments", 1],
      ] as const) {
        const workspaceTable = table === "workspaces" || table === "workspace_members";
        const lookupColumn = table === "workspaces" || table === "leagues" ? "id"
          : workspaceTable ? "workspace_id" : "league_id";
        const value = workspaceTable ? workspaceId : leagueId;
        const rows = await admin.from(table).select("*", { count: "exact", head: true }).eq(lookupColumn, value);
        checked(`count ${table}`, rows.error);
        expect(rows.count, table).toBe(expected);
      }
      const assigned = await admin.from("roster_assignments").select("roster_id, player_id").eq("league_id", leagueId).single();
      checked("read assignment", assigned.error);
      expect(assigned.data).toMatchObject({ roster_id: rosterId, player_id: playerId });

      const second = await createSetup(new Request("http://localhost:3000/api/leagues/setup", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ setup: { ...setup, league: { ...setup.league, leagueId: `second-${runId}` } },
          workspaceId, managerId: "owner-manager" }),
      }));
      const secondBody = await second.json();
      expect(second.status, JSON.stringify(secondBody)).toBe(201);
      expect(secondBody.data.workspaceId).toBe(workspaceId);
      secondLeagueId = secondBody.data.leagueId;

      const outsiderLogin = await anon.auth.signInWithPassword({ email: outsiderEmail, password });
      checked("outsider sign-in", outsiderLogin.error);
      const outsiderToken = outsiderLogin.data.session?.access_token;
      if (!outsiderToken) throw new Error("outsider_token_missing");
      const denied = await createSetup(new Request("http://localhost:3000/api/leagues/setup", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${outsiderToken}` },
        body: JSON.stringify({ setup: { ...setup, league: { ...setup.league, leagueId: `outsider-${runId}` } },
          workspaceId, managerId: "owner-manager" }),
      }));
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ error: "workspace_manage_required" });
      const lateParams = {
        p_user_id: userId, p_workspace_id: failedWorkspaceId, p_create_workspace: true,
        p_workspace_name: "Rollback Fixture", p_league_id: failedLeagueId,
        p_provider_league_id: `failed-${runId}`, p_league_name: "Rollback Fixture",
        p_season: 2026, p_week: 3, p_scoring: { preset: "ppr" },
        p_roster_positions: ["RB"], p_scoring_rules: [],
        p_slots: [{ slot_type: "RB", slot_order: 0, eligible_positions: ["RB"], required: true }],
        p_rosters: [
          { id: failedRosterId, provider_roster_id: "one", name: "One", owner_user_id: userId },
          { id: randomUUID(), provider_roster_id: "two", name: "Two", owner_user_id: null },
        ], p_selected_roster_id: failedRosterId, p_selected_manager_id: "owner-manager",
        p_assignments: [{ roster_id: failedRosterId, player_id: randomUUID() }],
      };
      const direct = await fetch(`${url}/rest/v1/rpc/create_manual_league_setup`, {
        method: "POST", headers: { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(lateParams),
      });
      expect(direct.status).toBe(403);

      const lateFailure = await admin.rpc("create_manual_league_setup", lateParams);
      expect(lateFailure.error?.code).toBe("23503");
      for (const [table, id] of [["workspaces", failedWorkspaceId], ["leagues", failedLeagueId], ["rosters", failedRosterId]] as const) {
        const absent = await admin.from(table).select("id").eq("id", id);
        checked(`read rolled-back ${table}`, absent.error);
        expect(absent.data).toHaveLength(0);
      }
    } finally {
      for (const id of [secondLeagueId, leagueId].filter((value): value is string => Boolean(value))) {
        checked("cleanup assignment", (await admin.from("roster_assignments").delete().eq("league_id", id)).error);
        checked("cleanup membership", (await admin.from("league_memberships").delete().eq("league_id", id)).error);
        checked("cleanup preferences", (await admin.from("manager_preferences").delete().eq("league_id", id)).error);
        checked("cleanup rosters", (await admin.from("rosters").delete().eq("league_id", id)).error);
        checked("cleanup slots", (await admin.from("roster_slot_definitions").delete().eq("league_id", id)).error);
        checked("cleanup rules", (await admin.from("league_scoring_rules").delete().eq("league_id", id)).error);
        checked("cleanup league", (await admin.from("leagues").delete().eq("id", id)).error);
      }
      if (workspaceId) checked("cleanup workspace", (await admin.from("workspaces").delete().eq("id", workspaceId)).error);
      checked("cleanup player", (await admin.from("players").delete().eq("id", playerId)).error);
      if (userId) checked("cleanup owner", (await admin.auth.admin.deleteUser(userId)).error);
      if (outsiderId) checked("cleanup outsider", (await admin.auth.admin.deleteUser(outsiderId)).error);
    }
  }, 120_000);
});
