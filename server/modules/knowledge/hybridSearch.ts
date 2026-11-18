const RRF_K = 60;

/**
 * Reciprocal-rank fusion of the FTS/trigram ranking and the vector-similarity
 * ranking, keyed by entry. FTS hits keep their query-highlighting excerpt;
 * vector-only hits carry the best chunk excerpt.
 */
export function fuseKnowledgeSearchResults<T extends { entryId: string }>(input: {
  fts: T[];
  vector: T[];
  limit: number;
  k?: number;
}): T[] {
  const k = input.k ?? RRF_K;
  const scores = new Map<string, { score: number; item: T }>();

  const accumulate = (items: T[], preferExistingItem: boolean) => {
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
