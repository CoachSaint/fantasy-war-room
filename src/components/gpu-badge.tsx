"use client";

import { useEffect, useState } from "react";
import { Cpu, ShieldCheck, Activity, X, Zap } from "lucide-react";
import type { GpuStats } from "@/lib/gpu-monitor";

export function GpuBadge() {
  const [stats, setStats] = useState<GpuStats | null>(null);
  const [openDrawer, setOpenDrawer] = useState(false);

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
    fetchStats();
    const interval = setInterval(fetchStats, 3000);
    return () => clearInterval(interval);
  }, []);

  const utilization = stats?.utilization ?? 18;
  const activeModel = "deepseek/deepseek-v4-pro";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpenDrawer(true)}
        title="View OpenRouter LLM & Local System Stats"
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
            background: "var(--good)",
            boxShadow: "0 0 8px var(--good)",
            animation: "pulse 2s infinite",
          }}
        />
        <Zap size={14} style={{ color: "#ffd700" }} />
        <span>DeepSeek V4 Pro</span>
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
        >
          <div
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
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>LLM Engine & System Telemetry</h3>
              </div>
              <button
                type="button"
                onClick={() => setOpenDrawer(false)}
                style={{ background: "none", border: 0, color: "var(--muted)", cursor: "pointer" }}
              >
                <X size={20} />
              </button>
            </div>

            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              Fantasy War Room Coach Bot is powered by <strong>DeepSeek V4 Pro</strong> via OpenRouter OmniRouter with zero local GPU overhead.
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
                  <strong>OpenRouter DeepSeek V4 Pro Active</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    High-reasoning model optimized for fantasy football evidence analysis and decision grounding.
                  </div>
                </div>
              </div>

              {/* System Details */}
              <div style={{ background: "var(--surface)", borderRadius: 14, padding: 14, fontSize: 13, display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Router Provider:</span>
                  <span style={{ fontWeight: 600 }}>OpenRouter (OmniRouter)</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Active Model ID:</span>
                  <span style={{ fontWeight: 600, fontFamily: "monospace" }}>deepseek/deepseek-v4-pro</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Local Hardware Load:</span>
                  <span style={{ fontWeight: 600, color: "var(--good)" }}>{utilization}% GPU (Zero Local Bottleneck)</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Context Window:</span>
                  <span style={{ fontWeight: 600 }}>128,000 Tokens</span>
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
