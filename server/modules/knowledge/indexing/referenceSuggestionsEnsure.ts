import type { Database } from "../../../shared/database/client";

/** Startup backfill: detection stays in the worker, including for legacy drafts. */
export async function ensureKnowledgeReferenceSuggestions(db: Database): Promise<{ enqueued: number }> {
  const missing = await db.query(
    `select 1 from knowledge_entries
     where reference_suggestions_detected_at is null and status <> 'archived' limit 1`
  );
  if (!missing.rows.length) return { enqueued: 0 };

  return db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock($1)", [7_154_209_249]);
    // Re-check under the replica lock. Never reset a job a worker already owns
    // or one already queued; either will detect its current head normally.
    const result = await tx.query(
      `insert into knowledge_index_status (entry_id, organization_id, status, error, enqueued_at, updated_at)
       select id, organization_id, 'pending', null, now(), now() from knowledge_entries
       where reference_suggestions_detected_at is null and status <> 'archived'
       on conflict (entry_id) do update
         set status = 'pending', error = null, enqueued_at = now(), updated_at = now()
         where knowledge_index_status.status not in ('pending', 'processing')`
    );
    return { enqueued: result.rowCount ?? 0 };
  });
}
