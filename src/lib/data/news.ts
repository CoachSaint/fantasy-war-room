import type { Evidence, EvidenceType } from "@/lib/types";

export interface RawNewsArticle {
  id?: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  playerId: string;
  confidence?: number;
  category?: EvidenceType;
}

export interface NewsSearchInput {
  playerIds?: string[];
  since?: string;
  query?: string;
}

export interface NewsAdapter {
  search(input: NewsSearchInput): Promise<Evidence[]>;
  extractEvidence(articles: RawNewsArticle[]): Evidence[];
  createFingerprint(article: { source?: string; title?: string; summary?: string; playerId?: string }): string;
  deduplicate(evidenceList: Evidence[]): Evidence[];
}

export function createFingerprint(article: {
  source?: string;
  title?: string;
  summary?: string;
  playerId?: string;
}): string {
  const player = article.playerId ? article.playerId.toLowerCase() : "gen";
  const text = `${article.title || ""} ${article.summary || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5)
    .join("_");

  return `${player}_${text || "news_update"}`;
}

export function extractEvidence(articles: RawNewsArticle[]): Evidence[] {
  const now = new Date().toISOString();
  return articles.map((article, idx) => {
    const fingerprint = createFingerprint(article);
    const textLower = `${article.title} ${article.summary}`.toLowerCase();

    let type: EvidenceType = article.category || "news";
    if (!article.category) {
      if (textLower.includes("injur") || textLower.includes("out") || textLower.includes("dnp") || textLower.includes("limited")) {
        type = "injury";
      } else if (textLower.includes("depth") || textLower.includes("starter") || textLower.includes("benched")) {
        type = "depth_chart";
      } else if (textLower.includes("target") || textLower.includes("snap") || textLower.includes("carry")) {
        type = "usage";
      } else if (textLower.includes("traded") || textLower.includes("signed") || textLower.includes("waived")) {
        type = "transaction";
      }
    }

    return {
      id: `ev_news_${idx}_${Date.now()}`,
      playerId: article.playerId,
      type,
      source: article.source,
      sourceUrl: article.url,
      observedAt: now,
      publishedAt: article.publishedAt,
      confidence: article.confidence ?? 0.85,
      summary: article.summary || article.title,
      fingerprint,
    };
  });
}

export function deduplicate(evidenceList: Evidence[]): Evidence[] {
  const byFingerprint = new Map<string, Evidence[]>();

  for (const item of evidenceList) {
    const list = byFingerprint.get(item.fingerprint) || [];
    list.push(item);
    byFingerprint.set(item.fingerprint, list);
  }

  const result: Evidence[] = [];

  for (const [, items] of byFingerprint) {
    if (items.length === 1) {
      result.push(items[0]);
    } else {
      const sorted = [...items].sort((a, b) => b.confidence - a.confidence);
      const best = sorted[0];
      result.push({
        ...best,
        observedAt: items.map((i) => i.observedAt).sort().reverse()[0],
      });
    }
  }

  // Conflict resolution for identical player with conflicting injury status
  const byPlayer = new Map<string, Evidence[]>();
  for (const item of result) {
    const list = byPlayer.get(item.playerId) || [];
    list.push(item);
    byPlayer.set(item.playerId, list);
  }

  for (const [, playerEv] of byPlayer) {
    const injuryEvs = playerEv.filter((e) => e.type === "injury");
    if (injuryEvs.length > 1) {
      const hasOut = injuryEvs.some((e) => e.summary.toLowerCase().includes("out") || e.summary.toLowerCase().includes("inactive"));
      const hasActive = injuryEvs.some((e) => e.summary.toLowerCase().includes("active") || e.summary.toLowerCase().includes("expected to play") || e.summary.toLowerCase().includes("full"));

      if (hasOut && hasActive) {
        for (const ev of injuryEvs) {
          ev.confidence = parseFloat((ev.confidence * 0.75).toFixed(2));
        }
      }
    }
  }

  return result;
}

export const news: NewsAdapter = {
  createFingerprint,
  extractEvidence,
  deduplicate,

  async search(input: NewsSearchInput): Promise<Evidence[]> {
    return [];
  },
};
