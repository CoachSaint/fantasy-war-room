import Link from "next/link";
import type { LeagueState } from "@/lib/use-connected-league";

export function LeagueGate({ state }: { state: LeagueState }) {
  if (state.status === "loading") return <p role="status" className="muted">Checking your league…</p>;
  if (state.status === "auth_required") return <section className="card"><h1>Sign in required</h1><p>Sign in to see your league and current decisions.</p><Link href="/auth">Sign in</Link></section>;
  if (state.status === "setup_required") return <section className="card"><h1>League setup required</h1><p>Connect and import your league to see your own data.</p><Link href="/league/setup">Open league setup</Link></section>;
  return <section className="card" role="alert"><h1>League unavailable</h1><p>We could not load your league. Please try again later.</p></section>;
}
