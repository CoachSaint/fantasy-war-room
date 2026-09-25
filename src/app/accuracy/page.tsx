"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { LeagueGate } from "@/components/league-gate";
import { useConnectedLeague } from "@/lib/use-connected-league";

export default function AccuracyPage() {
  const league = useConnectedLeague();
  if (league.status !== "connected") return <LeagueGate state={league} />;
  return <ConnectedAccuracy leagueId={league.context.league.id} />;
}

function ConnectedAccuracy({ leagueId }: { leagueId: string }) {
  const [state, setState] = useState<{ status: "loading" | "error" | "ready";
    decisionsRecorded: number; predictionsRecorded: number; outcomesEvaluated: number;
    mae: number | null; rmse: number | null }>({ status: "loading", decisionsRecorded: 0,
      predictionsRecorded: 0, outcomesEvaluated: 0, mae: null, rmse: null });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/accuracy?leagueId=${encodeURIComponent(leagueId)}`, {
          credentials: "same-origin", signal: controller.signal,
        });
        if (!response.ok) return setState({ status: "error", decisionsRecorded: 0, predictionsRecorded: 0,
          outcomesEvaluated: 0, mae: null, rmse: null });
        const body = await response.json() as { decisionsRecorded?: number; predictionsRecorded?: number;
          outcomesEvaluated?: number; mae?: number | null; rmse?: number | null };
        if (!Number.isInteger(body.decisionsRecorded) || !Number.isInteger(body.predictionsRecorded)
          || !Number.isInteger(body.outcomesEvaluated)
          || (body.outcomesEvaluated! > 0 && (!Number.isFinite(body.mae) || !Number.isFinite(body.rmse)))) {
          return setState({ status: "error", decisionsRecorded: 0, predictionsRecorded: 0,
            outcomesEvaluated: 0, mae: null, rmse: null });
        }
        setState({ status: "ready", decisionsRecorded: body.decisionsRecorded!, predictionsRecorded: body.predictionsRecorded!,
          outcomesEvaluated: body.outcomesEvaluated!, mae: body.mae ?? null, rmse: body.rmse ?? null });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", decisionsRecorded: 0, predictionsRecorded: 0,
          outcomesEvaluated: 0, mae: null, rmse: null });
      }
    })();
    return () => controller.abort();
  }, [leagueId]);
  return (
    <>
      <PageHeader eyebrow="Accuracy lab" title="Measure decisions against outcomes." description="Only pregame, source-linked weekly point forecasts with later observed game stats enter these error metrics. Lower error is better; this is not a win-rate claim." />
      {state.status === "loading" && <p role="status">Loading ledger counts…</p>}
      {state.status === "error" && <p role="alert">Ledger counts could not be verified.</p>}
      {state.status === "ready" &&
      <section className="grid grid-2">
        {[
          ["Mean absolute error", state.outcomesEvaluated ? `${state.mae?.toFixed(2)} points` : "Awaiting verified outcomes"],
          ["Root mean square error", state.outcomesEvaluated ? `${state.rmse?.toFixed(2)} points` : "Awaiting verified outcomes"],
          ["Unique forecasts evaluated", String(state.outcomesEvaluated)],
          ["Decisions recorded", String(state.decisionsRecorded)],
          ["Point forecasts recorded", String(state.predictionsRecorded)],
        ].map(([title, value]) => <article className="card" key={title}><span className="eyebrow">{title}</span><h2 style={{ margin: "10px 0 0", fontSize: 22 }}>{value}</h2></article>)}
      </section>}
    </>
  );
}
