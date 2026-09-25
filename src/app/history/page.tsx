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
      </article>)}
    </section>}
  </>;
}
