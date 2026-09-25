import { describe, expect, it } from "vitest";
import { activeConnectedMembership } from "@/lib/active-connected-membership";

const first = { membership: { leagueId: "first", isPrimary: true }, league: { id: "first" }, roster: { id: "roster-one" } };
const second = { membership: { leagueId: "second", isPrimary: false }, league: { id: "second" }, roster: { id: "roster-two" } };

describe("validated active connected league", () => {
  it("selects the server-approved second league across consumers", () => {
    const payload = { ok: true, status: "ready", setupRequired: false,
      data: { memberships: [first, second], activeLeagueId: "second", selectableLeagueIds: ["first", "second"] } };
    expect(activeConnectedMembership(payload)).toBe(second);
  });

  it("refuses setup-required and invalid active mappings even when another membership exists", () => {
    const data = { memberships: [first], activeLeagueId: null, selectableLeagueIds: [] };
    expect(activeConnectedMembership({ ok: true, status: "setup_required", setupRequired: true, data })).toBeNull();
    expect(activeConnectedMembership({ ok: true, status: "ready", setupRequired: false,
      data: { ...data, activeLeagueId: "outsider", selectableLeagueIds: ["outsider"] } })).toBeNull();
    expect(activeConnectedMembership({ ok: true, status: "ready", setupRequired: false,
      data: { memberships: [{ ...first, roster: null }], activeLeagueId: "first", selectableLeagueIds: ["first"] } })).toBeNull();
  });
});
