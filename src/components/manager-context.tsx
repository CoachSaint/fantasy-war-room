"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { selectPrimaryMembership } from "@/lib/select-primary-membership";

type ContextState =
  | { status: "loading" }
  | { status: "setup_required"; message?: string }
  | { status: "auth_required"; message?: string }
  | { status: "unavailable"; message?: string }
  | { status: "ready"; context: Record<string, unknown> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function ManagerContext() {
  const [state, setState] = useState<ContextState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/context", { signal: controller.signal, credentials: "same-origin" });
        const body: unknown = await response.json().catch(() => null);
        const payload = isRecord(body) ? body : {};
        const code = text(payload.error) ?? text(payload.code);
        if (response.status === 401 || code === "authentication_required") {
          setState({ status: "auth_required", message: "Sign in is required before league context can be loaded." });
        } else if (response.status === 404 || payload.setupRequired === true || payload.status === "setup_required" || code === "setup_required" || code === "league_context_required") {
          setState({ status: "setup_required", message: "Connect a league to load manager and roster context." });
        } else if (!response.ok || payload.ok === false) {
          setState({ status: "unavailable", message: code ?? "The context service did not return a usable response." });
        } else {
          const data = isRecord(payload.data) ? payload.data : null;
          const memberships = data && Array.isArray(data.memberships) ? data.memberships : [];
          const primary = selectPrimaryMembership(memberships);
          const context = isRecord(primary) ? primary : isRecord(payload.context) ? payload.context : null;
          if (!context) {
            setState({ status: "setup_required", message: "No league membership is available for this account." });
          } else {
            setState({ status: "ready", context });
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "unavailable", message: "The context service is unreachable. No manager data was inferred." });
      }
    }, 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  if (state.status === "loading") {
    return <div className="context-strip muted" role="status">Checking league context…</div>;
  }

  if (state.status !== "ready") {
    const auth = state.status === "auth_required";
    return (
      <aside className="context-strip" aria-label="Manager context status" style={{ borderColor: auth ? "var(--line)" : "rgba(179,106,0,0.3)" }}>
        <div>
          <strong>{auth ? "Sign in required" : state.status === "setup_required" ? "League setup required" : "League context unavailable"}</strong>
          <div className="muted" style={{ fontSize: 12 }}>{state.message}</div>
        </div>
        <Link href={auth ? "/auth" : "/league/setup"} style={{ color: "var(--good)", fontWeight: 700, whiteSpace: "nowrap" }}>{auth ? "Sign in" : "Open setup"}</Link>
      </aside>
    );
  }

  const league = isRecord(state.context.league) ? state.context.league : state.context;
  const roster = isRecord(state.context.roster) ? state.context.roster : {};
  const leagueName = text(league.name) ?? text(league.leagueName);
  const rosterName = text(roster.name);
  return (
    <aside className="context-strip" aria-label="Active manager context">
      <div><strong>{leagueName ?? "Connected league"}</strong><span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{rosterName ? "Your roster: " + rosterName : "Roster name unavailable"}</span></div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Link href="/history" style={{ color: "var(--good)", fontWeight: 700 }}>History</Link>
        <Link href="/accuracy" style={{ color: "var(--good)", fontWeight: 700 }}>Accuracy</Link>
        <Link href="/league/settings" style={{ color: "var(--good)", fontWeight: 700 }}>Settings</Link>
      </div>
    </aside>
  );
}
