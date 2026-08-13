import type { Queryable } from "../../../shared/database/client";

export const knowledgeIndexStates = ["pending", "processing", "succeeded", "failed"] as const;
export type KnowledgeIndexState = (typeof knowledgeIndexStates)[number];

export type KnowledgeIndexStatusRow = {
  entry_id: string;
  organization_id: string;
  status: KnowledgeIndexState;
  error: string | null;
  indexed_revision_id: string | null;
  indexed_revision_number: number | string | null;
  chunk_count: number | string;
  embedded_chunk_count: number | string;
  embedding_model: string | null;
  enqueued_at: string | Date;
  updated_at: string | Date;
};

export type KnowledgeIndexStatusDto = {
  entryId: string;
  organizationId: string;
  status: KnowledgeIndexState;
  error: string | null;
  indexedRevisionId: string | null;
  indexedRevisionNumber: number | null;
  chunkCount: number;
  embeddedChunkCount: number;
  embeddingModel: string | null;
  enqueuedAt: string;
  updatedAt: string;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

export function toIndexStatusDto(row: KnowledgeIndexStatusRow): KnowledgeIndexStatusDto {
  return {
    entryId: row.entry_id,
    organizationId: row.organization_id,
    status: row.status,
    error: row.error,
    indexedRevisionId: row.indexed_revision_id,
    indexedRevisionNumber: row.indexed_revision_number === null ? null : Number(row.indexed_revision_number),
    chunkCount: Number(row.chunk_count),
    embeddedChunkCount: Number(row.embedded_chunk_count),
    embeddingModel: row.embedding_model,
    enqueuedAt: dateTimeToIso(row.enqueued_at),
    updatedAt: dateTimeToIso(row.updated_at)
  };
}

/**
 * Detects whether this database can store and search pgvector embeddings:
 * migration 0104 only adds the `embedding` column when the extension exists.
 * The result is stable for a database's lifetime, so callers may cache it.
 */
export async function detectKnowledgeVectorSupport(db: Queryable): Promise<boolean> {
  const result = await db.query(
    `
    select 1
    from information_schema.columns
    where table_name = 'knowledge_chunks'
      and column_name = 'embedding'
    limit 1
    `
  );
  return result.rows.length > 0;
}

const vectorSupportCache = new WeakMap<object, Promise<boolean>>();

export function hasKnowledgeVectorSupport(db: Queryable): Promise<boolean> {
  const cached = vectorSupportCache.get(db);
  if (cached) {
    return cached;
  }
  const detection = detectKnowledgeVectorSupport(db).catch((error) => {
    vectorSupportCache.delete(db);
    throw error;
  });
  vectorSupportCache.set(db, detection);
  return detection;
}

/**
 * Detection is stable for a database's lifetime with one exception: the
 * late-install ensure (vectorEnsure.ts) adds the embedding column at runtime
 * and must drop this process's cached detection afterwards.
 */
export function invalidateKnowledgeVectorSupportCache(db: Queryable): void {
  vectorSupportCache.delete(db);
}

/** Formats a JS vector as a pgvector literal (`[1,2,3]`) for `::vector` casts. */
export function toVectorLiteral(embedding: number[]) {
  return `[${embedding.join(",")}]`;
}

/**
 * Enqueue is idempotent: the status row doubles as the queue, so re-enqueueing
 * a processing/failed entry simply resets it to pending.
 */
export async function enqueueEntryIndexRefresh(
  db: Queryable,
  input: { entryId: string; organizationId: string }
): Promise<void> {
  await db.query(
    `
    insert into knowledge_index_status (entry_id, organization_id, status, error, enqueued_at, updated_at)
    values ($1, $2, 'pending', null, now(), now())
    on conflict (entry_id) do update
      set status = 'pending', error = null, enqueued_at = now(), updated_at = now()
    `,
    [input.entryId, input.organizationId]
  );
}

export async function enqueueAllPublishedEntries(db: Queryable, organizationId: string): Promise<number> {
  const result = await db.query(
    `
    insert into knowledge_index_status (entry_id, organization_id, status, error, enqueued_at, updated_at)
    select id, organization_id, 'pending', null, now(), now()
    from knowledge_entries
    where organization_id = $1
      and status = 'published'
    on conflict (entry_id) do update
      set status = 'pending', error = null, enqueued_at = now(), updated_at = now()
    `,
    [organizationId]
  );
  return result.rowCount ?? 0;
}

/**
 * System-actor variant of the rebuild enqueue for the late-install ensure:
 * newly gained vector support applies to every organization's published
 * entries, not just one admin's org.
 */
export async function enqueueAllPublishedEntriesAcrossOrganizations(db: Queryable): Promise<number> {
  const result = await db.query(
    `
    insert into knowledge_index_status (entry_id, organization_id, status, error, enqueued_at, updated_at)
    select id, organization_id, 'pending', null, now(), now()
    from knowledge_entries
    where status = 'published'
    on conflict (entry_id) do update
      set status = 'pending', error = null, enqueued_at = now(), updated_at = now()
    `
  );
  return result.rowCount ?? 0;
}

const STALE_PROCESSING_INTERVAL = "5 minutes";

/**
 * Claims the next queued entry with FOR UPDATE SKIP LOCKED so concurrent
 * workers never double-process; processing rows older than the stale interval
 * are reclaimed (crashed worker recovery).
 */
export async function claimNextIndexJob(
  db: Queryable
): Promise<{ entryId: string; organizationId: string } | null> {
  const result = await db.query<{ entry_id: string; organization_id: string }>(
    `
    update knowledge_index_status
    set status = 'processing', started_at = now(), updated_at = now()
    where entry_id = (
      select entry_id
      from knowledge_index_status
      where status = 'pending'
         or (status = 'processing' and started_at < now() - interval '${STALE_PROCESSING_INTERVAL}')
      order by enqueued_at asc
      limit 1
      for update skip locked
    )
    returning entry_id, organization_id
    `
  );
  const row = result.rows[0];
  return row ? { entryId: row.entry_id, organizationId: row.organization_id } : null;
}

export async function markIndexOutcome(
  db: Queryable,
  input: {
    entryId: string;
    organizationId: string;
    status: "succeeded" | "failed";
    error?: string | null;
    indexedRevisionId?: string | null;
    indexedRevisionNumber?: number | null;
    chunkCount?: number;
    embeddedChunkCount?: number;
    embeddingModel?: string | null;
  }
): Promise<void> {
  await db.query(
    `
    update knowledge_index_status
    set status = $3,
        error = $4,
        indexed_revision_id = $5,
        indexed_revision_number = $6,
        chunk_count = $7,
        embedded_chunk_count = $8,
        embedding_model = $9,
        finished_at = now(),
        updated_at = now()
    where entry_id = $1
      and organization_id = $2
    `,
    [
      input.entryId,
      input.organizationId,
      input.status,
      input.error ?? null,
      input.indexedRevisionId ?? null,
      input.indexedRevisionNumber ?? null,
      input.chunkCount ?? 0,
      input.embeddedChunkCount ?? 0,
      input.embeddingModel ?? null
    ]
  );
}

export async function deleteChunksForEntry(
  db: Queryable,
  input: { entryId: string; organizationId: string }
): Promise<void> {
  await db.query(
    `
    delete from knowledge_chunks
    where organization_id = $1
      and entry_id = $2
    `,
    [input.organizationId, input.entryId]
  );
}

export async function insertChunks(
  db: Queryable,
  input: {
    entryId: string;
    organizationId: string;
    revisionId: string;
    chunks: Array<{ id: string; chunkIndex: number; text: string; embedding: number[] | null }>;
    vectorSupport: boolean;
  }
): Promise<void> {
  for (const chunk of input.chunks) {
    if (input.vectorSupport) {
      await db.query(
        `
        insert into knowledge_chunks (id, organization_id, entry_id, revision_id, chunk_index, text, embedding)
        values ($1, $2, $3, $4, $5, $6, $7::vector)
        `,
        [
          chunk.id,
          input.organizationId,
          input.entryId,
          input.revisionId,
          chunk.chunkIndex,
          chunk.text,
          chunk.embedding ? toVectorLiteral(chunk.embedding) : null
        ]
      );
    } else {
      await db.query(
        `
        insert into knowledge_chunks (id, organization_id, entry_id, revision_id, chunk_index, text)
        values ($1, $2, $3, $4, $5, $6)
        `,
        [chunk.id, input.organizationId, input.entryId, input.revisionId, chunk.chunkIndex, chunk.text]
      );
    }
  }
}

export async function listIndexStatuses(
  db: Queryable,
  organizationId: string,
  options: { limit?: number } = {}
): Promise<Array<KnowledgeIndexStatusDto & { title: string; entryStatus: string }>> {
  const result = await db.query<KnowledgeIndexStatusRow & { title: string; entry_status: string }>(
    `
    select s.*, e.title, e.status as entry_status
    from knowledge_index_status s
    join knowledge_entries e on e.id = s.entry_id and e.organization_id = s.organization_id
    where s.organization_id = $1
    order by s.updated_at desc
    limit $2
    `,
    [organizationId, options.limit ?? 200]
  );
  return result.rows.map((row) => ({
    ...toIndexStatusDto(row),
    title: row.title,
    entryStatus: row.entry_status
  }));
}

export async function getIndexStatusForEntry(
  db: Queryable,
  input: { entryId: string; organizationId: string }
): Promise<KnowledgeIndexStatusDto | null> {
  const result = await db.query<KnowledgeIndexStatusRow>(
    `
    select *
    from knowledge_index_status
    where organization_id = $1
      and entry_id = $2
    limit 1
    `,
    [input.organizationId, input.entryId]
  );
  const row = result.rows[0];
  return row ? toIndexStatusDto(row) : null;
}
