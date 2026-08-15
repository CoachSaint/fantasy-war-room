import { PageHeader } from "@/components/page-header";

export default function WaiversPage() {
  return <>
    <PageHeader eyebrow="Waiver wire" title="Available to you, not the internet." description="Rank only players the league can actually add, then price the move against roster need, role change, rest-of-season value and acquisition cost." />
    <section className="card"><div className="eyebrow">Top move</div><div style={{ display:"flex", alignItems:"end", justifyContent:"space-between", gap:20, flexWrap:"wrap", marginTop:12 }}><div><h2 className="title">Add emerging WR → drop bench RB.</h2><p className="muted">Suggested FAAB: 9–13% · urgency high · 3-week outlook positive</p></div><div className="score">89</div></div></section>
  </>;
}
