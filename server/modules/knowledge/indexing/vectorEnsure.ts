import type { Database } from "../../../shared/database/client";
import {
  detectKnowledgeVectorSupport,
  enqueueAllPublishedEntriesAcrossOrganizations,
  invalidateKnowledgeVectorSupportCache
} from "./repository";

/**
 * Serializes concurrent replicas running the late-install ensure below. This is
 * runtime DDL, so it takes its own advisory lock (the migration pipeline uses
 * 7_154_209_001 in server/shared/database/migrations.ts); the trailing 104
 * points at migration 0104, whose conditional embedding column this completes.
 */
const KNOWLEDGE_VECTOR_ENSURE_LOCK_KEY = 7_154_209_104;

export type KnowledgeVectorEnsureResult =
  /** pgvector is not offered by this PostgreSQL server: FTS-only stays the honest mode. */
  | { outcome: "extension-unavailable" }
  /** pgvector is offered but CREATE EXTENSION failed (typically privileges); FTS-only continues. */
  | { outcome: "extension-install-failed"; reason: string }
  /** The embedding column already exists (migration 0104 or an earlier ensure created it). */
  | { outcome: "already-present" }
  /** The column was just added; every published entry was re-enqueued to gain embeddings. */
  | { outcome: "installed"; enqueued: number };

/**
 * Startup ensure for pgvector late installs (TD-090): migration 0104 only adds
 * `knowledge_chunks.embedding` when pgvector was installed at migration time.
 * When an operator installs the extension afterwards, this ensure completes the
 * schema on the next restart — column add plus a full reindex enqueue so
 * existing published entries gain embeddings — instead of the manual SQL the
 * self-hosted runbook used to require.
 *
 * Idempotent and multi-replica safe: steady states return after read-only
 * probes, and the install path re-checks under a transactional advisory lock,
 * so concurrent replicas add the column exactly once. Matches migration 0104's
 * schema exactly: an untyped `vector` column and no ANN index (the MVP searches
 * with exact scans).
 */
export async function ensureKnowledgeVectorColumn(db: Database): Promise<KnowledgeVectorEnsureResult> {
  // Unlocked pre-checks keep steady-state startups lock-free.
  const available = await db.query(
    `select 1 from pg_available_extensions where name = 'vector' limit 1`
  );
  if (available.rows.length === 0) {
    return { outcome: "extension-unavailable" };
  }
  if (await detectKnowledgeVectorSupport(db)) {
    return { outcome: "already-present" };
  }

  const result = await db.transaction(async (tx): Promise<KnowledgeVectorEnsureResult> => {
    await tx.query("select pg_advisory_xact_lock($1)", [KNOWLEDGE_VECTOR_ENSURE_LOCK_KEY]);
    // Re-check under the lock: a concurrent replica may have just installed it.
    if (await detectKnowledgeVectorSupport(tx)) {
      return { outcome: "already-present" };
    }

    try {
      // Nested transaction = savepoint, so an install failure (e.g. the role
      // lacks the privilege) leaves the outer transaction usable.
      await tx.transaction((inner) => inner.query("create extension if not exists vector"));
    } catch (error) {
      return {
        outcome: "extension-install-failed",
        reason: error instanceof Error ? error.message : String(error)
      };
    }

    await tx.query("alter table knowledge_chunks add column if not exists embedding vector");
    const enqueued = await enqueueAllPublishedEntriesAcrossOrganizations(tx);
    return { outcome: "installed", enqueued };
  });

  if (result.outcome === "installed") {
    // Drop any pre-install detection this process cached so the indexing
    // worker and search path see the column without a restart.
    invalidateKnowledgeVectorSupportCache(db);
  }
  return result;
}
