"use client";

import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ConfigurationBanner } from "@/components/configuration-banner";
import { demoPlayers, demoEvidence, type ExtendedPlayer } from "@/lib/demo";
import { Search, FileText } from "lucide-react";

type PosFilter = "ALL" | "QB" | "RB" | "WR" | "TE";

export default function PlayersPage() {
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState<PosFilter>("ALL");
  const [selectedPlayer, setSelectedPlayer] = useState<ExtendedPlayer>(demoPlayers[0]);

  const filteredPlayers = demoPlayers.filter((p) => {
    const matchesSearch = p.fullName.toLowerCase().includes(search.toLowerCase()) || (p.team && p.team.toLowerCase().includes(search.toLowerCase()));
    const matchesPos = posFilter === "ALL" || p.position === posFilter;
    return matchesSearch && matchesPos;
  });

  const playerEvidences = demoEvidence.filter((e) => e.playerId === selectedPlayer.id);

  return (
    <>
      <ConfigurationBanner message="Player identity, projections, and evidence are fixture data until provider connections are configured." />
      <PageHeader
        eyebrow="Player Intelligence Explorer"
        title="Every score has a trail."
        description="Search player identity, current role, projection, trend, and evidence without exposing provider-specific payloads to the interface."
      />

      {/* Search & Filter Section */}
      <section
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 24,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div style={{ flex: 1, minWidth: 260, position: "relative" }}>
          <Search
            size={18}
            className="muted"
            style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)" }}
          />
          <input
            aria-label="Search players"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search player name, team, or position..."
            style={{
              width: "100%",
              minHeight: 48,
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: "var(--surface-strong)",
              color: "var(--text)",
              paddingLeft: 46,
              paddingRight: 16,
              fontSize: 14,
              outline: "none",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {(["ALL", "QB", "RB", "WR", "TE"] as const).map((pos) => (
            <button
              key={pos}
              type="button"
              onClick={() => setPosFilter(pos)}
              style={{
                padding: "8px 16px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 650,
                border: "1px solid var(--line)",
                background: posFilter === pos ? "var(--text)" : "var(--surface)",
                color: posFilter === pos ? "var(--bg)" : "var(--muted)",
                cursor: "pointer",
              }}
            >
              {pos}
            </button>
          ))}
        </div>
      </section>

      {/* Player Grid & Evidence Detail View */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Left: Player List */}
        <section style={{ display: "grid", gap: 12 }}>
          {filteredPlayers.map((player) => {
            const isSelected = player.id === selectedPlayer.id;
            return (
              <div
                key={player.id}
                onClick={() => setSelectedPlayer(player)}
                style={{
                  padding: 16,
                  borderRadius: 20,
                  background: isSelected ? "var(--surface-strong)" : "var(--surface)",
                  border: isSelected ? "2px solid var(--text)" : "1px solid var(--line)",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  transition: "all 0.15s ease",
                }}
              >
                <div>
                  <span className="pill" style={{ fontSize: 11 }}>
                    {player.position} · {player.team}
                  </span>
                  <h3 style={{ margin: "6px 0 2px", fontSize: 18, fontWeight: 750 }}>{player.fullName}</h3>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Target Share: {player.targetShare}% • Snap Share: {player.snapShare}%
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div className="score" style={{ fontSize: 32 }}>
                    {player.projectedPpg}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>Proj PPG</div>
                </div>
              </div>
            );
          })}
        </section>

        {/* Right: Selected Player Detail Drawer */}
        <section className="card" style={{ display: "grid", gap: 20, height: "fit-content" }}>
          <div>
            <span className="pill" style={{ fontSize: 12 }}>{selectedPlayer.position} · {selectedPlayer.team} · Bye Week {selectedPlayer.byeWeek}</span>
            <h2 className="title" style={{ marginTop: 10, fontSize: 32 }}>{selectedPlayer.fullName}</h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              ADP #{selectedPlayer.adp} • Status: {selectedPlayer.status}
            </div>
          </div>

          {/* Usage Shares Box */}
          <div style={{ background: "var(--surface)", padding: 16, borderRadius: 18, display: "grid", gap: 10, fontSize: 13 }}>
            <div style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }} className="muted">
              Role & Usage Telemetry
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Projected PPG:</span>
              <strong style={{ color: "var(--good)" }}>{selectedPlayer.projectedPpg} PPG</strong>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Floor / Ceiling:</span>
              <span>{selectedPlayer.floorPpg} - {selectedPlayer.ceilingPpg} PPG</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Snap Share:</span>
              <span>{selectedPlayer.snapShare}%</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Target Share:</span>
              <span>{selectedPlayer.targetShare}%</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Red Zone Touch Share:</span>
              <span>{selectedPlayer.redzoneTouchShare}%</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Matchup:</span>
              <span style={{ fontWeight: 700, color: selectedPlayer.matchupDifficulty === "easy" ? "var(--good)" : "var(--warn)" }}>
                {selectedPlayer.matchupRank}
              </span>
            </div>
          </div>

          {/* Evidence Trail List */}
          <div>
            <h3 style={{ fontSize: 16, margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <FileText size={16} /> Evidence Trail ({playerEvidences.length} items)
            </h3>

            {playerEvidences.length > 0 ? (
              <div style={{ display: "grid", gap: 10 }}>
                {playerEvidences.map((ev) => (
                  <div
                    key={ev.id}
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      background: "var(--surface)",
                      border: "1px solid var(--line)",
                      fontSize: 12.5,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: "var(--good)" }}>{ev.type.toUpperCase()}</span>
                      <span className="muted">{Math.round(ev.confidence * 100)}% confidence</span>
                    </div>
                    <div style={{ lineHeight: 1.4 }}>{ev.summary}</div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Source: {ev.source}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 13 }}>
                Scout monitoring active. Baseline nflverse metrics updated for Week 1.
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
