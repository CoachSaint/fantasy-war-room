"use client";

import { useEffect, useState } from "react";
import { selectPrimaryMembership } from "@/lib/select-primary-membership";

export type ConnectedLeague = {
  league: { id: string; name: string; provider: string; season: number; currentWeek: number; scoringRuleCount: number; receptionPoints: number | null; rosterSlots: string[] };
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
        const primary = selectPrimaryMembership(memberships);
        if (!primary?.league?.id) return setState({ status: "setup_required" });
        const scoring = primary.league.scoring;
        const modifiers = scoring && typeof scoring === "object" && !Array.isArray(scoring)
          ? scoring.statModifiers : null;
        const rules = modifiers && typeof modifiers === "object" && !Array.isArray(modifiers)
          ? modifiers as Record<string, unknown> : {};
        const receptionValue = Number(rules["11"]);
        const slots = Array.isArray(primary.rosterSlots)
          ? primary.rosterSlots.map((slot: { slotType?: unknown }) => String(slot.slotType || "")).filter(Boolean)
          : [];
        setState({ status: "connected", context: {
          league: {
            id: String(primary.league.id), name: String(primary.league.name), provider: String(primary.league.provider || "manual"),
            season: Number(primary.league.season), currentWeek: Number(primary.league.currentWeek),
            scoringRuleCount: Object.keys(rules).length,
            receptionPoints: rules["11"] == null || !Number.isFinite(receptionValue) ? null : receptionValue,
            rosterSlots: slots,
          },
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
