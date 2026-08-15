import type { Evidence } from "@/lib/types";

export interface NewsSearchInput {
  playerIds?: string[];
  since?: string;
}

export interface NewsAdapter {
  search(input: NewsSearchInput): Promise<Evidence[]>;
}

export const news: NewsAdapter = {
  async search() {
    // TODO(agent-platform): plug in a search/news provider behind this interface.
    // Store compact summaries, canonical URLs, timestamps, confidence, and fingerprints.
    return [];
  },
};
