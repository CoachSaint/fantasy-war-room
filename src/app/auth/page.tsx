"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/browser";

type AuthState = "checking" | "signed_out" | "signed_in" | "unavailable";

export default function AuthPage() {
  const [state, setState] = useState<AuthState>(() => isSupabaseConfigured() ? "checking" : "unavailable");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }

    const client = createClient();
    let active = true;
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setState(session ? "signed_in" : "signed_out");
      if (session) setMessage("");
    });
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      setState(error ? "signed_out" : data.session ? "signed_in" : "signed_out");
      if (error) setMessage("This session could not be completed. Open a fresh invitation link or sign in below.");
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSupabaseConfigured() || busy) return;
    setBusy(true);
    setMessage("");
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setMessage("Sign-in failed. Check your email and password, or ask the league owner for a new invitation.");
    else window.location.replace("/today");
  }

  async function savePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSupabaseConfigured() || busy || newPassword.length < 12) return;
    setBusy(true);
    setMessage("");
    const { error } = await createClient().auth.updateUser({ password: newPassword });
    setBusy(false);
    if (error) setMessage("Password could not be saved. Please try again.");
    else {
      setNewPassword("");
      setMessage("Password saved. You can now return using your email and password.");
    }
  }

  async function signOut() {
    if (busy) return;
    setBusy(true);
    const { error } = await createClient().auth.signOut();
    setBusy(false);
    if (error) setMessage("Sign-out failed. Please try again.");
    else window.location.replace("/auth");
  }

  return (
    <section className="card" style={{ maxWidth: 520, margin: "32px auto", display: "grid", gap: 16 }}>
      <div className="eyebrow">Fantasy War Room account</div>
      <h1 className="title">Sign in</h1>
      {state === "checking" && <p role="status" className="muted">Checking your invitation…</p>}
      {state === "unavailable" && <p role="alert">Sign-in is not configured for this deployment.</p>}
      {state === "signed_in" && (
        <>
          <p role="status">You are signed in. Set a password so you can return after this invitation link expires.</p>
          <form onSubmit={savePassword} style={{ display: "grid", gap: 12 }}>
            <label htmlFor="auth-new-password">New password (at least 12 characters)</label>
            <input id="auth-new-password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} style={{ minHeight: 44, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: "0 12px" }} />
            <button type="submit" disabled={busy || newPassword.length < 12} style={{ minHeight: 44, borderRadius: 999, border: 0, background: "var(--text)", color: "var(--bg)", fontWeight: 700 }}>{busy ? "Saving…" : "Save password"}</button>
          </form>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <Link href="/today" style={{ color: "var(--good)", fontWeight: 700 }}>Open Today</Link>
            <button type="button" onClick={signOut} disabled={busy}>Sign out</button>
          </div>
        </>
      )}
      {state === "signed_out" && (
        <>
          <p className="muted" style={{ margin: 0 }}>First visit? Open your invitation email. After setting a password, sign in here on later visits.</p>
          <form onSubmit={signIn} style={{ display: "grid", gap: 12 }}>
            <label htmlFor="auth-email">Email address</label>
            <input id="auth-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} style={{ minHeight: 44, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: "0 12px" }} />
            <label htmlFor="auth-password">Password</label>
            <input id="auth-password" type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} style={{ minHeight: 44, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-strong)", color: "var(--text)", padding: "0 12px" }} />
            <button type="submit" disabled={busy} style={{ minHeight: 44, borderRadius: 999, border: 0, background: "var(--text)", color: "var(--bg)", fontWeight: 700 }}>{busy ? "Signing in…" : "Sign in"}</button>
          </form>
        </>
      )}
      {message && <p role="status" style={{ margin: 0 }}>{message}</p>}
    </section>
  );
}
