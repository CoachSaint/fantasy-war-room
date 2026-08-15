import { PageHeader } from "@/components/page-header";
import { ConfigurationBanner } from "@/components/configuration-banner";

export default function HistoryPage() {
  return (
    <>
      <ConfigurationBanner message="History is context-bound and persistence-backed. No snapshot or Scout run is represented until the server reports it." />
      <PageHeader eyebrow="Decision history" title="See what changed, and why." description="The target workflow will compare snapshots, recommendations, and outcomes once persistence and a league connection are enabled." />
      <section className="card" style={{ display: "grid", gap: 10, maxWidth: 680 }}><h2 style={{ margin: 0 }}>History is not available</h2><p className="muted" style={{ margin: 0 }}>No live or persisted decision history exists in this build. Configure the league to establish the data contract first.</p></section>
    </>
  );
}
