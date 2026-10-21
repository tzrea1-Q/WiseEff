import type { Database } from "../../../shared/database/client";
import { detectKnowledgeReferenceSuggestions } from "../referenceSuggestions";
import { listReferenceSuggestionDetectionBatch } from "./repository";
import { loadIndexEntrySnapshot } from "./service";

/** Serializes replica startup detection backfills; 250 is the detection migration. */
const KNOWLEDGE_REFERENCE_SUGGESTIONS_ENSURE_LOCK_KEY = 7_154_209_250;

/** Bounded, detection-only background pass over current heads, including drafts. */
export async function scanKnowledgeReferenceSuggestions(
  db: Database, input: { organizationId?: string; neverDetected?: boolean; requestId: string }, reader: Database = db
): Promise<{ enqueued: number }> {
  let afterId: string | undefined;
  let enqueued = 0;
  for (;;) {
    const batch = await listReferenceSuggestionDetectionBatch(reader, { ...input, afterId });
    if (!batch.length) return { enqueued };
    for (const row of batch) {
      try {
        const snapshot = await loadIndexEntrySnapshot(db, { entryId: row.entry_id, organizationId: row.organization_id });
        if (snapshot) await detectKnowledgeReferenceSuggestions(db, snapshot, input.requestId);
      } catch (error) {
        console.warn("[knowledge-reference-suggestions] Detection failed; existing suggestions retained:", { entryId: row.entry_id, requestId: input.requestId, error });
      }
      enqueued++;
    }
    afterId = batch[batch.length - 1].entry_id;
  }
}

/** Called without awaiting from startup; the advisory lock prevents duplicate replica passes. */
export async function ensureKnowledgeReferenceSuggestions(db: Database): Promise<{ enqueued: number }> {
  if (!(await listReferenceSuggestionDetectionBatch(db, { neverDetected: true, limit: 1 })).length) return { enqueued: 0 };
  return db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock($1)", [KNOWLEDGE_REFERENCE_SUGGESTIONS_ENSURE_LOCK_KEY]);
    return scanKnowledgeReferenceSuggestions(db, { neverDetected: true, requestId: "knowledge-reference-backfill" }, tx);
  });
}
