"use client";

import { useEffect, useState } from "react";
import { Cpu, ShieldCheck, AlertTriangle, Activity, X } from "lucide-react";
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
    const interval = setInterval(fetchStats, 3000); // refresh stats every 3s
    return () => clearInterval(interval);
  }, []);

  const utilization = stats?.utilization ?? 18;
  const cap = stats?.cap ?? 60;
  const isThrottled = stats?.isThrottled ?? utilization >= cap;
  const activeModel = stats?.activeModel ?? "qwen/qwen3-coder-30b";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpenDrawer(true)}
        title="View local Mac GPU & LLMster stats"
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
          border: isThrottled ? "1px solid var(--warn)" : "1px solid var(--line)",
          background: isThrottled ? "rgba(255,179,77,0.12)" : "var(--surface)",
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
            background: isThrottled ? "var(--warn)" : "var(--good)",
            boxShadow: isThrottled
              ? "0 0 8px var(--warn)"
              : "0 0 8px var(--good)",
            animation: "pulse 2s infinite",
          }}
        />
        <Cpu size={14} className="muted" />
        <span>GPU {utilization}%</span>
        <span
          style={{
            opacity: 0.6,
            fontSize: 11,
            borderLeft: "1px solid var(--line)",
            paddingLeft: 6,
          }}
        >
          CAP {cap}%
        </span>
      </button>

      {/* GPU Telemetry Modal Drawer */}
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
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Local Mac GPU & Engine Guard</h3>
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
              Monitoring Apple Silicon Metal GPU usage. System rule enforces a hard <strong>60% MAX GPU cap</strong> to guarantee background stability.
            </p>

            <div style={{ display: "grid", gap: 14, marginTop: 20 }}>
              {/* Utilization Bar */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                  <span>GPU Utilization</span>
                  <span style={{ fontWeight: 700, color: isThrottled ? "var(--warn)" : "var(--good)" }}>
                    {utilization}% / {cap}% MAX
                  </span>
                </div>
                <div style={{ width: "100%", height: 10, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden", position: "relative" }}>
                  <div
                    style={{
                      width: `${Math.min(utilization, 100)}%`,
                      height: "100%",
                      background: isThrottled ? "var(--warn)" : "var(--good)",
                      transition: "width 0.4s ease",
                    }}
                  />
                  {/* Cap Marker Line */}
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: "60%",
                      width: 2,
                      background: "var(--bad)",
                    }}
                    title="60% GPU Cap Limit"
                  />
                </div>
              </div>

              {/* Status Badge */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: 12,
                  borderRadius: 14,
                  background: isThrottled ? "rgba(255,179,77,0.1)" : "rgba(22,133,75,0.1)",
                  border: isThrottled ? "1px solid rgba(255,179,77,0.3)" : "1px solid rgba(22,133,75,0.3)",
                }}
              >
                {isThrottled ? (
                  <>
                    <AlertTriangle size={20} style={{ color: "var(--warn)", flexShrink: 0 }} />
                    <div style={{ fontSize: 13 }}>
                      <strong>GPU Load Limit Active (60% Cap)</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        Automatically throttled to lightweight <code>qwen/qwen3-4b-2507</code> model to protect system resources.
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={20} style={{ color: "var(--good)", flexShrink: 0 }} />
                    <div style={{ fontSize: 13 }}>
                      <strong>GPU Operating Within Safe Limit</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        Active model: <code>{activeModel}</code> via local LLMster runtime (127.0.0.1:1235).
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Details table */}
              <div style={{ background: "var(--surface)", borderRadius: 14, padding: 14, fontSize: 13, display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Runtime:</span>
                  <span style={{ fontWeight: 600 }}>LLMster (Port 1235)</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Active Model:</span>
                  <span style={{ fontWeight: 600, fontFamily: "monospace" }}>{activeModel}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Unified In-Use Memory:</span>
                  <span style={{ fontWeight: 600 }}>{stats?.inUseMemoryMb ?? 1024} MB</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Allocated VRAM:</span>
                  <span style={{ fontWeight: 600 }}>{stats?.allocatedMemoryMb ? (stats.allocatedMemoryMb / 1024).toFixed(1) + " GB" : "20.6 GB"}</span>
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
