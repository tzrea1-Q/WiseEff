import type { LogRecordDto } from "../logs/types";

/**
 * Related-knowledge recommendations on log-analysis results (design deferred
 * roadmap item 1): the similarity query derives ONLY from the stored
 * analysis-record DTO (conclusion + impact) — never from analyzer internals or
 * rule ids — so the parallel log-analysis kernel rewrite behind
 * `LogAnalysisAdapter` cannot break it.
 */

export const RELATED_KNOWLEDGE_DEFAULT_LIMIT = 5;

/**
 * Relevance cutoff for the trigram branch: `word_similarity(query, search_text)`
 * measures how well the derived conclusion/impact query matches the best
 * contiguous extent of an entry's search text (trigram-based, so CJK works with
 * the same caveats as the Phase 1 search). Entries below the cutoff are dropped
 * instead of padding the list with unrelated results.
 */
export const RELATED_KNOWLEDGE_MIN_TEXT_SIMILARITY = 0.2;

/**
 * Relevance cutoff for the semantic branch: cosine distance of the best chunk
 * per entry. Chunks farther than this are not related enough to recommend.
 */
export const RELATED_KNOWLEDGE_MAX_VECTOR_DISTANCE = 0.75;

/** Keeps the derived query bounded for trigram matching and embedding calls. */
const MAX_QUERY_CHARS = 400;

export function deriveRelatedKnowledgeQuery(log: Pick<LogRecordDto, "conclusion" | "impact">): string {
  return [log.conclusion, log.impact]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, MAX_QUERY_CHARS);
}
