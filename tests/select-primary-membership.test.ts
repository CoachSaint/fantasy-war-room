import { describe, expect, it } from "vitest";
import { selectPrimaryMembership } from "@/lib/select-primary-membership";

describe("primary league selection", () => {
  it("uses the primary membership even when it is second", () => {
    const first = { membership: { isPrimary: false }, league: { id: "other" }, roster: { name: "Other roster" } };
    const primary = { membership: { isPrimary: true }, league: { id: "active" }, roster: { name: "Active roster" } };
    expect(selectPrimaryMembership([first, primary])).toBe(primary);
  });

  it("uses the first membership when none is marked primary", () => {
    const first = { membership: { isPrimary: false } };
    expect(selectPrimaryMembership([first, { membership: { isPrimary: false } }])).toBe(first);
  });

  it("uses a saved league only when it is in the authorized membership list", () => {
    const first = { membership: { isPrimary: true }, league: { id: "first" } };
    const second = { membership: { isPrimary: false }, league: { id: "second" } };
    expect(selectPrimaryMembership([first, second], "second")).toBe(second);
    expect(selectPrimaryMembership([first, second], "outsider")).toBe(first);
  });
});
