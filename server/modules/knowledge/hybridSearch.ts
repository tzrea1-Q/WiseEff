import type { KnowledgeSearchResultDto } from "./types";

const RRF_K = 60;

/**
 * Reciprocal-rank fusion of the FTS/trigram ranking and the vector-similarity
 * ranking, keyed by entry. FTS hits keep their query-highlighting excerpt;
 * vector-only hits carry the best chunk excerpt.
 */
export function fuseKnowledgeSearchResults(input: {
  fts: KnowledgeSearchResultDto[];
  vector: KnowledgeSearchResultDto[];
  limit: number;
  k?: number;
}): KnowledgeSearchResultDto[] {
  const k = input.k ?? RRF_K;
  const scores = new Map<string, { score: number; item: KnowledgeSearchResultDto }>();

  const accumulate = (items: KnowledgeSearchResultDto[], preferExistingItem: boolean) => {
    items.forEach((item, rank) => {
      const contribution = 1 / (k + rank + 1);
      const existing = scores.get(item.entryId);
      if (existing) {
        existing.score += contribution;
        if (!preferExistingItem) {
          existing.item = item;
        }
      } else {
        scores.set(item.entryId, { score: contribution, item });
      }
    });
  };

  // FTS first so its excerpt wins for entries present in both rankings.
  accumulate(input.fts, false);
  accumulate(input.vector, true);

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit)
    .map((entry) => entry.item);
}
