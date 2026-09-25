export type DraftPosition = "QB" | "RB" | "WR" | "TE";
export type DraftMode = "best" | "value" | "safe" | "upside";

export type DraftBoardInputPlayer = {
  id: string;
  name: string;
  position: DraftPosition;
  yahooOrder: number;
  projectedSeasonPoints: number;
  sleeperAdp: number | null;
  touchdownShare: number;
  providerStatus: string | null;
  observedAt: string;
  evidenceId: string;
  assumedZeroYahooStatIds: string[];
};

export type DraftBoardPlayer = DraftBoardInputPlayer & {
  positionRank: number;
  availableAtPosition: number;
  nextAvailableEdge: number | null;
  openDirectStarterSlots: number | null;
  marketGap: number | null;
  priority: Record<DraftMode, number | null>;
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

/** Deterministic source-relative ordering, with no outcome probability claim. */
export function buildDraftBoard(
  players: DraftBoardInputPlayer[],
  openDirectSlots: Partial<Record<DraftPosition, number | null>>,
): DraftBoardPlayer[] {
  const byPosition = new Map<DraftPosition, DraftBoardInputPlayer[]>();
  for (const player of players) {
    if (!Number.isFinite(player.projectedSeasonPoints) || player.projectedSeasonPoints <= 0 ||
        !Number.isInteger(player.yahooOrder) || player.yahooOrder < 1 || player.yahooOrder > 200 ||
        !Number.isFinite(player.touchdownShare) || player.touchdownShare < 0 || player.touchdownShare > 1) continue;
    const group = byPosition.get(player.position) || [];
    group.push(player);
    byPosition.set(player.position, group);
  }
  const result: DraftBoardPlayer[] = [];
  for (const [position, group] of byPosition) {
    group.sort((a, b) => b.projectedSeasonPoints - a.projectedSeasonPoints || a.yahooOrder - b.yahooOrder);
    const adpEligible = group.filter((player) => player.sleeperAdp != null
      && Number.isFinite(player.sleeperAdp) && player.sleeperAdp >= 1 && player.sleeperAdp < 1000);
    const adpRanks = new Map([...adpEligible].sort((a, b) => a.sleeperAdp! - b.sleeperAdp!)
      .map((player, index) => [player.id, index + 1]));
    const projectionRanksWithAdp = new Map(adpEligible.map((player, index) => [player.id, index + 1]));
    const open = openDirectSlots[position] == null ? null
      : Math.max(0, Math.min(5, Math.trunc(openDirectSlots[position]!)));
    for (const [index, player] of group.entries()) {
      const next = group[index + 1];
      const edge = next ? Number((player.projectedSeasonPoints - next.projectedSeasonPoints).toFixed(1)) : null;
      const scarcity = edge == null ? 0 : clamp(edge / 8, 0, 12);
      const relative = (group.length - index) / group.length * 100;
      const need = Math.min(20, (open || 0) * 10);
      const statusPenalty = /\b(q|questionable)\b/i.test(player.providerStatus || "") ? 18
        : /\b(p|probable)\b/i.test(player.providerStatus || "") ? 5 : 0;
      const best = clamp(relative * 0.72 + need + scarcity);
      const adpRank = adpRanks.get(player.id);
      const projectionRankWithAdp = projectionRanksWithAdp.get(player.id);
      const marketGap = adpRank != null && projectionRankWithAdp != null
        ? adpRank - projectionRankWithAdp : null;
      result.push({ ...player, positionRank: index + 1,
        availableAtPosition: group.length, nextAvailableEdge: edge,
        openDirectStarterSlots: open, marketGap,
        priority: {
          best: Math.round(best),
          value: marketGap == null ? null : Math.round(clamp(best * 0.75 + clamp(marketGap * 5, -20, 20) + 10)),
          safe: Math.round(clamp(best + (1 - player.touchdownShare) * 12 - statusPenalty)),
          upside: Math.round(clamp(best + player.touchdownShare * 18 + scarcity - statusPenalty / 2)),
        },
      });
    }
  }
  return result.sort((a, b) => (b.priority.best || 0) - (a.priority.best || 0)
    || a.yahooOrder - b.yahooOrder);
}
