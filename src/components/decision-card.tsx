"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ShieldCheck, Zap, Info } from "lucide-react";
import type { Recommendation } from "@/lib/types";
import { demoEvidence } from "@/lib/demo";

const label: Record<Recommendation["kind"], string> = {
  draft: "Draft",
  start: "Start",
  sit: "Sit",
  add: "Add",
  drop: "Drop",
  hold: "Hold",
  watch: "Watch",
};

const kindColor: Record<Recommendation["kind"], string> = {
  draft: "#3b82f6",
  start: "var(--good)",
  sit: "var(--bad)",
  add: "var(--good)",
  drop: "var(--bad)",
  hold: "var(--warn)",
  watch: "var(--warn)",
};

export function DecisionCard({ item }: { item: Recommendation }) {
  const [expanded, setExpanded] = useState(false);
  const color = kindColor[item.kind] || "var(--good)";

  const itemEvidences = demoEvidence.filter((e) => item.evidenceIds.includes(e.id));

  return (
    <article
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 18,
        position: "relative",
        transition: "transform 0.2s ease, box-shadow 0.2s ease",
      }}
    >
      {/* Header Pill & WAR Score */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
        <span
          className="pill"
          style={{
            borderColor: color,
            color: color,
            fontWeight: 700,
            background: `${color}15`,
          }}
        >
          <Zap size={13} fill={color} />
          {label[item.kind].toUpperCase()}
        </span>
        <div style={{ textAlign: "right" }}>
          <div className="score" style={{ color: item.score >= 85 ? "var(--good)" : "var(--warn)" }}>
            {item.score}
          </div>
          <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>WAR SCORE</div>
        </div>
      </div>

      {/* Title & Reasons */}
      <div>
        <h3 style={{ margin: "0 0 8px", fontSize: 22, letterSpacing: "-.025em", lineHeight: 1.25, fontWeight: 750 }}>
          {item.headline}
        </h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {item.reasonCodes.map((code) => (
            <span
              key={code}
              style={{
                fontSize: 11,
                fontWeight: 650,
                padding: "3px 9px",
                borderRadius: 999,
                background: "var(--surface)",
                border: "1px solid var(--line)",
                color: "var(--muted)",
              }}
            >
              {code.replaceAll("_", " ")}
            </span>
          ))}
        </div>
      </div>

      {/* Confidence & Evidence Footer */}
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ShieldCheck size={14} style={{ color: "var(--good)" }} />
            <strong>{item.confidence}%</strong> confidence
          </span>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            style={{
              background: "none",
              border: 0,
              color: "var(--muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <span>{item.evidenceIds.length} evidence items</span>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        {/* Expanded Rationale & Evidence Details */}
        {expanded && (
          <div
            style={{
              padding: 12,
              borderRadius: 14,
              background: "var(--surface)",
              border: "1px solid var(--line)",
              fontSize: 12,
              display: "grid",
              gap: 8,
              marginTop: 4,
            }}
          >
            <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
              <Info size={13} /> Evidence Trail (Engine v0.1)
            </div>
            {itemEvidences.length > 0 ? (
              itemEvidences.map((ev) => (
                <div key={ev.id} style={{ borderLeft: "2px solid var(--good)", paddingLeft: 8 }}>
                  <div style={{ fontWeight: 650 }}>{ev.source.replaceAll("_", " ").toUpperCase()}</div>
                  <div className="muted">{ev.summary}</div>
                </div>
              ))
            ) : (
              <div className="muted">Grounding: nflverse telemetry & Sleeper depth chart updates</div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
