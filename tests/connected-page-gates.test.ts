import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LeagueState } from "@/lib/use-connected-league";

const league = vi.hoisted(() => ({ state: { status: "unavailable" } as LeagueState }));
vi.mock("@/lib/use-connected-league", () => ({ useConnectedLeague: () => league.state }));

import TodayPage from "@/app/today/page";
import LineupPage from "@/app/lineup/page";
import WaiversPage from "@/app/waivers/page";
import PlayersPage from "@/app/players/page";
import DraftPage from "@/app/draft/page";

const pages = [TodayPage, LineupPage, WaiversPage, PlayersPage, DraftPage];

describe("connected page gates with demo mode enabled", () => {
  it.each(pages)("shows an error when league context fails", (Page) => {
    league.state = { status: "unavailable" };
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    const html = renderToStaticMarkup(createElement(Page));
    expect(html).toContain("League unavailable");
    expect(html).not.toContain("Demo snapshot");
  });

  it.each(pages)("directs signed-in users without a league to setup", (Page) => {
    league.state = { status: "setup_required" };
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    const html = renderToStaticMarkup(createElement(Page));
    expect(html).toContain("League setup required");
    expect(html).toContain("/league/setup");
  });

  it.each(pages)("keeps the signed-out demo available", (Page) => {
    league.state = { status: "auth_required" };
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    const html = renderToStaticMarkup(createElement(Page));
    expect(html).toMatch(/demo/i);
    expect(html).not.toContain("Sign in required");
  });
});
