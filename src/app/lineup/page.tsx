import { PageHeader } from "@/components/page-header";

export default function LineupPage() {
  return <>
    <PageHeader eyebrow="Lineup lab" title="Two decisions need attention." description="Show only lineup choices that are actually close, newly changed, stale, or materially affected by injury and usage information." />
    <section className="grid grid-2">
      <article className="card"><span className="pill">START · 91% confidence</span><h2 className="title" style={{ marginTop: 22 }}>Higher-volume RB over volatile flex.</h2><p className="muted">Opportunity edge · receiving floor · role certainty</p></article>
      <article className="card"><span className="pill">WATCH STATUS</span><h2 className="title" style={{ marginTop: 22 }}>Questionable WR needs a fresh check.</h2><p className="muted">Recommendation expires before kickoff if no new availability evidence arrives.</p></article>
    </section>
  </>;
}
