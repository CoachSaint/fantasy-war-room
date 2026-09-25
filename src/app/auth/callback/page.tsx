"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/browser";

export default function AuthCallbackPage() {
  const [failed, setFailed] = useState(() => !isSupabaseConfigured());

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const client = createClient();
    let active = true;
    let completed = false;
    const timeout = window.setTimeout(() => {
      if (active && !completed) setFailed(true);
    }, 5000);
    const complete = () => {
      if (!active || completed) return;
      completed = true;
      // A full navigation ensures every API request sees the newly written
      // Supabase SSR cookies, including manager context and Yahoo routes.
      window.location.replace("/today");
    };
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (session) complete();
    });
    void client.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) complete();
    });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      listener.subscription.unsubscribe();
    };
  }, []);

  return (
    <section className="card" style={{ maxWidth: 520, margin: "32px auto" }}>
      <div className="eyebrow">Fantasy War Room account</div>
      <h1 className="title">Completing sign-in</h1>
      {failed ? <p role="alert">This invitation or sign-in link could not be completed. It may have expired. <Link href="/auth" style={{ color: "var(--good)", fontWeight: 700 }}>Request a new link</Link>.</p> : <p role="status" className="muted">Verifying your link…</p>}
    </section>
  );
}
