import { PageHeader } from "@/components/page-header";

export default function PlayersPage() {
  return <>
    <PageHeader eyebrow="Player intelligence" title="Every score has a trail." description="Search player identity, current role, projection, trend and evidence without exposing provider-specific payloads to the interface." />
    <section className="card"><input aria-label="Search players" placeholder="Search player…" style={{ width:"100%", minHeight:52, borderRadius:16, border:"1px solid var(--line)", background:"var(--surface)", color:"var(--text)", padding:"0 16px", outline:"none" }} /></section>
  </>;
}
