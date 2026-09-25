"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ShieldCheck, Zap, Info } from "lucide-react";
import type { Evidence, Recommendation } from "@/lib/types";
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

export function DecisionCard({ item, evidence = [], demo = false }: { item: Recommendation; evidence?: Evidence[]; demo?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const color = kindColor[item.kind] || "var(--good)";

  const itemEvidences = (demo ? demoEvidence : evidence).filter((e) => item.evidenceIds.includes(e.id));

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
          <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
            {item.confidenceMeaning ? "HEURISTIC PRIORITY" : "WAR SCORE"}
          </div>
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

      {item.kind === "add" && item.faabRange && (
        <div style={{ padding: 12, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)", fontSize: 12.5 }}>
          <strong>Estimated FAAB: {item.faabRange.minimumPercent.toFixed(1)}–{item.faabRange.maximumPercent.toFixed(1)}% of remaining balance</strong>
          <div className="muted">Center estimate {item.faabRange.recommendedPercent.toFixed(1)}%; balance {item.faabRange.remainingBalance} last synced {new Date(item.faabRange.observedAt).toLocaleString()}.</div>
          <div className="muted">Heuristic based on this add/drop edge and available alternatives. League bid history is unavailable.</div>
        </div>
      )}

      {/* Confidence & Evidence Footer */}
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ShieldCheck size={14} style={{ color: "var(--good)" }} />
            {item.confidenceMeaning ? (
              <span><strong>{item.confidence}/100</strong> evidence coverage estimate</span>
            ) : (
              <span><strong>{item.confidence}%</strong> confidence</span>
            )}
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
            {item.confidenceMeaning && (
              <div className="muted">This coverage estimate is a heuristic, not a measured chance of success.</div>
            )}
            {item.projectedPoints && (
              <div className="muted">Week forecast under imported league scoring: {item.projectedPoints.recommended.toFixed(1)} vs {item.projectedPoints.current.toFixed(1)} points.</div>
            )}
            {item.availability && (
              <div className="muted">
                {`Yahoo league availability checked ${new Date(item.availability.observedAt).toLocaleString()}.`}
                {item.availability.truncated ? " Candidate scan was limited to the first 200 players." : ""}
              </div>
            )}
            {item.forecastOutlook && (
              <div style={{ display: "grid", gap: 8 }}>
                <strong>Up to three weeks of source forecasts</strong>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
                  {item.forecastOutlook.requestedWeeks.map((week) => {
                    const forecast = item.forecastOutlook?.weeks.find((row) => row.week === week);
                    return <div key={week} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 8 }}>
                      <strong>Week {week}</strong>
                      {forecast ? (
                        <>
                          <div>{forecast.addPoints.toFixed(1)} vs {forecast.dropPoints.toFixed(1)} pts</div>
                          <div className="muted">{forecast.edge >= 0 ? "+" : ""}{forecast.edge.toFixed(1)} point edge</div>
                          {forecast.assumedZeroYahooStatIds.length > 0 && (
                            <div className="muted">{forecast.assumedZeroYahooStatIds.length} missing stat projections treated as zero</div>
                          )}
                          <div className="muted">Checked {new Date(forecast.observedAt).toLocaleDateString()}</div>
                          <a href={forecast.sourceUrl} target="_blank" rel="noopener noreferrer">Sleeper source</a>
                        </>
                      ) : <div className="muted">Forecast unavailable</div>}
                    </div>;
                  })}
                </div>
                <div className="muted">Forecast comparison only; it does not include opponent adjustments or a rest-of-season value claim.</div>
              </div>
            )}
            {itemEvidences.length > 0 ? (
              itemEvidences.map((ev) => (
                <div key={ev.id} style={{ borderLeft: "2px solid var(--good)", paddingLeft: 8 }}>
                  <div style={{ fontWeight: 650 }}>{ev.source.replaceAll("_", " ").toUpperCase()}</div>
                  <div className="muted">{ev.summary}</div>
                </div>
              ))
            ) : (
              <div className="muted">Evidence details are unavailable for this recommendation. Check its source before acting.</div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
