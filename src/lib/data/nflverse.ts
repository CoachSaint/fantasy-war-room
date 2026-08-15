import type { Evidence, PlayerSnapshot } from "@/lib/types";

export interface NflverseAdapter {
  getPlayerSnapshots(input: { season: number; week: number }): Promise<PlayerSnapshot[]>;
  getEvidence(input: { season: number; week: number }): Promise<Evidence[]>;
}

export const nflverse: NflverseAdapter = {
  async getPlayerSnapshots() {
    // TODO(agent-data): implement using the currently supported nflverse datasets.
    // Normalize external IDs through a canonical player_id_map before persistence.
    return [];
  },
  async getEvidence() {
    return [];
  },
};
