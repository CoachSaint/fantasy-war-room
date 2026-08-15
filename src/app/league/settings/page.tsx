import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ConfigurationBanner } from "@/components/configuration-banner";

export default function LeagueSettingsPage() {
  return (
    <>
      <ConfigurationBanner message="Settings are server-bound only after setup is accepted. This page never infers league or manager values." linkLabel="Start setup" href="/league/setup" />
      <PageHeader eyebrow="League settings" title="A clear contract for league context." description="Review the configuration that will govern scoring, roster-aware decisions, availability, and evidence freshness." />
      <section className="grid grid-2">
        {[
          ["League identity", "Server context required", "The context strip above is the only source for connected league identity."],
          ["Scoring profile", "Server context required", "Scoring and roster rules are read only after setup succeeds."],
          ["Provider access", "Server context required", "No provider state is inferred when the context endpoint is unavailable."],
          ["Persistence", "Setup endpoint required", "This status page does not claim that changes were saved."],
        ].map(([title, status, detail]) => (
          <article className="card" key={title} style={{ display: "grid", gap: 8 }}>
            <span className="eyebrow">{title}</span><strong style={{ fontSize: 18 }}>{status}</strong><span className="muted" style={{ fontSize: 13 }}>{detail}</span>
          </article>
        ))}
      </section>
      <p style={{ marginTop: 20 }}><Link href="/league/setup" style={{ color: "var(--good)", fontWeight: 700 }}>Return to setup checklist</Link></p>
    </>
  );
}
