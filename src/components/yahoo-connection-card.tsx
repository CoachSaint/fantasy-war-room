"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, Link2, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";

type ConnectionState = {
  loading: boolean;
  configured: boolean;
  connected: boolean;
  status: string;
  lastSyncedAt?: string | null;
  leagueCount: number;
  message?: string;
};

const initialState: ConnectionState = {
  loading: true,
  configured: false,
  connected: false,
  status: "loading",
  leagueCount: 0,
};

const callbackMessages: Record<string, string> = {
  connected: "Yahoo account connected. Import your leagues and rosters below.",
  access_denied: "Yahoo access was declined. You can try connecting again.",
  credentials_pending: "Yahoo app credentials are not configured on this deployment.",
  database_unavailable: "The app database is not configured on this deployment.",
  migration_required: "The Yahoo database migration has not been applied.",
  authentication_required: "Sign in to Fantasy War Room before connecting Yahoo.",
  authentication_unavailable: "Fantasy War Room sign-in is temporarily unavailable.",
  invalid_callback: "Yahoo returned an invalid authorization response. Try connecting again.",
  authorization_failed: "Yahoo authorization did not complete. Try connecting again.",
  state_mismatch: "The Yahoo connection expired or did not match this session. Try connecting again.",
  refresh_token_missing: "Yahoo did not provide a refresh token. Try reconnecting the new app.",
  persistence_failed: "The Yahoo connection could not be saved. Try again later.",
  sync_in_progress: "A Yahoo import is running. Try connecting again after it finishes.",
  token_exchange_failed: "Yahoo could not exchange the authorization code. Check the new app credentials and exact callback URL.",
};

export function YahooConnectionCard() {
  const [state, setState] = useState<ConnectionState>(initialState);
  const [syncing, setSyncing] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/integrations/yahoo/status", { credentials: "same-origin", cache: "no-store" });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        const code = typeof body.error === "string" ? body.error : "yahoo_status_unavailable";
        setState({ loading: false, configured: body.configured === true, connected: false, status: code, leagueCount: 0, message: code === "authentication_required" ? "Sign in before connecting a Yahoo team." : "Yahoo integration setup is waiting on its database or credentials." });
        return;
      }
      const leagues = Array.isArray(body.leagues) ? body.leagues : [];
      setState({
        loading: false,
        configured: body.configured === true,
        connected: body.connected === true,
        status: typeof body.status === "string" ? body.status : "unknown",
        lastSyncedAt: typeof body.lastSyncedAt === "string" ? body.lastSyncedAt : null,
        leagueCount: leagues.length,
      });
    } catch {
      setState({ loading: false, configured: false, connected: false, status: "unavailable", leagueCount: 0, message: "Yahoo connection status is unavailable." });
    }
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const callbackStatus = url.searchParams.get("yahoo");
    if (callbackStatus) {
      url.searchParams.delete("yahoo");
      window.history.replaceState(window.history.state, "", url);
    }
    void loadStatus().then(() => {
      if (callbackStatus && Object.hasOwn(callbackMessages, callbackStatus)) {
        setState((previous) => callbackStatus === "connected" && !previous.connected
          ? previous
          : { ...previous, message: callbackMessages[callbackStatus] });
      }
    });
  }, [loadStatus]);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    setState((previous) => ({ ...previous, message: "Importing Yahoo leagues, settings, teams, and rosters…" }));
    try {
      const response = await fetch("/api/integrations/yahoo/sync", { method: "POST", credentials: "same-origin" });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        const code = typeof body.error === "string" ? body.error : "yahoo_sync_failed";
        throw new Error(code === "yahoo_access_denied" ? "Yahoo access expired or was revoked. Reconnect the account." : `Yahoo import did not complete (${code}).`);
      }
      const data = body.data && typeof body.data === "object" ? body.data as Record<string, unknown> : {};
      const leagues = typeof data.leaguesProcessed === "number" ? data.leaguesProcessed : 0;
      const rosters = typeof data.rostersProcessed === "number" ? data.rostersProcessed : 0;
      setState((previous) => ({ ...previous, connected: true, message: `Yahoo import completed: ${leagues} league${leagues === 1 ? "" : "s"} and ${rosters} roster${rosters === 1 ? "" : "s"}.` }));
      await loadStatus();
    } catch (error) {
      setState((previous) => ({ ...previous, message: error instanceof Error ? error.message : "Yahoo import failed safely." }));
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Yahoo? Imported snapshots remain, but no future roster refresh can run until you reconnect.")) return;
    try {
      const response = await fetch("/api/integrations/yahoo/status", { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error("Yahoo could not be disconnected safely.");
      setState((previous) => ({ ...previous, connected: false, leagueCount: 0, lastSyncedAt: null, status: "disconnected", message: "Yahoo credentials were removed from Fantasy War Room. You can also revoke the application in Yahoo account settings." }));
    } catch (error) {
      setState((previous) => ({ ...previous, message: error instanceof Error ? error.message : "Yahoo disconnect failed." }));
    }
  };

  const waiting = !state.loading && !state.configured;
  return (
    <section className="card" aria-labelledby="yahoo-connect-title" style={{ display: "grid", gap: 14, borderColor: state.connected ? "rgba(22,133,75,0.35)" : "var(--line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div aria-hidden="true" style={{ width: 42, height: 42, borderRadius: 13, display: "grid", placeItems: "center", background: "rgba(86, 1, 192, 0.12)", color: "#6f2dbd" }}><Cloud size={20} /></div>
          <div>
            <span className="eyebrow">Direct provider import</span>
            <h2 id="yahoo-connect-title" style={{ margin: "3px 0 4px", fontSize: 20 }}>Yahoo Fantasy Football</h2>
            <p className="muted" style={{ margin: 0, maxWidth: 720, fontSize: 13 }}>
              Read-only OAuth imports league settings, every team roster, starters, bench/IR, FAAB, waiver priority, and your manager-to-team mapping. Yahoo credentials never reach the browser.
            </p>
          </div>
        </div>
        <span style={{ borderRadius: 999, padding: "5px 10px", fontSize: 11, fontWeight: 800, background: state.connected ? "rgba(22,133,75,0.12)" : "var(--surface)", color: state.connected ? "var(--good)" : "var(--muted)", border: "1px solid var(--line)" }}>
          {state.loading ? "CHECKING" : state.connected ? "CONNECTED" : waiting ? "SETUP REQUIRED" : "READY TO CONNECT"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><ShieldCheck size={14} style={{ color: "var(--good)" }} /> Read-only access</span>
        <span className="muted">{state.leagueCount} imported league{state.leagueCount === 1 ? "" : "s"}</span>
        {state.lastSyncedAt && <span className="muted">Last sync {new Date(state.lastSyncedAt).toLocaleString()}</span>}
      </div>

      {waiting && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Create a new Yahoo developer app with Fantasy Sports: Read, submit its Client ID to Yahoo for confirmation, then configure the four server-only environment values and the Yahoo database migration. An existing Yahoo app will not pick up the permission.</p>}
      {state.message && <div role="status" style={{ padding: 10, borderRadius: 10, background: "var(--surface)", fontSize: 12 }}>{state.message}</div>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {!state.connected && (
          <a aria-disabled={!state.configured || state.loading} href={state.configured && !state.loading ? "/api/integrations/yahoo/start" : undefined} style={{ pointerEvents: state.configured && !state.loading ? "auto" : "none", opacity: state.configured && !state.loading ? 1 : 0.55, minHeight: 40, borderRadius: 999, padding: "0 15px", display: "inline-flex", alignItems: "center", gap: 7, background: "#6f2dbd", color: "white", fontWeight: 800 }}><Link2 size={15} /> Connect Yahoo</a>
        )}
        {state.connected && <button type="button" disabled={syncing} onClick={sync} style={{ minHeight: 40, borderRadius: 999, padding: "0 15px", display: "inline-flex", alignItems: "center", gap: 7, border: 0, background: "var(--text)", color: "var(--bg)", fontWeight: 800, cursor: syncing ? "wait" : "pointer" }}>{syncing ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} {syncing ? "Importing…" : "Import Yahoo roster"}</button>}
        {state.connected && <button type="button" disabled={syncing} onClick={disconnect} style={{ minHeight: 40, borderRadius: 999, padding: "0 15px", border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", fontWeight: 700, cursor: "pointer" }}>Disconnect</button>}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 11 }}>Powered by JTF Software Solutions</p>
    </section>
  );
}
