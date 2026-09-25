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
    decisionsRecorded: number; predictionsRecorded: number }>({ status: "loading", decisionsRecorded: 0, predictionsRecorded: 0 });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/accuracy?leagueId=${encodeURIComponent(leagueId)}`, {
          credentials: "same-origin", signal: controller.signal,
        });
        if (!response.ok) return setState({ status: "error", decisionsRecorded: 0, predictionsRecorded: 0 });
        const body = await response.json() as { decisionsRecorded?: number; predictionsRecorded?: number };
        if (!Number.isInteger(body.decisionsRecorded) || !Number.isInteger(body.predictionsRecorded)) {
          return setState({ status: "error", decisionsRecorded: 0, predictionsRecorded: 0 });
        }
        setState({ status: "ready", decisionsRecorded: body.decisionsRecorded!, predictionsRecorded: body.predictionsRecorded! });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", decisionsRecorded: 0, predictionsRecorded: 0 });
      }
    })();
    return () => controller.abort();
  }, [leagueId]);
  return (
    <>
      <PageHeader eyebrow="Accuracy lab" title="Measure decisions against outcomes." description="Recorded forecasts and decisions are shown below. An accuracy score requires finalized, independently observed game outcomes." />
      {state.status === "loading" && <p role="status">Loading ledger counts…</p>}
      {state.status === "error" && <p role="alert">Ledger counts could not be verified.</p>}
      {state.status === "ready" &&
      <section className="grid grid-2">
        {[
          ["Recommendation accuracy", "Awaiting verified outcomes"],
          ["Confidence calibration", "Not evaluated"],
          ["Decisions recorded", String(state.decisionsRecorded)],
          ["Point forecasts recorded", String(state.predictionsRecorded)],
        ].map(([title, value]) => <article className="card" key={title}><span className="eyebrow">{title}</span><h2 style={{ margin: "10px 0 0", fontSize: 22 }}>{value}</h2></article>)}
      </section>}
    </>
  );
}
