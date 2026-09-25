"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ConfigurationBanner } from "@/components/configuration-banner";
import { DecisionCard } from "@/components/decision-card";
import { LeagueGate } from "@/components/league-gate";
import { demoRecommendations, demoWhatChangedToday } from "@/lib/demo";
import { useConnectedLeague } from "@/lib/use-connected-league";
import type { Evidence, Recommendation } from "@/lib/types";
import type { BriefChange } from "@/lib/engine/daily-brief";
import { Clock, RefreshCw, Flame } from "lucide-react";

type TodaySignals = {
  rosterObservedAt: string;
  injuries: Array<{ playerId: string; playerName: string; position: string; status: string;
    previousStatus: string | null; summary: string; observedAt: string;
    sourceUrl: string | null; evidenceId: string; changed: boolean }>;
  risers: Array<{ playerId: string; playerName: string; position: string; latestWeek: number;
    priorWeek: number; latestPoints: number; priorPoints: number; change: number; observedAt: string }>;
  fallers: TodaySignals["risers"];
};

export default function TodayPage() {
  const league = useConnectedLeague();
  if (league.status === "loading") return <LeagueGate state={league} />;
  if (league.status === "connected") {
    return <ConnectedToday leagueId={league.context.league.id} leagueName={league.context.league.name} />;
  }
  if (league.status !== "auth_required" || process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return <LeagueGate state={league} />;
  return <DemoTodayPage />;
}

function ConnectedToday({ leagueId, leagueName }: { leagueId: string; leagueName: string }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "unavailable" }
    | { status: "ready"; recommendations: Recommendation[]; evidence: Evidence[]; checkedAt: number }
  >({ status: "loading" });
  const [brief, setBrief] = useState<
    | { status: "loading" | "unavailable" | "not_ready" }
    | { status: "ready"; stale: boolean; computedAt: string; baselineAt: string | null; changes: BriefChange[] }
  >({ status: "loading" });
  const [clock, setClock] = useState<number | null>(null);
  const [signals, setSignals] = useState<
    | { status: "loading" | "unavailable" | "roster_stale" }
    | { status: "ready"; data: TodaySignals }
  >({ status: "loading" });

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/today/signals?leagueId=${encodeURIComponent(leagueId)}`, {
          credentials: "same-origin", signal: controller.signal,
        });
        const payload = await response.json() as TodaySignals & { error?: string };
        if (!response.ok) return setSignals({ status: payload.error === "yahoo_roster_sync_stale" ? "roster_stale" : "unavailable" });
        if (!Array.isArray(payload.injuries) || !Array.isArray(payload.risers) || !Array.isArray(payload.fallers)) {
          return setSignals({ status: "unavailable" });
        }
        setSignals({ status: "ready", data: payload });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSignals({ status: "unavailable" });
      }
    })();
    return () => controller.abort();
  }, [leagueId]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/recommendations?leagueId=${encodeURIComponent(leagueId)}&limit=20`, { credentials: "same-origin", signal: controller.signal });
        if (!response.ok) return setState({ status: "unavailable" });
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("data" in body)) return setState({ status: "unavailable" });
        const payload = body as { data: Recommendation[]; evidence?: Evidence[] };
        if (!Array.isArray(payload.data)) return setState({ status: "unavailable" });
        setState({ status: "ready", recommendations: payload.data, evidence: Array.isArray(payload.evidence) ? payload.evidence : [], checkedAt: Date.now() });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "unavailable" });
      }
    })();
    return () => controller.abort();
  }, [leagueId]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/brief?leagueId=${encodeURIComponent(leagueId)}`, { credentials: "same-origin", signal: controller.signal });
        if (!response.ok) return setBrief({ status: "unavailable" });
        const body: unknown = await response.json();
        if (!body || typeof body !== "object") return setBrief({ status: "unavailable" });
        const value = body as { status?: string; data?: { computedAt?: string; payload?: { baseline?: { computedAt?: string }; changes?: BriefChange[] } } };
        if (value.status === "not_ready") return setBrief({ status: "not_ready" });
        if (!value.data || typeof value.data.computedAt !== "string" || !Array.isArray(value.data.payload?.changes)) {
          return setBrief({ status: "unavailable" });
        }
        setBrief({ status: "ready", stale: value.status === "stale", computedAt: value.data.computedAt,
          baselineAt: value.data.payload?.baseline?.computedAt || null, changes: value.data.payload.changes });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setBrief({ status: "unavailable" });
      }
    })();
    return () => controller.abort();
  }, [leagueId]);

  const fresh = state.status === "ready"
    ? state.recommendations.filter((recommendation) => new Date(recommendation.freshUntil).getTime() > (clock ?? state.checkedAt))
    : [];
  return (
    <>
      <PageHeader eyebrow="Connected league · preview" title={leagueName} description="Only persisted recommendations for your authenticated league appear here." />
      <section className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Roster signals</h2>
        {signals.status === "loading" && <p role="status">Checking injury reports and recent games…</p>}
        {signals.status === "unavailable" && <p role="alert">Roster signals could not be verified. No injury or performance changes were inferred.</p>}
        {signals.status === "roster_stale" && <p role="alert">Your Yahoo roster import is older than six hours. Refresh it to see current roster signals.</p>}
        {signals.status === "ready" && <>
          <p className="muted" style={{ fontSize: 12 }}>Owned roster checked {new Date(signals.data.rosterObservedAt).toLocaleString()}. Injury reports were observed from nflverse; game movements compare published PPR results, not forecasts or changes since yesterday.</p>
          <div className="grid grid-2" style={{ gap: 16 }}>
            <div>
              <h3 style={{ marginTop: 0 }}>Injury reports</h3>
              {signals.data.injuries.length === 0 && <p className="muted">No recent current-week injury report was saved for your roster. This does not verify every player is healthy.</p>}
              {signals.data.injuries.map((item) => <article key={item.evidenceId} style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10 }}>
                <strong>{item.playerName} · {item.position} · {item.status}</strong>
                {item.changed && item.previousStatus && <div>Changed from {item.previousStatus}</div>}
                <p className="muted" style={{ fontSize: 12, margin: "4px 0" }}>{item.summary}</p>
                <span className="muted" style={{ fontSize: 12 }}>Checked {new Date(item.observedAt).toLocaleString()}</span>
                {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ display: "block", fontSize: 12 }}>Injury source</a>}
              </article>)}
            </div>
            <div>
              <h3 style={{ marginTop: 0 }}>Recent game movement</h3>
              {signals.data.risers.length === 0 && signals.data.fallers.length === 0 && <p className="muted">Two recent published games are needed before a movement can be shown.</p>}
              {[...signals.data.risers, ...signals.data.fallers].map((item) => <article key={item.playerId} style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10 }}>
                <strong>{item.playerName} · {item.position} · {item.change > 0 ? "+" : ""}{item.change.toFixed(1)} PPR</strong>
                <div className="muted" style={{ fontSize: 12 }}>Week {item.priorWeek}: {item.priorPoints.toFixed(1)} → Week {item.latestWeek}: {item.latestPoints.toFixed(1)}</div>
              </article>)}
            </div>
          </div>
        </>}
      </section>
      {state.status === "loading" && <p role="status">Loading current decisions…</p>}
      {state.status === "unavailable" && <p role="alert">Recommendations are unavailable. No demo decisions were substituted.</p>}
      {state.status === "ready" && (
        <>
          {fresh.length === 0 ? (
            <section className="card"><h2 style={{ marginTop: 0 }}>No current recommendations yet</h2><p className="muted">The connected league has no fresh materialized decisions. Import its roster and complete a successful Scout run before relying on this brief.</p></section>
          ) : (
            <section className="grid grid-3">
              {fresh.slice(0, 3).map((item) => <DecisionCard key={item.id} item={item} evidence={state.evidence} />)}
            </section>
          )}
          <section className="card" style={{ marginTop: 24 }}>
            <h2 style={{ marginTop: 0 }}>What changed since the previous brief?</h2>
            {brief.status === "loading" && <p role="status">Loading the decision change brief…</p>}
            {brief.status === "unavailable" && <p role="alert">The decision change brief is unavailable.</p>}
            {brief.status === "not_ready" && <p className="muted">No connected brief has been materialized yet.</p>}
            {brief.status === "ready" && (
              <>
                <p className="muted">Computed {new Date(brief.computedAt).toLocaleString()}{brief.stale ? " · Stale" : ""}.</p>
                {brief.stale ? (
                  <p className="muted">This brief has expired. Refresh the league before acting on changes.</p>
                ) : !brief.baselineAt ? (
                  <p className="muted">First brief saved. A comparison will appear after the next Scout run.</p>
                ) : brief.changes.length === 0 ? (
                  <p className="muted">No materialized decision changes since {new Date(brief.baselineAt).toLocaleString()}.</p>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {brief.changes.map((change, index) => (
                      <div key={`${change.kind}-${change.action.subjectPlayerId}-${index}`} style={{ padding: 12, border: "1px solid var(--line)", borderRadius: 12 }}>
                        <strong>{change.kind === "new_action" ? "New action" : change.kind === "removed_action" ? "No longer in the current brief" : "Priority changed"}</strong>
                        <div>{change.action.headline}</div>
                        {change.kind === "priority_changed" && <div className="muted">Priority index {change.previousScore} → {change.action.score}</div>}
                      </div>
                    ))}
                  </div>
                )}
                <p className="muted" style={{ marginBottom: 0 }}>This brief tracks saved recommendation changes. Roster injury reports and past game movement appear separately above; they are not part of this brief&apos;s daily comparison.</p>
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}

function DemoTodayPage() {
  return (
    <>
      <ConfigurationBanner />
      <PageHeader
        eyebrow="Demo snapshot · intelligence preview"
        title="Three moves matter today."
        description="The daily brief is a decision delta, not a news feed. Every action carries a score, confidence, freshness, and evidence trail."
      />

      {/* Top High-Value Action Banner */}
      <section
        style={{
          marginBottom: 24,
          padding: 20,
          borderRadius: 24,
          background: "linear-gradient(135deg, rgba(22,133,75,0.14) 0%, rgba(22,133,75,0.04) 100%)",
          border: "1px solid rgba(22,133,75,0.25)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "var(--good)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 8px 24px rgba(22,133,75,0.4)",
            }}
          >
            <Flame size={22} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", color: "var(--good)", textTransform: "uppercase" }}>
              CRITICAL WAIVER PRIORITY
            </div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 750 }}>
              Add Isaiah Likely (TE · BAL) — Target Share +24% Surge
            </h3>
          </div>
        </div>

        <button
          type="button"
          disabled
          title="Connect a league to enable refresh"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 18px",
            borderRadius: 999,
            background: "var(--text)",
            color: "var(--bg)",
            fontWeight: 700,
            fontSize: 13,
            border: 0,
            cursor: "not-allowed",
            opacity: 0.7,
          }}
        >
          <RefreshCw size={14} />
          <span>Refresh requires setup</span>
        </button>
      </section>

      {/* Decision Cards Grid */}
      <section className="grid grid-3" style={{ marginBottom: 28 }}>
        {demoRecommendations.map((item) => (
          <DecisionCard key={item.id} item={item} demo />
        ))}
      </section>

      {/* "What Changed Today?" Structured Diff Section */}
      <section className="card" style={{ display: "grid", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span className="eyebrow">Delta Tracker</span>
            <h2 className="title" style={{ marginTop: 6 }}>
              What changed since yesterday?
            </h2>
          </div>
          <span className="pill">
            <Clock size={13} /> Demo snapshot
          </span>
        </div>

        <p className="muted" style={{ maxWidth: 760, margin: 0, fontSize: 14 }}>
          Structured diff between the newest successful Scout snapshot and the previous baseline.
        </p>

        <div style={{ display: "grid", gap: 12 }}>
          {demoWhatChangedToday.map((item) => (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 18px",
                borderRadius: 18,
                background: "var(--surface)",
                border: "1px solid var(--line)",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 750,
                    padding: "4px 10px",
                    borderRadius: 999,
                    background:
                      item.significance === "critical"
                        ? "rgba(180,35,24,0.12)"
                        : item.significance === "high"
                        ? "rgba(22,133,75,0.12)"
                        : "rgba(0,0,0,0.06)",
                    color:
                      item.significance === "critical"
                        ? "var(--bad)"
                        : item.significance === "high"
                        ? "var(--good)"
                        : "var(--muted)",
                  }}
                >
                  {item.type}
                </span>
                <div>
                  <strong style={{ fontSize: 15 }}>{item.player}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Source: {item.source} • {item.time}
                  </div>
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 750, fontSize: 14, color: "var(--good)" }}>{item.delta}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {item.metric}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
