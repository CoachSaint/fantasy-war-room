"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorStateProps {
  error?: Error & { digest?: string };
  reset?: () => void;
  title?: string;
  description?: string;
}

export function ErrorState({
  error,
  reset,
  title = "Intelligence Stream Interrupted",
  description = "An unexpected error occurred while loading this view.",
}: ErrorStateProps) {
  return (
    <div
      className="card"
      style={{
        padding: "40px 24px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        margin: "32px 0",
        borderColor: "rgba(180,35,24,0.3)",
        background: "rgba(180,35,24,0.04)",
      }}
    >
      <div
        style={{
          width: 54,
          height: 54,
          borderRadius: "50%",
          background: "rgba(180,35,24,0.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--bad)",
        }}
      >
        <AlertTriangle size={26} />
      </div>
      <div style={{ maxWidth: 460 }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 750, color: "var(--bad)" }}>
          {title}
        </h3>
        <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
          {error?.message || description}
        </p>
      </div>
      {reset && (
        <button
          type="button"
          onClick={() => reset()}
          style={{
            marginTop: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 22px",
            borderRadius: 999,
            background: "var(--bad)",
            color: "#ffffff",
            fontWeight: 700,
            fontSize: 13,
            border: 0,
            cursor: "pointer",
          }}
        >
          <RefreshCw size={14} />
          <span>Retry Loading Route</span>
        </button>
      )}
    </div>
  );
}
