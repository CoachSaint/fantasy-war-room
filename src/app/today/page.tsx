import { DecisionCard } from "@/components/decision-card";
import { PageHeader } from "@/components/page-header";
import { demoRecommendations } from "@/lib/demo";

export default function TodayPage() {
  return (
    <>
      <PageHeader eyebrow="Saturday · Intelligence current" title="Three moves matter today." description="The daily brief is a decision delta, not a news feed. Every action carries a score, confidence, freshness, and evidence trail." />
      <section className="grid grid-3">
        {demoRecommendations.map((item) => <DecisionCard key={item.id} item={item} />)}
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <div className="eyebrow">What changed</div>
        <h2 className="title" style={{ marginTop: 8 }}>Scout found two meaningful role changes.</h2>
        <p className="muted" style={{ maxWidth: 760, lineHeight: 1.55 }}>This demo card becomes a structured diff between the newest successful Scout snapshot and the previous one. Keep the explanation short; make the source trail inspectable.</p>
      </section>
    </>
  );
}
