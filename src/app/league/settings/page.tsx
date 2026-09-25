"use client";

import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ConfigurationBanner } from "@/components/configuration-banner";
import { LeagueGate } from "@/components/league-gate";
import { useConnectedLeague } from "@/lib/use-connected-league";

export default function LeagueSettingsPage() {
  const state = useConnectedLeague();
  if (state.status === "loading") return <LeagueGate state={state} />;
  if (state.status === "connected") {
    const { league, roster } = state.context;
    return (
      <>
        <PageHeader eyebrow={`League settings · ${league.name}`} title="Imported league context" description="The values below come from your authenticated league connection. They are read only here." />
        <section className="grid grid-2">
          <article className="card" style={{ display: "grid", gap: 8 }}><span className="eyebrow">League identity</span><strong style={{ fontSize: 18 }}>{league.name}</strong><span className="muted">{league.season} season · Week {league.currentWeek} · {league.provider}</span></article>
          <article className="card" style={{ display: "grid", gap: 8 }}><span className="eyebrow">Your team</span><strong style={{ fontSize: 18 }}>{roster?.name || "Team name unavailable"}</strong><span className="muted">{roster ? "Roster linked to your league membership" : "Your roster has not been linked yet"}</span></article>
          <article className="card" style={{ display: "grid", gap: 8 }}><span className="eyebrow">Scoring rules</span><strong style={{ fontSize: 18 }}>{league.scoringRuleCount ? `${league.scoringRuleCount} imported modifiers` : "No provider modifiers reported"}</strong><span className="muted">{league.receptionPoints == null ? "Reception points unavailable" : `${league.receptionPoints} points per reception`} · Decisions require exact scoring support.</span></article>
          <article className="card" style={{ display: "grid", gap: 8 }}><span className="eyebrow">Roster slots</span><strong style={{ fontSize: 18 }}>{league.rosterSlots.length} configured slots</strong><span className="muted">{league.rosterSlots.length ? league.rosterSlots.join(" · ") : "Slot definitions unavailable"}</span></article>
        </section>
        <p style={{ marginTop: 20 }}><Link href="/league/setup" style={{ color: "var(--good)", fontWeight: 700 }}>Connection and import controls</Link></p>
      </>
    );
  }
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return <LeagueGate state={state} />;
  return (
    <>
      <ConfigurationBanner message="Connect a league to see its verified settings." linkLabel="Start setup" href="/league/setup" />
      <PageHeader eyebrow="League settings" title="League context is pending." description="Scoring and roster rules appear here after an authenticated import." />
      <section className="card" style={{ maxWidth: 680 }}><p className="muted" style={{ margin: 0 }}>No connected league settings are available in demo mode.</p></section>
    </>
  );
}
