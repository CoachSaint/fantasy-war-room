"use client";

import { useEffect, useState } from "react";
import { DecisionCard } from "@/components/decision-card";
import { PageHeader } from "@/components/page-header";
import type { Evidence, Recommendation, RecommendationKind } from "@/lib/types";

type DecisionState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; recommendations: Recommendation[]; evidence: Evidence[]; checkedAt: number };

export function ConnectedDecisions({
  leagueId,
  leagueName,
  eyebrow,
  title,
  description,
  kinds,
}: {
  leagueId: string;
  leagueName: string;
  eyebrow: string;
  title: string;
  description: string;
  kinds: RecommendationKind[];
}) {
  const [state, setState] = useState<DecisionState>({ status: "loading" });
  const [clock, setClock] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/recommendations?leagueId=${encodeURIComponent(leagueId)}&limit=50`, { credentials: "same-origin", signal: controller.signal });
        if (!response.ok) return setState({ status: "unavailable" });
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("data" in body)) return setState({ status: "unavailable" });
        const payload = body as { data: Recommendation[]; evidence?: Evidence[] };
        if (!Array.isArray(payload.data)) return setState({ status: "unavailable" });
        setState({ status: "ready", recommendations: payload.data, evidence: Array.isArray(payload.evidence) ? payload.evidence : [], checkedAt: Date.now() });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "unavailable" });
      }
    })();
    return () => controller.abort();
  }, [leagueId]);

  const relevant = state.status === "ready" ? state.recommendations.filter((item) => kinds.includes(item.kind)) : [];
  const fresh = relevant.filter((item) => new Date(item.freshUntil).getTime() > (clock ?? (state.status === "ready" ? state.checkedAt : 0)));

  return (
    <>
      <PageHeader eyebrow={`${eyebrow} · ${leagueName}`} title={title} description={description} />
      {state.status === "loading" && <p role="status">Loading connected decisions…</p>}
      {state.status === "unavailable" && <p role="alert">League decisions are unavailable. No demo recommendations were substituted.</p>}
      {state.status === "ready" && fresh.length === 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>No current decisions yet</h2>
          <p className="muted">The connected league has no fresh, materialized {eyebrow.toLowerCase()} recommendations. Complete provider import and a successful Scout run before relying on this view.</p>
          {relevant.length > 0 && <p className="muted">{relevant.length} earlier recommendation{relevant.length === 1 ? " is" : "s are"} stale and hidden.</p>}
        </section>
      )}
      {state.status === "ready" && fresh.length > 0 && (
        <section className="grid grid-3">
          {fresh.map((item) => <DecisionCard key={item.id} item={item} evidence={state.evidence} />)}
        </section>
      )}
    </>
  );
}
