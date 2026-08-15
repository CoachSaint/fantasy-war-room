import { PageHeader } from "@/components/page-header";
import { ConfigurationBanner } from "@/components/configuration-banner";

export default function RosterPage() {
  return (
    <>
      <ConfigurationBanner message="Roster context is shown only when /api/context reports a connected league and roster. No roster is inferred here." />
      <PageHeader eyebrow="Roster workspace" title="Your roster, when connected." description="This target workflow will show starters, bench, injury state, and position needs in one league-aware view." />
      <section className="card" style={{ display: "grid", gap: 10, maxWidth: 680 }}><h2 style={{ margin: 0 }}>Roster view awaiting context</h2><p className="muted" style={{ margin: 0 }}>When the context strip above reports a roster, this workflow can render it. Until then, nothing on this page represents a live team.</p></section>
    </>
  );
}
