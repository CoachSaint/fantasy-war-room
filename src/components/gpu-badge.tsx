"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Activity, X, Zap } from "lucide-react";
import type { GpuStats } from "@/lib/gpu-monitor";

export function GpuBadge() {
  const [stats, setStats] = useState<GpuStats | null>(null);
  const [openDrawer, setOpenDrawer] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/gpu-monitor");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (e) {
      console.warn("GPU monitor fetch error:", e);
    }
  };

  useEffect(() => {
    const initialFetch = window.setTimeout(fetchStats, 0);
    const interval = setInterval(fetchStats, 30_000);
    return () => {
      window.clearTimeout(initialFetch);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!openDrawer) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenDrawer(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openDrawer]);

  const utilization = stats?.utilization;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpenDrawer(true)}
        title="View telemetry status"
        aria-label="View telemetry status"
        className="glass"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 14px",
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 650,
          cursor: "pointer",
          border: "1px solid var(--line)",
          background: "var(--surface)",
          color: "var(--text)",
          transition: "all 0.2s ease",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: stats ? "var(--good)" : "var(--muted)",
            boxShadow: stats ? "0 0 8px var(--good)" : "none",
            animation: "pulse 2s infinite",
          }}
        />
        <Zap size={14} style={{ color: "#ffd700" }} />
        <span>Coach telemetry</span>
        <span
          style={{
            opacity: 0.6,
            fontSize: 11,
            borderLeft: "1px solid var(--line)",
            paddingLeft: 6,
          }}
        >
          OpenRouter
        </span>
      </button>

      {/* LLM & System Telemetry Modal Drawer */}
      {openDrawer && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setOpenDrawer(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="telemetry-dialog-title"
            className="card"
            style={{
              width: "min(520px, 100%)",
              background: "var(--surface-strong)",
              borderRadius: 24,
              border: "1px solid var(--line)",
              padding: 24,
              boxShadow: "0 24px 80px rgba(0,0,0,0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Activity size={20} style={{ color: "var(--good)" }} />
                <h3 id="telemetry-dialog-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>LLM Engine & System Telemetry</h3>
              </div>
              <button
                type="button"
                ref={closeButtonRef}
                aria-label="Close telemetry"
                onClick={() => setOpenDrawer(false)}
                style={{ background: "none", border: 0, color: "var(--muted)", cursor: "pointer" }}
              >
                <X size={20} />
              </button>
            </div>

            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              Provider and hardware telemetry are shown only when the connected service reports them.
            </p>

            <div style={{ display: "grid", gap: 14, marginTop: 20 }}>
              {/* Active Model Status */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: 12,
                  borderRadius: 14,
                  background: "rgba(22,133,75,0.1)",
                  border: "1px solid rgba(22,133,75,0.3)",
                }}
              >
                <ShieldCheck size={20} style={{ color: "var(--good)", flexShrink: 0 }} />
                <div style={{ fontSize: 13 }}>
                  <strong>{stats ? "Telemetry service connected" : "Telemetry unavailable"}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {stats ? "Live system readings are available for this session." : "No live system reading is available right now."}
                  </div>
                </div>
              </div>

              {/* System Details */}
              <div style={{ background: "var(--surface)", borderRadius: 14, padding: 14, fontSize: 13, display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Router Provider:</span>
                  <span style={{ fontWeight: 600 }}>{stats ? "Local system monitor" : "Unavailable"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Active Model ID:</span>
                  <span style={{ fontWeight: 600, fontFamily: "monospace" }}>{stats?.activeModel ?? "Unavailable"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Local Hardware Load:</span>
                  <span style={{ fontWeight: 600, color: utilization == null ? "var(--muted)" : "var(--good)" }}>{utilization == null ? "Unavailable" : `${utilization}% GPU`}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Context Window:</span>
                  <span style={{ fontWeight: 600 }}>Not reported</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setOpenDrawer(false)}
              style={{
                marginTop: 20,
                width: "100%",
                minHeight: 44,
                borderRadius: 999,
                background: "var(--text)",
                color: "var(--bg)",
                fontWeight: 700,
                border: 0,
                cursor: "pointer",
              }}
            >
              Close Telemetry
            </button>
          </div>
        </div>
      )}
    </>
  );
}
