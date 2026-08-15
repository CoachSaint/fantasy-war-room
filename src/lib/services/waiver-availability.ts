import type { LeagueContext, Player, Position } from "@/lib/types";

export interface WaiverAvailabilityInput {
  league?: LeagueContext;
  players: Player[];
  rosteredPlayerIds?: string[];
  excludedPlayerIds?: string[];
  position?: Position;
}

export interface WaiverRejection {
  playerId: string;
  reason: "rostered" | "excluded" | "unresolved" | "wrong_position" | "not_in_active_pool";
}

export interface WaiverAvailabilityResult {
  available: Player[];
  rejected: WaiverRejection[];
}

/**
 * Pure availability gate. It does not infer free agents from a user's roster;
 * callers provide the full player pool or a verified LeagueContext pool.
 */
export function findWaiverAvailablePlayers(input: WaiverAvailabilityInput): WaiverAvailabilityResult {
  const rostered = new Set(input.rosteredPlayerIds || input.league?.rosterPlayerIds || []);
  const excluded = new Set(input.excludedPlayerIds || []);
  const activePool = input.league ? new Set(input.league.availablePlayerIds) : undefined;
  const seen = new Set<string>();
  const available: Player[] = [];
  const rejected: WaiverRejection[] = [];

  for (const player of input.players) {
    if (seen.has(player.id)) {
      rejected.push({ playerId: player.id, reason: "unresolved" });
      continue;
    }
    seen.add(player.id);
    if (rostered.has(player.id)) {
      rejected.push({ playerId: player.id, reason: "rostered" });
    } else if (excluded.has(player.id)) {
      rejected.push({ playerId: player.id, reason: "excluded" });
    } else if (activePool && !activePool.has(player.id)) {
      rejected.push({ playerId: player.id, reason: "not_in_active_pool" });
    } else if (!player.team || !player.position || !player.fullName) {
      rejected.push({ playerId: player.id, reason: "unresolved" });
    } else if (input.position && player.position !== input.position) {
      rejected.push({ playerId: player.id, reason: "wrong_position" });
    } else {
      available.push(player);
    }
  }
  available.sort((a, b) => a.position.localeCompare(b.position) || a.fullName.localeCompare(b.fullName) || a.id.localeCompare(b.id));
  rejected.sort((a, b) => a.playerId.localeCompare(b.playerId) || a.reason.localeCompare(b.reason));
  return { available, rejected };
}
