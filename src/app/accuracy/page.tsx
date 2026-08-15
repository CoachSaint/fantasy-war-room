import { PageHeader } from "@/components/page-header";
import { ConfigurationBanner } from "@/components/configuration-banner";

export default function AccuracyPage() {
  return (
    <>
      <ConfigurationBanner message="Accuracy is context-bound and outcome-backed. No score is shown until persisted recommendations and outcomes are reported." linkLabel="Configure league" />
      <PageHeader eyebrow="Accuracy lab" title="Measure decisions against outcomes." description="The target workflow will track recommendation confidence, realized results, calibration, and misses without inventing a score before enough data exists." />
      <section className="grid grid-2">
        {[
          ["Recommendation accuracy", "Awaiting outcomes"],
          ["Confidence calibration", "Awaiting history"],
          ["Sample size", "0 persisted decisions"],
          ["Evaluation window", "Not configured"],
        ].map(([title, value]) => <article className="card" key={title}><span className="eyebrow">{title}</span><h2 style={{ margin: "10px 0 0", fontSize: 22 }}>{value}</h2></article>)}
      </section>
    </>
  );
}
