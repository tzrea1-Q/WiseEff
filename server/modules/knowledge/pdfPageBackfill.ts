import type { Database } from "../../shared/database/client";
import type { ObjectStore } from "../logs/objectStore";
import { createDefaultKnowledgeTextExtractor } from "./extraction";
import { enqueueEntryIndexRefresh, getIndexStatusForEntry, markIndexOutcome } from "./indexing/repository";

/** Serializes replica commits, separately from migration lock 7_154_209_001
 * and vector ensure lock 7_154_209_104. The suffix names migration 0248's
 * page metadata. Only short apply transactions hold this lock; concurrent
 * replicas may extract the same file, then re-check eligibility under the lock.
 */
const KNOWLEDGE_PDF_PAGES_ENSURE_LOCK_KEY = 7_154_209_248;

export type KnowledgePdfPagesEnsureResult = { updated: number; failed: number };

/** Startup ensure: one read in steady state; failed files are durably excluded.
 * Download and parse outside transactions; apply each entry atomically so
 * partial extraction leaves its original page metadata intact.
 */
export async function ensureKnowledgePdfPages(db: Database, objectStore: ObjectStore): Promise<KnowledgePdfPagesEnsureResult> {
  const extractor = createDefaultKnowledgeTextExtractor();
  const candidates = await db.query<{
    id: string; entry_id: string; organization_id: string; head_revision_id: string | null;
    storage_key: string; file_name: string; content_type: string;
  }>(
    `select f.id, f.entry_id, f.organization_id, e.head_revision_id,
            f.storage_key, f.file_name, f.content_type
     from knowledge_files f
     join knowledge_entries e on e.id = f.entry_id and e.organization_id = f.organization_id
     where f.content_type = 'application/pdf' and f.page_offsets is null
       and f.extraction_status = 'succeeded' and f.page_backfill_error is null
     order by f.organization_id, f.entry_id, f.id`
  );
  const entries = new Map<string, typeof candidates.rows>();
  for (const file of candidates.rows) {
    const files = entries.get(file.entry_id) ?? [];
    files.push(file);
    entries.set(file.entry_id, files);
  }
  let updated = 0;
  let failed = 0;
  for (const files of entries.values()) {
    const entry = files[0];
    const extractions: Array<{ id: string; text: string; pageOffsets: number[] }> = [];
    const failures = new Map<string, string>();
    for (const file of files) {
      try {
        const outcome = await extractor.extract({
          fileName: file.file_name, contentType: file.content_type,
          bytes: await objectStore.get(file.storage_key)
        });
        if (outcome.status === "failed") throw new Error(outcome.reason);
        if (!outcome.pageOffsets?.length) throw new Error("PDF page offsets are unavailable");
        extractions.push({ id: file.id, text: outcome.text, pageOffsets: outcome.pageOffsets });
      } catch (error) {
        failures.set(file.id, `PDF page backfill failed: ${error instanceof Error ? error.message.slice(0, 500) : "Unknown error"}`);
      }
    }
    const result = await db.transaction(async (tx) => {
      await tx.query("select pg_advisory_xact_lock($1)", [KNOWLEDGE_PDF_PAGES_ENSURE_LOCK_KEY]);
      const existing = await tx.query<{ head_revision_id: string | null }>(
        `select head_revision_id from knowledge_entries where organization_id = $1 and id = $2 for update`,
        [entry.organization_id, entry.entry_id]
      );
      if (!existing.rows.length || existing.rows[0].head_revision_id !== entry.head_revision_id) return { updated: 0, failed: 0 };
      const eligible = await tx.query<{ id: string; extracted_text: string | null }>(
        `select id, extracted_text from knowledge_files
         where organization_id = $1 and entry_id = $2 and id = any($3::uuid[])
           and content_type = 'application/pdf' and page_offsets is null
           and extraction_status = 'succeeded' and page_backfill_error is null
         for update`,
        [entry.organization_id, entry.entry_id, files.map((file) => file.id)]
      );
      if (eligible.rows.length !== files.length) return { updated: 0, failed: 0 };
      const storedText = new Map(eligible.rows.map((file) => [file.id, file.extracted_text]));
      for (const extraction of extractions) {
        if (storedText.get(extraction.id) !== extraction.text) {
          failures.set(extraction.id, "PDF page backfill failed: extracted text changed; pages not applied");
        }
      }
      const head = await tx.query<{ file_id: string | null }>(
        `select file_id from knowledge_revisions where organization_id = $1 and id = $2`,
        [entry.organization_id, entry.head_revision_id]
      );
      const headFileId = head.rows[0]?.file_id;
      if (failures.size) {
        for (const [fileId, error] of failures) {
          await tx.query(
            `update knowledge_files set page_backfill_error = $3 where organization_id = $1 and id = $2`,
            [entry.organization_id, fileId, error]
          );
        }
        const error = headFileId ? failures.get(headFileId) : undefined;
        if (error) {
          const health = await getIndexStatusForEntry(tx, { entryId: entry.entry_id, organizationId: entry.organization_id });
          await markIndexOutcome(tx, {
            ...health, entryId: entry.entry_id, organizationId: entry.organization_id, status: "failed", error
          });
        }
        return { updated: 0, failed: failures.size };
      }
      for (const extraction of extractions) {
        // Derived extraction only: preserve file metadata and authoring timestamps.
        await tx.query(
          `update knowledge_files set page_offsets = $3
           where organization_id = $1 and id = $2`,
          [entry.organization_id, extraction.id, extraction.pageOffsets]
        );
      }
      if (extractions.some((file) => file.id === headFileId)) {
        await enqueueEntryIndexRefresh(tx, { entryId: entry.entry_id, organizationId: entry.organization_id });
      }
      return { updated: extractions.length, failed: 0 };
    });
    updated += result.updated;
    failed += result.failed;
  }
  return { updated, failed };
}
