"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { LeagueGate } from "@/components/league-gate";
import { useConnectedLeague } from "@/lib/use-connected-league";

type Decision = {
  id: string;
  confidence: number;
  recommended_at: string;
  response: "accepted" | "ignored" | "overridden" | null;
  user_note: string | null;
  responded_at: string | null;
  recommendation_snapshot: { kind?: string; headline?: string; engineVersion?: string;
    projectedPoints?: { recommended?: number; current?: number }; confidenceMeaning?: string };
};

export default function HistoryPage() {
  const league = useConnectedLeague();
  if (league.status !== "connected") return <LeagueGate state={league} />;
  return <ConnectedHistory leagueId={league.context.league.id} />;
}

function ConnectedHistory({ leagueId }: { leagueId: string }) {
  const [state, setState] = useState<{ status: "loading" | "error" | "ready"; data: Decision[] }>({ status: "loading", data: [] });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/history?leagueId=${encodeURIComponent(leagueId)}`, {
          credentials: "same-origin", signal: controller.signal,
        });
        if (!response.ok) return setState({ status: "error", data: [] });
        const body = await response.json() as { data?: Decision[] };
        setState(Array.isArray(body.data) ? { status: "ready", data: body.data } : { status: "error", data: [] });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", data: [] });
      }
    })();
    return () => controller.abort();
  }, [leagueId]);
  return <>
    <PageHeader eyebrow="Decision history" title="What War Room recommended" description="Saved recommendations for your connected league, newest first. A recommendation does not mean you made the move." />
    {state.status === "loading" && <p role="status">Loading decision history…</p>}
    {state.status === "error" && <p role="alert">Decision history could not be loaded.</p>}
    {state.status === "ready" && state.data.length === 0 && <section className="card"><h2>No decisions yet</h2><p className="muted">Recommendations will appear after a connected roster, current projections, and a decision refresh are available.</p></section>}
    {state.status === "ready" && state.data.length > 0 && <section style={{ display: "grid", gap: 14 }}>
      {state.data.map((decision) => <article className="card" key={decision.id}>
        <div className="eyebrow">{decision.recommendation_snapshot.kind || "Decision"} · {new Date(decision.recommended_at).toLocaleString()}</div>
        <h2 style={{ margin: "10px 0" }}>{decision.recommendation_snapshot.headline || "Recommendation saved"}</h2>
        {decision.recommendation_snapshot.projectedPoints && <p className="muted" style={{ margin: "0 0 8px" }}>
          Forecast: {decision.recommendation_snapshot.projectedPoints.recommended} vs {decision.recommendation_snapshot.projectedPoints.current} points
        </p>}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {decision.confidence}% source coverage confidence · {decision.response ? `Marked ${decision.response}` : "No response recorded"}
        </p>
        <DecisionResponseForm decision={decision} leagueId={leagueId} onSaved={(saved) =>
          setState((previous) => ({ ...previous, data: previous.data.map((item) =>
            item.id === saved.id ? { ...item, ...saved } : item) }))} />
      </article>)}
    </section>}
  </>;
}

function DecisionResponseForm({ decision, leagueId, onSaved }: {
  decision: Decision;
  leagueId: string;
  onSaved: (saved: Pick<Decision, "id" | "response" | "user_note" | "responded_at">) => void;
}) {
  const [response, setResponse] = useState<Decision["response"]>(decision.response);
  const [note, setNote] = useState(decision.user_note || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    setSaveError(false);
    try {
      const result = await fetch("/api/history", { method: "PATCH", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leagueId, decisionId: decision.id, response,
          note: response ? note.trim() || null : null }) });
      const body = await result.json() as { data?: Pick<Decision, "id" | "response" | "user_note" | "responded_at"> };
      if (!result.ok || body.data?.id !== decision.id) throw new Error("save_failed");
      onSaved(body.data);
      if (!response) setNote("");
      setMessage(response ? "Your response was saved." : "Your response was cleared.");
    } catch {
      setSaveError(true);
      setMessage("Your response could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={save} style={{ display: "grid", gap: 9, marginTop: 16 }}>
    <label htmlFor={`decision-response-${decision.id}`} className="muted" style={{ fontSize: 13 }}>What did you decide?</label>
    <select id={`decision-response-${decision.id}`} value={response || ""}
      onChange={(event) => setResponse(event.target.value as Decision["response"] || null)}
      style={{ minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: "0 10px" }}>
      <option value="">No response recorded</option>
      <option value="accepted">I followed this advice</option>
      <option value="ignored">I did not follow this advice</option>
      <option value="overridden">I chose a different move</option>
    </select>
    <label htmlFor={`decision-note-${decision.id}`} className="muted" style={{ fontSize: 13 }}>Optional note</label>
    <textarea id={`decision-note-${decision.id}`} value={response ? note : ""}
      onChange={(event) => setNote(event.target.value)} disabled={!response} maxLength={500} rows={2}
      style={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: 10 }} />
    <button type="submit" disabled={busy} style={{ justifySelf: "start", minHeight: 40, borderRadius: 999, border: 0,
      background: "var(--text)", color: "var(--bg)", fontWeight: 700, padding: "0 16px" }}>
      {busy ? "Saving…" : "Save response"}
    </button>
    {message && <p role={saveError ? "alert" : "status"} style={{ margin: 0, fontSize: 12 }}>{message}</p>}
  </form>;
}
