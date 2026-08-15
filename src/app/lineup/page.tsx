"use client";

import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { ConfigurationBanner } from "@/components/configuration-banner";
import { demoStartSitPairs } from "@/lib/demo";
import { PlayerCompareModal } from "@/components/player-compare-modal";
import { ShieldCheck, ArrowRight, Zap } from "lucide-react";

export default function LineupPage() {
  const [activeCompare, setActiveCompare] = useState<(typeof demoStartSitPairs)[0] | null>(null);

  return (
    <>
      <ConfigurationBanner message="Start/sit pairs are illustrative until your roster, scoring, and current injury feeds are connected." />
      <PageHeader
        eyebrow="Lineup Lab"
        title="Two decisions need attention."
        description="Show only lineup choices that are actually close, newly changed, stale, or materially affected by injury and usage information."
      />

      <section className="grid grid-2" style={{ marginBottom: 28 }}>
        {demoStartSitPairs.map((pair) => (
          <article
            key={pair.id}
            className="card"
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: 20,
            }}
          >
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <span className="pill" style={{ borderColor: "var(--good)", color: "var(--good)", fontWeight: 700 }}>
                  <Zap size={13} /> START RECOMMENDATION
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--good)" }}>
                  <ShieldCheck size={14} style={{ display: "inline", marginRight: 4 }} />
                  {pair.confidence}% confidence
                </span>
              </div>

              <h2 style={{ margin: "0 0 10px", fontSize: 24, fontWeight: 750, letterSpacing: "-.02em" }}>
                Start {pair.startPlayer.fullName} over {pair.sitPlayer.fullName}
              </h2>
              <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
                {pair.recommendationReason}
              </p>

              {/* Projection Spectrum Bar (Floor / Median / Ceiling) */}
              <div style={{ marginTop: 20, background: "var(--surface)", padding: 14, borderRadius: 16, display: "grid", gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }} className="muted">
                  Projection Spectrum (PPG Floor / Median / Ceiling)
                </div>

                {/* Start Player Spectrum */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, color: "var(--good)" }}>{pair.startPlayer.fullName} (START)</span>
                    <span style={{ fontWeight: 700 }}>{pair.startFloorCeiling.median} PPG</span>
                  </div>
                  <div style={{ height: 8, background: "rgba(22,133,75,0.15)", borderRadius: 999, overflow: "hidden", position: "relative" }}>
                    <div
                      style={{
                        position: "absolute",
                        left: `${(pair.startFloorCeiling.floor / 35) * 100}%`,
                        width: `${((pair.startFloorCeiling.ceiling - pair.startFloorCeiling.floor) / 35) * 100}%`,
                        height: "100%",
                        background: "var(--good)",
                        borderRadius: 999,
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5 }} className="muted">
                    <span>Floor: {pair.startFloorCeiling.floor}</span>
                    <span>Ceiling: {pair.startFloorCeiling.ceiling}</span>
                  </div>
                </div>

                {/* Sit Player Spectrum */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }} className="muted">{pair.sitPlayer.fullName} (SIT)</span>
                    <span className="muted">{pair.sitFloorCeiling.median} PPG</span>
                  </div>
                  <div style={{ height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden", position: "relative" }}>
                    <div
                      style={{
                        position: "absolute",
                        left: `${(pair.sitFloorCeiling.floor / 35) * 100}%`,
                        width: `${((pair.sitFloorCeiling.ceiling - pair.sitFloorCeiling.floor) / 35) * 100}%`,
                        height: "100%",
                        background: "var(--muted)",
                        borderRadius: 999,
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5 }} className="muted">
                    <span>Floor: {pair.sitFloorCeiling.floor}</span>
                    <span>Ceiling: {pair.sitFloorCeiling.ceiling}</span>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setActiveCompare(pair)}
              style={{
                width: "100%",
                minHeight: 44,
                borderRadius: 999,
                background: "var(--text)",
                color: "var(--bg)",
                fontWeight: 700,
                fontSize: 13,
                border: 0,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <span>Inspect Full Rationale & Matchup</span>
              <ArrowRight size={15} />
            </button>
          </article>
        ))}
      </section>

      {/* Head to Head Comparison Modal */}
      {activeCompare && (
        <PlayerCompareModal
          playerA={activeCompare.startPlayer}
          playerB={activeCompare.sitPlayer}
          onClose={() => setActiveCompare(null)}
        />
      )}
    </>
  );
}
