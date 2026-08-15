"use client";

import { PageHeader } from "@/components/page-header";
import { ConfigurationBanner } from "@/components/configuration-banner";
import { DecisionCard } from "@/components/decision-card";
import { demoRecommendations, demoWhatChangedToday } from "@/lib/demo";
import { Clock, RefreshCw, Flame } from "lucide-react";

export default function TodayPage() {
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
          <DecisionCard key={item.id} item={item} />
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
