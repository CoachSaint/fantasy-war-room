"use client";

import { PageHeader } from "@/components/page-header";
import { ConfigurationBanner } from "@/components/configuration-banner";
import { demoWaiverPairs } from "@/lib/demo";
import { ConnectedDecisions } from "@/components/connected-decisions";
import { LeagueGate } from "@/components/league-gate";
import { useConnectedLeague } from "@/lib/use-connected-league";
import { DollarSign, Calendar, Flame } from "lucide-react";

export default function WaiversPage() {
  const league = useConnectedLeague();
  if (league.status === "loading") return <LeagueGate state={league} />;
  if (league.status === "connected") {
    return <ConnectedDecisions leagueId={league.context.league.id} leagueName={league.context.league.name} eyebrow="Waiver wire" title="Add and drop decisions" description="Fresh waiver recommendations from your connected league." kinds={["add", "drop"]} />;
  }
  if (league.status !== "auth_required" || process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return <LeagueGate state={league} />;
  return <DemoWaiversPage />;
}

function DemoWaiversPage() {
  return (
    <>
      <ConfigurationBanner message="Waiver pairs and FAAB guidance are demo fixtures until league availability and budget history are connected." />
      <PageHeader
        eyebrow="Waiver Wire Allocator"
        title="Available to you, not the internet."
        description="Rank only players the league can actually add, then price the move against roster need, role change, rest-of-season value, and acquisition cost."
      />

      <section style={{ display: "grid", gap: 20, marginBottom: 28 }}>
        {demoWaiverPairs.map((pair) => (
          <article
            key={pair.id}
            className="card"
            style={{
              display: "grid",
              gap: 20,
              borderLeft: "4px solid var(--good)",
            }}
          >
            {/* Top Bar: Urgency & WAR Score */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  className="pill"
                  style={{
                    borderColor: pair.urgency === "CRITICAL" ? "var(--bad)" : "var(--good)",
                    color: pair.urgency === "CRITICAL" ? "var(--bad)" : "var(--good)",
                    fontWeight: 700,
                  }}
                >
                  <Flame size={14} /> {pair.urgency} URGENCY
                </span>
                <span className="muted" style={{ fontSize: 13 }}>
                  ROS Outlook: <strong>{pair.rosOutlook}</strong>
                </span>
              </div>

              <div style={{ textAlign: "right" }}>
                <div className="score" style={{ fontSize: 40, color: "var(--good)" }}>
                  {pair.warScore}
                </div>
                <div className="muted" style={{ fontSize: 11 }}>WAR SCORE</div>
              </div>
            </div>

            {/* Action Pair Header */}
            <div>
              <h2 className="title" style={{ fontSize: 26, margin: "0 0 8px" }}>
                Add <span style={{ color: "var(--good)" }}>{pair.addPlayer.fullName}</span> ({pair.addPlayer.position} · {pair.addPlayer.team}) → Drop <span style={{ color: "var(--muted)" }}>{pair.dropPlayer.fullName}</span>
              </h2>
              <p className="muted" style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
                {pair.reason}
              </p>
            </div>

            {/* FAAB Recommendation Badge */}
            <div
              style={{
                padding: "12px 18px",
                borderRadius: 16,
                background: "rgba(22,133,75,0.1)",
                border: "1px solid rgba(22,133,75,0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <DollarSign size={20} style={{ color: "var(--good)" }} />
                <div>
                  <strong style={{ fontSize: 14 }}>Recommended FAAB Bid: {pair.faabPercent} of budget</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Based on league bidding history and roster replacement demand.
                  </div>
                </div>
              </div>
              <button
                type="button"
                disabled
                title="Connect a league to enable FAAB actions"
                style={{
                  padding: "8px 18px",
                  borderRadius: 999,
                  background: "var(--text)",
                  color: "var(--bg)",
                  fontWeight: 700,
                  fontSize: 12,
                  border: 0,
                  cursor: "not-allowed",
                  opacity: 0.7,
                }}
              >
                Copy unavailable in demo
              </button>
            </div>

            {/* 3-Week Outlook Grid */}
            <div style={{ background: "var(--surface)", padding: 16, borderRadius: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }} className="muted">
                <Calendar size={13} style={{ display: "inline", marginRight: 6 }} /> 3-Week Schedule Outlook
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                {pair.threeWeekOutlook.map((wk) => (
                  <div
                    key={wk.week}
                    style={{
                      padding: 10,
                      borderRadius: 12,
                      background: "var(--surface-strong)",
                      border: "1px solid var(--line)",
                      fontSize: 12,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{wk.week}</div>
                    <div className="muted">{wk.opponent}</div>
                    <span
                      style={{
                        display: "inline-block",
                        marginTop: 4,
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: wk.difficulty.includes("Easy") || wk.difficulty.includes("Favorable") ? "var(--good)" : "var(--warn)",
                      }}
                    >
                      {wk.difficulty}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
