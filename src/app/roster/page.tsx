"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useConnectedLeague } from "@/lib/use-connected-league";

type RosterPlayer = { id: string; fullName: string; team: string | null; position: string; status: string | null; designation: string };
type RosterResult = { name: string; updatedAt: string; players: RosterPlayer[] };

export default function RosterPage() {
  const league = useConnectedLeague();
  const [roster, setRoster] = useState<RosterResult | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "unavailable">("loading");
  const leagueId = league.status === "connected" ? league.context.league.id : null;

  useEffect(() => {
    if (!leagueId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/roster?leagueId=${encodeURIComponent(leagueId)}`, { credentials: "same-origin", signal: controller.signal });
        if (!response.ok) return setLoadState("unavailable");
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("roster" in body) || !("players" in body)) return setLoadState("unavailable");
        const payload = body as { roster: { name: string; updatedAt: string }; players: RosterPlayer[] };
        if (!Array.isArray(payload.players)) return setLoadState("unavailable");
        setRoster({ name: payload.roster.name, updatedAt: payload.roster.updatedAt, players: payload.players });
        setLoadState("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadState("unavailable");
      }
    })();
    return () => controller.abort();
  }, [leagueId]);

  return (
    <>
      <PageHeader eyebrow="Roster workspace" title="Your roster." description="Starters, bench, and injury designations from your connected league." />
      {league.status === "loading" && <p role="status">Checking your league…</p>}
      {league.status === "auth_required" && <p role="status">Sign in to see your roster. <Link href="/auth">Sign in</Link></p>}
      {league.status === "setup_required" && <p role="status">No league is connected yet. <Link href="/league/setup">Connect a league</Link></p>}
      {league.status === "unavailable" && <p role="alert">League context is unavailable. Please try again.</p>}
      {league.status === "connected" && loadState === "loading" && <p role="status">Loading your roster…</p>}
      {league.status === "connected" && loadState === "unavailable" && <p role="alert">Your roster could not be loaded. No player data was inferred.</p>}
      {league.status === "connected" && loadState === "ready" && roster && (
        <section className="card" style={{ display: "grid", gap: 16 }}>
          <div>
            <h2 style={{ margin: 0 }}>{roster.name}</h2>
            <p className="muted" style={{ margin: "6px 0 0" }}>Updated {new Date(roster.updatedAt).toLocaleString()} · {roster.players.length} players</p>
          </div>
          {roster.players.length === 0 ? <p className="muted">The connected league has no roster players yet. Run its provider import.</p> : (
            <div style={{ display: "grid", gap: 8 }}>
              {roster.players.map((player) => (
                <div key={player.id} style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", padding: 12, border: "1px solid var(--line)", borderRadius: 12 }}>
                  <div><strong>{player.fullName}</strong><div className="muted" style={{ fontSize: 12 }}>{player.position} · {player.team ?? "No team"}{player.status ? ` · ${player.status}` : ""}</div></div>
                  <span className="pill">{player.designation.toUpperCase()}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
