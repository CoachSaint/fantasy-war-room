"use client";

import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ConfigurationBanner } from "@/components/configuration-banner";
import { demoPlayers, type ExtendedPlayer } from "@/lib/demo";
import { PlayerCompareModal } from "@/components/player-compare-modal";
import { ArrowUpDown, AlertCircle } from "lucide-react";

type Mode = "best" | "value" | "safe" | "upside";
type PositionFilter = "ALL" | "QB" | "RB" | "WR" | "TE";

export default function DraftPage() {
  const [mode, setMode] = useState<Mode>("best");
  const [posFilter, setPosFilter] = useState<PositionFilter>("ALL");
  const [comparingPlayers, setComparingPlayers] = useState<[ExtendedPlayer, ExtendedPlayer] | null>(null);

  // Filter players by position
  const filteredPlayers = demoPlayers.filter((p) => {
    if (posFilter === "ALL") return true;
    return p.position === posFilter;
  });

  // Sort players depending on active recommendation mode
  const sortedPlayers = [...filteredPlayers].sort((a, b) => {
    if (mode === "best") return b.projectedPpg - a.projectedPpg;
    if (mode === "value") return a.adp - b.adp;
    if (mode === "safe") return b.floorPpg - a.floorPpg;
    if (mode === "upside") return b.ceilingPpg - a.ceilingPpg;
    return 0;
  });

  return (
    <>
      <ConfigurationBanner message="Draft rankings use fixture players until league scoring and roster context are connected." />
      <PageHeader
        eyebrow="Draft Room Engine"
        title="Make the pick. Know why."
        description="Available-player recommendations react to scoring, roster construction, positional scarcity, and market value—not a static top-200 list."
      />

      {/* Mode Selector Tabs */}
      <section
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", gap: 8, background: "var(--surface)", padding: 6, borderRadius: 999, border: "1px solid var(--line)" }}>
          {(
            [
              ["best", "Best Pick"],
              ["value", "Best Value"],
              ["safe", "Safe Pick"],
              ["upside", "Upside Swing"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              style={{
                padding: "8px 16px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 650,
                border: 0,
                background: mode === key ? "var(--text)" : "transparent",
                color: mode === key ? "var(--bg)" : "var(--muted)",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Position Filters */}
        <div style={{ display: "flex", gap: 6 }}>
          {(["ALL", "QB", "RB", "WR", "TE"] as const).map((pos) => (
            <button
              key={pos}
              type="button"
              onClick={() => setPosFilter(pos)}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 650,
                border: "1px solid var(--line)",
                background: posFilter === pos ? "var(--surface-strong)" : "transparent",
                color: posFilter === pos ? "var(--text)" : "var(--muted)",
                cursor: "pointer",
              }}
            >
              {pos}
            </button>
          ))}
        </div>
      </section>

      {/* Positional Scarcity Banner */}
      <section
        style={{
          marginBottom: 24,
          padding: "14px 20px",
          borderRadius: 18,
          background: "rgba(255,179,77,0.12)",
          border: "1px solid rgba(255,179,77,0.3)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 13.5,
        }}
      >
        <AlertCircle size={18} style={{ color: "var(--warn)", flexShrink: 0 }} />
        <div>
          <strong>Positional Scarcity Alert:</strong> Tier 1 Tight Ends dropping fast. Adding a TE in Round 4 yields +4.2 PPG replacement edge.
        </div>
      </section>

      {/* Player Cards Grid */}
      <section className="grid grid-3" style={{ marginBottom: 28 }}>
        {sortedPlayers.map((player) => (
          <article
            key={player.id}
            className="card"
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: 16,
              position: "relative",
            }}
          >
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <span className="pill">
                  {player.position} · Tier {player.tier}
                </span>
                <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
                  ADP #{player.adp}
                </span>
              </div>

              <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 750 }}>{player.fullName}</h2>
              <div className="muted" style={{ fontSize: 13 }}>
                {player.team} • Bye Week {player.byeWeek}
              </div>

              {/* Stats Box */}
              <div
                style={{
                  marginTop: 14,
                  padding: 12,
                  borderRadius: 14,
                  background: "var(--surface)",
                  display: "grid",
                  gap: 6,
                  fontSize: 12.5,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Projected PPG:</span>
                  <strong style={{ color: "var(--good)" }}>{player.projectedPpg} pts</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Floor / Ceiling:</span>
                  <span>{player.floorPpg} - {player.ceilingPpg}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Target Share:</span>
                  <span>{player.targetShare}%</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                const otherPlayer = demoPlayers.find((p) => p.id !== player.id && p.position === player.position) || demoPlayers[0];
                setComparingPlayers([player, otherPlayer]);
              }}
              style={{
                width: "100%",
                minHeight: 44,
                border: 0,
                borderRadius: 999,
                background: "var(--text)",
                color: "var(--bg)",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <ArrowUpDown size={15} />
              <span>Compare vs Position</span>
            </button>
          </article>
        ))}
      </section>

      {/* Head to Head Compare Modal */}
      {comparingPlayers && (
        <PlayerCompareModal
          playerA={comparingPlayers[0]}
          playerB={comparingPlayers[1]}
          onClose={() => setComparingPlayers(null)}
        />
      )}
    </>
  );
}
