"use client";

import { useEffect, useState } from "react";

export type ConnectedLeague = {
  league: { id: string; name: string; season: number; currentWeek: number };
  roster: { id: string; name: string | null } | null;
};

export type LeagueState =
  | { status: "loading" }
  | { status: "auth_required" | "setup_required" | "unavailable" }
  | { status: "connected"; context: ConnectedLeague };

export function useConnectedLeague(): LeagueState {
  const [state, setState] = useState<LeagueState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/context", { credentials: "same-origin", signal: controller.signal });
        if (response.status === 401) return setState({ status: "auth_required" });
        if (!response.ok) return setState({ status: "unavailable" });
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("data" in body)) return setState({ status: "unavailable" });
        const data = (body as { data?: { memberships?: unknown } }).data;
        const memberships = Array.isArray(data?.memberships) ? data.memberships : [];
        const primary = memberships.find((entry) => entry?.membership?.isPrimary) ?? memberships[0];
        if (!primary?.league?.id) return setState({ status: "setup_required" });
        setState({ status: "connected", context: {
          league: { id: String(primary.league.id), name: String(primary.league.name), season: Number(primary.league.season), currentWeek: Number(primary.league.currentWeek) },
          roster: primary.roster?.id ? { id: String(primary.roster.id), name: primary.roster.name ? String(primary.roster.name) : null } : null,
        } });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "unavailable" });
      }
    })();
    return () => controller.abort();
  }, []);

  return state;
}
