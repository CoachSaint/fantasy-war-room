"use client";

import { useEffect, useState } from "react";
import { activeConnectedMembership } from "@/lib/active-connected-membership";

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
        if (body && typeof body === "object" && "setupRequired" in body && body.setupRequired === true) {
          return setState({ status: "setup_required" });
        }
        const primary = activeConnectedMembership(body);
        if (!primary) return setState({ status: "unavailable" });
        const activeLeague = primary.league as Record<string, unknown>;
        const activeRoster = primary.roster as Record<string, unknown>;
        const scoring = activeLeague.scoring;
        const modifiers = scoring && typeof scoring === "object" && !Array.isArray(scoring)
          ? (scoring as Record<string, unknown>).statModifiers : null;
        const rules = modifiers && typeof modifiers === "object" && !Array.isArray(modifiers)
          ? modifiers as Record<string, unknown> : {};
        const receptionValue = Number(rules["11"]);
        const slots = Array.isArray(primary.rosterSlots)
          ? primary.rosterSlots.map((slot: { slotType?: unknown }) => String(slot.slotType || "")).filter(Boolean)
          : [];
        setState({ status: "connected", context: {
          league: {
            id: String(activeLeague.id), name: String(activeLeague.name), provider: String(activeLeague.provider || "manual"),
            season: Number(activeLeague.season), currentWeek: Number(activeLeague.currentWeek),
            scoringRuleCount: Object.keys(rules).length,
            receptionPoints: rules["11"] == null || !Number.isFinite(receptionValue) ? null : receptionValue,
            rosterSlots: slots,
          },
          roster: { id: String(activeRoster.id), name: activeRoster.name ? String(activeRoster.name) : null },
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
