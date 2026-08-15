import type { Recommendation } from "@/lib/types";

const label: Record<Recommendation["kind"], string> = {
  draft: "Draft",
  start: "Start",
  sit: "Sit",
  add: "Add",
  drop: "Drop",
  hold: "Hold",
  watch: "Watch",
};

export function DecisionCard({ item }: { item: Recommendation }) {
  return (
    <article className="card" style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start" }}>
        <span className="pill">{label[item.kind]}</span>
        <div style={{ textAlign: "right" }}>
          <div className="score">{item.score}</div>
          <div className="muted" style={{ fontSize: 12 }}>WAR score</div>
        </div>
      </div>
      <div>
        <h2 style={{ margin: 0, fontSize: 24, letterSpacing: "-.025em" }}>{item.headline}</h2>
        <p className="muted" style={{ marginBottom: 0 }}>{item.reasonCodes.join(" · ").replaceAll("_", " ")}</p>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span>{item.confidence}% confidence</span>
        <span className="muted">{item.evidenceIds.length} evidence items</span>
      </div>
    </article>
  );
}
