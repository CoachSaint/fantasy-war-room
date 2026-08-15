import { PageHeader } from "@/components/page-header";

const picks = [
  ["Best Pick", "RB · Tier 1", 92, "Roster fit + scarcity"],
  ["Best Value", "WR · Tier 2", 88, "Market discount"],
  ["Upside Swing", "WR · Tier 3", 84, "Ceiling + role growth"],
];

export default function DraftPage() {
  return <>
    <PageHeader eyebrow="Draft room" title="Make the pick. Know why." description="Available-player recommendations should react to scoring, roster construction, positional scarcity and market value—not a static top-200 list." />
    <section className="grid grid-3">{picks.map(([name, meta, score, reason]) => <article className="card" key={String(name)}><div className="eyebrow">{name}</div><div className="score" style={{ marginTop: 22 }}>{score}</div><h2 style={{ marginBottom: 6 }}>{meta}</h2><p className="muted">{reason}</p><button style={{ width:"100%", minHeight:44, border:0, borderRadius:999, background:"var(--text)", color:"var(--bg)", fontWeight:700 }}>Compare</button></article>)}</section>
  </>;
}
