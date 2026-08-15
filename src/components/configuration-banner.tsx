import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";

interface ConfigurationBannerProps {
  message?: string;
  linkLabel?: string;
  href?: string;
}

/** A deliberately prominent boundary between demo fixtures and connected league data. */
export function ConfigurationBanner({
  message = "This surface is showing demo data. Connect a league before relying on recommendations or freshness claims.",
  linkLabel = "Configure league",
  href = "/league/setup",
}: ConfigurationBannerProps) {
  return (
    <aside
      aria-label="Configuration required"
      className="configuration-banner"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        flexWrap: "wrap",
        padding: "12px 16px",
        marginBottom: 24,
        borderRadius: 16,
        background: "rgba(179,106,0,0.12)",
        border: "1px solid rgba(179,106,0,0.3)",
        color: "var(--text)",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <AlertTriangle size={17} aria-hidden="true" style={{ color: "var(--warn)", flexShrink: 0 }} />
        <div>
          <strong style={{ display: "block" }}>Demo mode · configuration required</strong>
          <span className="muted">{message}</span>
        </div>
      </div>
      <Link
        href={href}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          minHeight: 36,
          padding: "0 13px",
          borderRadius: 999,
          background: "var(--text)",
          color: "var(--bg)",
          fontWeight: 700,
          whiteSpace: "nowrap",
        }}
      >
        {linkLabel} <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </aside>
  );
}
