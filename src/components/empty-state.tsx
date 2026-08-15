"use client";

import { SearchX, RefreshCw } from "lucide-react";

interface EmptyStateProps {
  title?: string;
  description?: string;
  onReset?: () => void;
  actionLabel?: string;
}

export function EmptyState({
  title = "No matching items found",
  description = "Try adjusting your search terms or filter criteria.",
  onReset,
  actionLabel = "Reset Filters",
}: EmptyStateProps) {
  return (
    <div
      className="card"
      style={{
        padding: "48px 24px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        margin: "24px 0",
        border: "1px dashed var(--line)",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
        }}
      >
        <SearchX size={26} />
      </div>
      <div style={{ maxWidth: 420 }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 750 }}>{title}</h3>
        <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
          {description}
        </p>
      </div>
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          style={{
            marginTop: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 20px",
            borderRadius: 999,
            background: "var(--text)",
            color: "var(--bg)",
            fontWeight: 700,
            fontSize: 13,
            border: 0,
            cursor: "pointer",
          }}
        >
          <RefreshCw size={14} />
          <span>{actionLabel}</span>
        </button>
      )}
    </div>
  );
}
