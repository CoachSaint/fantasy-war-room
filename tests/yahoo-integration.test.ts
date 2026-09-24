import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeYahooLeagueImport, normalizeYahooMatchups, normalizeYahooOwnedTeams } from "../src/lib/data/yahoo";
import {
  buildYahooAuthorizationUrl,
  createYahooOAuthState,
  decryptYahooToken,
  encryptYahooToken,
  getYahooOAuthConfig,
  matchesYahooOAuthState,
} from "../src/lib/integrations/yahoo-oauth";
import { GET as yahooStatusGET } from "../src/app/api/integrations/yahoo/status/route";
import { GET as yahooStartGET } from "../src/app/api/integrations/yahoo/start/route";
import { GET as yahooCallbackGET } from "../src/app/api/integrations/yahoo/callback/route";
import { POST as yahooSyncPOST } from "../src/app/api/integrations/yahoo/sync/route";

const originalEnv = {
  clientId: process.env.YAHOO_CLIENT_ID,
  clientSecret: process.env.YAHOO_CLIENT_SECRET,
  redirectUri: process.env.YAHOO_REDIRECT_URI,
  encryptionKey: process.env.YAHOO_TOKEN_ENCRYPTION_KEY,
  scope: process.env.YAHOO_OAUTH_SCOPE,
};

function setValidEnvironment() {
  process.env.YAHOO_CLIENT_ID = "test-client";
  process.env.YAHOO_CLIENT_SECRET = "test-secret";
  process.env.YAHOO_REDIRECT_URI = "https://example.com/api/integrations/yahoo/callback";
  process.env.YAHOO_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  delete process.env.YAHOO_OAUTH_SCOPE;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const [key, value] of Object.entries(originalEnv)) {
    const envName = ({ clientId: "YAHOO_CLIENT_ID", clientSecret: "YAHOO_CLIENT_SECRET", redirectUri: "YAHOO_REDIRECT_URI", encryptionKey: "YAHOO_TOKEN_ENCRYPTION_KEY", scope: "YAHOO_OAUTH_SCOPE" } as const)[key as keyof typeof originalEnv];
    if (value === undefined) delete process.env[envName];
    else process.env[envName] = value;
  }
});

describe("Yahoo OAuth queue", () => {
  it("stays inert and reports awaiting credentials when approval values are absent", async () => {
    delete process.env.YAHOO_CLIENT_ID;
    delete process.env.YAHOO_CLIENT_SECRET;
    delete process.env.YAHOO_TOKEN_ENCRYPTION_KEY;
    expect(getYahooOAuthConfig()).toBeNull();

    const response = await yahooStatusGET(new Request("http://localhost/api/integrations/yahoo/status"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ configured: false, connected: false, status: "awaiting_credentials" });

    const start = await yahooStartGET(new Request("http://localhost/api/integrations/yahoo/start"));
    expect(start.status).toBe(503);
    await expect(start.json()).resolves.toMatchObject({ error: "yahoo_credentials_pending" });
    const sync = await yahooSyncPOST(new Request("http://localhost/api/integrations/yahoo/sync", { method: "POST" }));
    expect(sync.status).toBe(503);
    await expect(sync.json()).resolves.toMatchObject({ error: "yahoo_credentials_pending" });
    const callback = await yahooCallbackGET(new Request("http://localhost/api/integrations/yahoo/callback?code=secret&state=bad"));
    expect(callback.status).toBe(307);
    expect(callback.headers.get("location")).toContain("yahoo=credentials_pending");
  });

  it("builds a state-bound authorization URL without exposing the client secret", () => {
    setValidEnvironment();
    const url = new URL(buildYahooAuthorizationUrl("state-value-with-enough-entropy"));
    expect(url.origin + url.pathname).toBe("https://api.login.yahoo.com/oauth2/request_auth");
    expect(url.searchParams.get("client_id")).toBe("test-client");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-value-with-enough-entropy");
    expect(url.toString()).not.toContain("test-secret");
    const state = createYahooOAuthState("user-one");
    expect(matchesYahooOAuthState(state, state, "user-one")).toBe(true);
    expect(matchesYahooOAuthState(state, state, "user-two")).toBe(false);
    expect(matchesYahooOAuthState(state, `${state}x`, "user-one")).toBe(false);
  });

  it("encrypts tokens with authenticated encryption and rejects tampering", () => {
    setValidEnvironment();
    const ciphertext = encryptYahooToken("refresh-token-value");
    expect(ciphertext).not.toContain("refresh-token-value");
    expect(decryptYahooToken(ciphertext)).toBe("refresh-token-value");
    const parts = ciphertext.split(".");
    parts[3] = `${parts[3][0] === "A" ? "B" : "A"}${parts[3].slice(1)}`;
    expect(() => decryptYahooToken(parts.join("."))).toThrow("yahoo_token_decryption_failed");
  });
});

describe("Yahoo provider normalization", () => {
  const ownedTeam = {
    team: [[
      { team_key: "449.l.123.t.4" },
      { team_id: "4" },
      { name: "Fourth and Long" },
      { is_owned_by_current_login: 1 },
      { waiver_priority: 3 },
      { faab_balance: 72 },
      { managers: [{ manager: [{ manager_id: "manager-4" }, { nickname: "Michael" }] }] },
    ]],
  };
  const otherTeam = { team: [[{ team_key: "449.l.123.t.8" }, { team_id: "8" }, { name: "Opponent" }, { is_owned_by_current_login: 0 }]] };

  it("discovers only teams explicitly owned by the logged-in Yahoo user", () => {
    const teams = normalizeYahooOwnedTeams({ fantasy_content: { users: [{ teams: { 0: ownedTeam, 1: otherTeam } }] } });
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ teamKey: "449.l.123.t.4", managerId: "manager-4", ownedByCurrentUser: true });
  });

  it("normalizes league slots, scoring, and every roster without first-team fallback", () => {
    const metadata = { fantasy_content: { league: [[{ league_key: "449.l.123" }, { league_id: "123" }, { name: "Family League" }, { season: "2026" }, { current_week: "4" }]] } };
    const settings = { fantasy_content: { league: [{ settings: [
      { roster_positions: { 0: { roster_position: [{ position: "QB" }, { count: 1 }] }, 1: { roster_position: [{ position: "W/R/T" }, { count: 2 }] }, 2: { roster_position: [{ position: "BN" }, { count: 6 }] } } },
      { stat_modifiers: { stats: { 0: { stat: [{ stat_id: "4" }, { value: "4" }] }, 1: { stat: [{ stat_id: "10" }, { value: "0.5" }] } } } },
    ] }] } };
    const teams = { fantasy_content: { league: [{ teams: { 0: ownedTeam, 1: otherTeam } }] } };
    const matchup = [
      { week: "4" }, { status: "midevent" }, { is_playoffs: "0" },
      { teams: {
        0: { team: [[{ team_key: "449.l.123.t.4" }, { team_points: { total: "81.25" } }, { team_projected_points: { total: "110.50" } }]] },
        1: { team: [[{ team_key: "449.l.123.t.8" }, { team_points: { total: "79.00" } }, { team_projected_points: { total: "99.25" } }]] },
      } },
    ];
    const scoreboard = { fantasy_content: { league: [{ scoreboard: [{ matchups: { 0: { matchup } } }] }] } };
    const player = (teamKey: string, playerKey: string, name: string, selected: string) => ({ fantasy_content: { team: [[{ team_key: teamKey }, { roster: { players: { 0: { player: [[{ player_key: playerKey }, { player_id: playerKey.split(".").pop() }, { name: { full: name } }, { editorial_team_abbr: "KC" }, { display_position: "QB" }, { selected_position: [{ position: selected }] }]] } } } }]] } });
    const rosterPayloads = new Map<string, unknown>([
      ["449.l.123.t.4", player("449.l.123.t.4", "449.p.1", "Starter One", "QB")],
      ["449.l.123.t.8", player("449.l.123.t.8", "449.p.2", "Bench Two", "BN")],
    ]);
    const imports = normalizeYahooLeagueImport(metadata, settings, teams, scoreboard, rosterPayloads, "449.l.123.t.4");

    expect(imports).toMatchObject({ leagueKey: "449.l.123", season: 2026, currentWeek: 4, ownedTeamKey: "449.l.123.t.4" });
    expect(imports.rosterSlots.map((slot) => slot.slotType)).toEqual(["QB", "FLEX", "BENCH"]);
    expect(imports.scoringModifiers).toEqual({ "4": 4, "10": 0.5 });
    expect(imports.teams).toHaveLength(2);
    expect(imports.teams[0].players[0]).toMatchObject({ playerKey: "449.p.1", fullName: "Starter One", selectedPosition: "QB" });
    expect(imports.teams[1].players[0]).toMatchObject({ playerKey: "449.p.2", selectedPosition: "BN" });
    expect(imports.matchups).toEqual([expect.objectContaining({
      week: 4,
      teamKeys: ["449.l.123.t.4", "449.l.123.t.8"],
      points: [81.25, 79],
      projectedPoints: [110.5, 99.25],
      status: "midevent",
    })]);

    expect(() => normalizeYahooLeagueImport(
      { fantasy_content: { league: [[{ league_key: "449.l.123" }, { league_id: "123" }, { name: "Missing season" }, { current_week: "4" }]] } },
      settings,
      teams,
      scoreboard,
      new Map(),
      "449.l.123.t.4"
    )).toThrow("yahoo_payload_invalid");
    expect(() => normalizeYahooLeagueImport(metadata, { fantasy_content: { roster_position: [{ position: "DB" }, { count: 1 }], stat: [{ stat_id: "4" }, { value: 4 }] } }, teams, scoreboard, rosterPayloads, "449.l.123.t.4"))
      .toThrow("yahoo_payload_unsupported");
    expect(() => normalizeYahooLeagueImport(metadata, { fantasy_content: { roster_position: [{ position: "QB" }, { count: 1 }] } }, teams, scoreboard, rosterPayloads, "449.l.123.t.4"))
      .toThrow("yahoo_payload_invalid");
    const missingSelected = new Map(rosterPayloads);
    missingSelected.set("449.l.123.t.4", { fantasy_content: { players: { 0: { player: [[{ player_key: "449.p.1" }, { name: { full: "Starter One" } }, { display_position: "QB" }]] } } } });
    expect(() => normalizeYahooLeagueImport(metadata, settings, teams, scoreboard, missingSelected, "449.l.123.t.4"))
      .toThrow("yahoo_payload_unsupported");
    expect(() => normalizeYahooMatchups({ fantasy_content: { matchups: {} } }, "449.l.123", 4, ["449.l.123.t.4", "449.l.123.t.8"]))
      .toThrow("yahoo_matchups_invalid");
    const foreignTeam = JSON.parse(JSON.stringify(scoreboard));
    foreignTeam.fantasy_content.league[0].scoreboard[0].matchups[0].matchup[3].teams[1].team[0][0].team_key = "449.l.123.t.99";
    expect(() => normalizeYahooMatchups(foreignTeam, "449.l.123", 4, ["449.l.123.t.4", "449.l.123.t.8"]))
      .toThrow("yahoo_matchups_invalid");
  });
});

describe("Yahoo migration security contract", () => {
  const migration = readFileSync(new URL("../supabase/migrations/0003_yahoo_integration.sql", import.meta.url), "utf8");
  const matchupMigration = readFileSync(new URL("../supabase/migrations/0004_yahoo_weekly_matchups.sql", import.meta.url), "utf8");

  it("stores ciphertext server-side and exposes no authenticated token policy", () => {
    expect(migration).toMatch(/access_token_ciphertext text not null/);
    expect(migration).toMatch(/refresh_token_ciphertext text not null/);
    expect(migration).toMatch(/alter table public\.provider_connections enable row level security/);
    expect(migration).not.toMatch(/create policy .*provider_connections/);
    expect(migration).toMatch(/check \(provider in \('sleeper', 'yahoo', 'manual'\)\)/);
    expect(migration).toMatch(/sync_lock_until timestamptz/);
    expect(migration).toMatch(/sync_version bigint not null default 0/);
    expect(migration).toMatch(/identity_status text not null default 'resolved'/);
    expect(migration).toMatch(/create table if not exists public\.provider_identity_queue/);
    expect(migration).toMatch(/alter table public\.provider_identity_queue enable row level security/);
    expect(migration).not.toMatch(/create policy .*provider_identity_queue/);
  });

  it("keeps current-week matchups league-scoped and server-written", () => {
    expect(matchupMigration).toMatch(/foreign key \(team_a_roster_id, league_id\) references public\.rosters\(id, league_id\)/);
    expect(matchupMigration).toMatch(/foreign key \(team_b_roster_id, league_id\) references public\.rosters\(id, league_id\)/);
    expect(matchupMigration).toMatch(/alter table public\.league_week_matchups enable row level security/);
    expect(matchupMigration).toMatch(/for select to authenticated using \(public\.can_access_league\(league_id\)\)/);
    expect(matchupMigration).not.toMatch(/for (insert|update|delete|all) to authenticated/);
  });
});
