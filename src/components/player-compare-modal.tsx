"use client";

import { X, Trophy, ShieldAlert, ArrowRight, Zap, Target } from "lucide-react";
import type { ExtendedPlayer } from "@/lib/demo";

interface PlayerCompareModalProps {
  playerA: ExtendedPlayer;
  playerB: ExtendedPlayer;
  onClose: () => void;
}

export function PlayerCompareModal({ playerA, playerB, onClose }: PlayerCompareModalProps) {
  const winner = playerA.projectedPpg >= playerB.projectedPpg ? playerA : playerB;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: "min(720px, 100%)",
          background: "var(--surface-strong)",
          borderRadius: 28,
          border: "1px solid var(--line)",
          padding: 28,
          boxShadow: "0 32px 90px rgba(0,0,0,0.5)",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Trophy size={22} style={{ color: "#ffd700" }} />
            <div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 750 }}>Head-to-Head Player Comparison</h2>
              <span className="muted" style={{ fontSize: 12 }}>Deterministic scoring engine analysis</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "none", border: 0, color: "var(--muted)", cursor: "pointer" }}
          >
            <X size={22} />
          </button>
        </div>

        {/* Winner Announcement Banner */}
        <div
          style={{
            padding: "14px 18px",
            borderRadius: 16,
            background: "rgba(22,133,75,0.12)",
            border: "1px solid rgba(22,133,75,0.3)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 24,
          }}
        >
          <Zap size={20} style={{ color: "var(--good)" }} />
          <div style={{ fontSize: 13 }}>
            <strong>Engine Recommendation: Start {winner.fullName}</strong>
            <div className="muted" style={{ fontSize: 12 }}>
              +{Math.abs(playerA.projectedPpg - playerB.projectedPpg).toFixed(1)} PPG edge driven by higher target share and floor stability.
            </div>
          </div>
        </div>

        {/* Comparison Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {[playerA, playerB].map((player) => {
            const isFavored = player.id === winner.id;
            return (
              <div
                key={player.id}
                style={{
                  padding: 20,
                  borderRadius: 20,
                  background: isFavored ? "var(--surface)" : "rgba(0,0,0,0.02)",
                  border: isFavored ? "2px solid var(--good)" : "1px solid var(--line)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                  <div>
                    <span className="pill" style={{ fontSize: 11 }}>{player.position} · {player.team}</span>
                    <h3 style={{ margin: "6px 0 2px", fontSize: 20, fontWeight: 750 }}>{player.fullName}</h3>
                    <span className="muted" style={{ fontSize: 12 }}>Bye Week {player.byeWeek}</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="score" style={{ fontSize: 36, color: isFavored ? "var(--good)" : "var(--text)" }}>
                      {player.projectedPpg}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>Proj PPG</div>
                  </div>
                </div>

                {/* Metrics Breakdown */}
                <div style={{ display: "grid", gap: 8, fontSize: 12.5, background: "rgba(0,0,0,0.03)", padding: 12, borderRadius: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="muted">Floor / Ceiling:</span>
                    <span style={{ fontWeight: 650 }}>{player.floorPpg} – {player.ceilingPpg} pts</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="muted">Target Share:</span>
                    <span style={{ fontWeight: 650 }}>{player.targetShare}%</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="muted">Snap Share:</span>
                    <span style={{ fontWeight: 650 }}>{player.snapShare}%</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="muted">Matchup:</span>
                    <span style={{ fontWeight: 650, color: player.matchupDifficulty === "easy" ? "var(--good)" : "var(--warn)" }}>
                      {player.matchupRank}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="muted">Injury Risk:</span>
                    <span style={{ fontWeight: 650, color: player.injuryRiskScore > 30 ? "var(--warn)" : "var(--good)" }}>
                      {player.injuryRiskScore}%
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: 24,
            width: "100%",
            minHeight: 46,
            borderRadius: 999,
            background: "var(--text)",
            color: "var(--bg)",
            fontWeight: 700,
            border: 0,
            cursor: "pointer",
          }}
        >
          Done Comparing
        </button>
      </div>
    </div>
  );
}
