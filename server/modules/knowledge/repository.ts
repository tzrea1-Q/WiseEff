import type { AuthContext } from "../auth/types";
import type { Queryable } from "../../shared/database/client";
import { loadParameterReferencesByEntryIds } from "./parameterReferences";
import type {
  InsertKnowledgeEntryInput,
  InsertKnowledgeFileInput,
  InsertKnowledgeRevisionInput,
  KnowledgeEntryDto,
  KnowledgeExtractionStatus,
  KnowledgeFileDto,
  KnowledgeParameterReferenceDto,
  KnowledgeRevisionDto,
  KnowledgeSearchResultDto,
  ListKnowledgeEntriesQuery
} from "./types";

type KnowledgeEntryRow = {
  id: string;
  organization_id: string;
  title: string;
  content_form: KnowledgeEntryDto["contentForm"];
  status: KnowledgeEntryDto["status"];
  tags: string[];
  source_type: KnowledgeEntryDto["sourceType"];
  source_session_id: string | null;
  source_log_id: string | null;
  created_by_user_id: string;
  head_revision_id: string | null;
  head_revision_number: number | string;
  created_at: string | Date;
  updated_at: string | Date;
  published_at: string | Date | null;
  archived_at: string | Date | null;
};

type KnowledgeRevisionRow = {
  id: string;
  entry_id: string;
  organization_id: string;
  revision_number: number | string;
  title: string;
  tags: string[];
  content_markdown: string | null;
  file_id: string | null;
  author_user_id: string;
  restored_from_revision_id: string | null;
  created_at: string | Date;
};

type KnowledgeFileRow = {
  id: string;
  entry_id: string;
  organization_id: string;
  storage_key: string;
  file_name: string;
  content_type: string;
  size_bytes: number | string;
  checksum: string;
  extraction_status: KnowledgeExtractionStatus;
  extracted_text: string | null;
  extraction_error: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type KnowledgeSearchRow = {
  id: string;
  title: string;
  content_form: KnowledgeEntryDto["contentForm"];
  tags: string[];
  search_text: string;
  head_revision_id: string | null;
  updated_at: string | Date;
};

type KnowledgeChunkSearchRow = {
  entry_id: string;
  title: string;
  content_form: KnowledgeEntryDto["contentForm"];
  tags: string[];
  revision_id: string;
  text: string;
  updated_at: string | Date;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function nullableDateTimeToIso(value: string | Date | null) {
  return value === null ? null : dateTimeToIso(value);
}

function toFileDto(row: KnowledgeFileRow): KnowledgeFileDto {
  return {
    id: row.id,
    entryId: row.entry_id,
    organizationId: row.organization_id,
    storageKey: row.storage_key,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    checksum: row.checksum,
    extractionStatus: row.extraction_status,
    extractionError: row.extraction_error,
    createdAt: dateTimeToIso(row.created_at),
    updatedAt: dateTimeToIso(row.updated_at)
  };
}

function toRevisionDto(row: KnowledgeRevisionRow): KnowledgeRevisionDto {
  return {
    id: row.id,
    entryId: row.entry_id,
    organizationId: row.organization_id,
    revisionNumber: Number(row.revision_number),
    title: row.title,
    tags: row.tags ?? [],
    contentMarkdown: row.content_markdown,
    fileId: row.file_id,
    authorUserId: row.author_user_id,
    restoredFromRevisionId: row.restored_from_revision_id,
    createdAt: dateTimeToIso(row.created_at)
  };
}

function toEntryDto(
  row: KnowledgeEntryRow,
  extras: {
    contentMarkdown: string | null;
    file: KnowledgeFileDto | null;
    parameterReferences: KnowledgeParameterReferenceDto[];
  }
): KnowledgeEntryDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    contentForm: row.content_form,
    status: row.status,
    tags: row.tags ?? [],
    sourceType: row.source_type,
    sourceSessionId: row.source_session_id,
    sourceLogId: row.source_log_id,
    createdByUserId: row.created_by_user_id,
    headRevisionId: row.head_revision_id,
    headRevisionNumber: Number(row.head_revision_number),
    createdAt: dateTimeToIso(row.created_at),
    updatedAt: dateTimeToIso(row.updated_at),
    publishedAt: nullableDateTimeToIso(row.published_at),
    archivedAt: nullableDateTimeToIso(row.archived_at),
    contentMarkdown: extras.contentMarkdown,
    file: extras.file,
    parameterReferences: extras.parameterReferences
  };
}

async function loadEntryExtras(db: Queryable, auth: AuthContext, rows: KnowledgeEntryRow[]) {
  const markdownByRevisionId = new Map<string, string | null>();
  const fileByRevisionId = new Map<string, KnowledgeFileDto>();
  const headRevisionIds = rows
    .map((row) => row.head_revision_id)
    .filter((id): id is string => id !== null);

  if (headRevisionIds.length > 0) {
    const revisionResult = await db.query<KnowledgeRevisionRow & { file_row: KnowledgeFileRow | null }>(
      `
      select r.*, row_to_json(f.*) as file_row
      from knowledge_revisions r
      left join knowledge_files f on f.id = r.file_id and f.organization_id = r.organization_id
      where r.organization_id = $1
        and r.id = any($2::uuid[])
      `,
      [auth.organization.id, headRevisionIds]
    );
    for (const row of revisionResult.rows) {
      markdownByRevisionId.set(row.id, row.content_markdown);
      if (row.file_row) {
        fileByRevisionId.set(row.id, toFileDto(row.file_row));
      }
    }
  }

  const referencesByEntryId = await loadParameterReferencesByEntryIds(
    db,
    auth,
    rows.map((row) => row.id)
  );

  return rows.map((row) =>
    toEntryDto(row, {
      contentMarkdown: row.head_revision_id ? markdownByRevisionId.get(row.head_revision_id) ?? null : null,
      file: row.head_revision_id ? fileByRevisionId.get(row.head_revision_id) ?? null : null,
      parameterReferences: referencesByEntryId.get(row.id) ?? []
    })
  );
}

export async function insertEntry(db: Queryable, auth: AuthContext, input: InsertKnowledgeEntryInput): Promise<void> {
  await db.query(
    `
    insert into knowledge_entries (
      id, organization_id, title, content_form, tags, source_type, source_session_id, source_log_id, created_by_user_id, search_text
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      input.id,
      auth.organization.id,
      input.title,
      input.contentForm,
      input.tags,
      input.sourceType,
      input.sourceSessionId,
      input.sourceLogId,
      auth.user.id,
      input.searchText
    ]
  );
}

export async function insertRevision(
  db: Queryable,
  auth: AuthContext,
  input: InsertKnowledgeRevisionInput
): Promise<KnowledgeRevisionDto> {
  const result = await db.query<KnowledgeRevisionRow>(
    `
    insert into knowledge_revisions (
      id, entry_id, organization_id, revision_number, title, tags, content_markdown, file_id, author_user_id, restored_from_revision_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    returning *
    `,
    [
      input.id,
      input.entryId,
      auth.organization.id,
      input.revisionNumber,
      input.title,
      input.tags,
      input.contentMarkdown,
      input.fileId,
      auth.user.id,
      input.restoredFromRevisionId
    ]
  );

  return toRevisionDto(result.rows[0]);
}

export async function insertFile(db: Queryable, auth: AuthContext, input: InsertKnowledgeFileInput): Promise<KnowledgeFileDto> {
  const result = await db.query<KnowledgeFileRow>(
    `
    insert into knowledge_files (
      id, entry_id, organization_id, storage_key, file_name, content_type, size_bytes, checksum
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8)
    returning *
    `,
    [
      input.id,
      input.entryId,
      auth.organization.id,
      input.storageKey,
      input.fileName,
      input.contentType,
      input.sizeBytes,
      input.checksum
    ]
  );

  return toFileDto(result.rows[0]);
}

export async function setEntryHead(
  db: Queryable,
  auth: AuthContext,
  input: {
    entryId: string;
    headRevisionId: string;
    headRevisionNumber: number;
    title: string;
    tags: string[];
    searchText: string;
  }
): Promise<void> {
  await db.query(
    `
    update knowledge_entries
    set head_revision_id = $3,
        head_revision_number = $4,
        title = $5,
        tags = $6,
        search_text = $7,
        updated_at = now()
    where organization_id = $1
      and id = $2
    `,
    [auth.organization.id, input.entryId, input.headRevisionId, input.headRevisionNumber, input.title, input.tags, input.searchText]
  );
}

export async function setEntrySearchText(
  db: Queryable,
  auth: AuthContext,
  input: { entryId: string; searchText: string }
): Promise<void> {
  await db.query(
    `
    update knowledge_entries
    set search_text = $3
    where organization_id = $1
      and id = $2
    `,
    [auth.organization.id, input.entryId, input.searchText]
  );
}

export async function setEntryStatus(
  db: Queryable,
  auth: AuthContext,
  input: { entryId: string; status: KnowledgeEntryDto["status"] }
): Promise<void> {
  await db.query(
    `
    update knowledge_entries
    set status = $3,
        published_at = case when $3 = 'published' then now() else published_at end,
        archived_at = case when $3 = 'archived' then now() else null end,
        updated_at = now()
    where organization_id = $1
      and id = $2
    `,
    [auth.organization.id, input.entryId, input.status]
  );
}

export async function updateFileExtraction(
  db: Queryable,
  auth: AuthContext,
  input: {
    fileId: string;
    extractionStatus: KnowledgeExtractionStatus;
    extractedText: string | null;
    extractionError: string | null;
  }
): Promise<void> {
  await db.query(
    `
    update knowledge_files
    set extraction_status = $3,
        extracted_text = $4,
        extraction_error = $5,
        updated_at = now()
    where organization_id = $1
      and id = $2
    `,
    [auth.organization.id, input.fileId, input.extractionStatus, input.extractedText, input.extractionError]
  );
}

export async function getEntryById(db: Queryable, auth: AuthContext, entryId: string): Promise<KnowledgeEntryDto | null> {
  const result = await db.query<KnowledgeEntryRow>(
    `
    select *
    from knowledge_entries
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [auth.organization.id, entryId]
  );
  const row = result.rows[0];
  if (!row) return null;

  const [entry] = await loadEntryExtras(db, auth, [row]);
  return entry;
}

/**
 * Locks the entry row for the duration of the surrounding transaction so
 * concurrent saves serialize and the optimistic-concurrency check is exact.
 */
export async function getEntryForUpdate(db: Queryable, auth: AuthContext, entryId: string): Promise<KnowledgeEntryDto | null> {
  const result = await db.query<KnowledgeEntryRow>(
    `
    select *
    from knowledge_entries
    where organization_id = $1
      and id = $2
    for update
    `,
    [auth.organization.id, entryId]
  );
  const row = result.rows[0];
  if (!row) return null;

  const [entry] = await loadEntryExtras(db, auth, [row]);
  return entry;
}

export async function listEntries(
  db: Queryable,
  auth: AuthContext,
  query: ListKnowledgeEntriesQuery & { visibleDraftOwnerUserId?: string | null }
): Promise<KnowledgeEntryDto[]> {
  const values: unknown[] = [auth.organization.id];
  const where = ["organization_id = $1"];

  if (query.status) {
    values.push(query.status);
    where.push(`status = $${values.length}`);
  }
  if (query.visibleDraftOwnerUserId !== undefined) {
    if (query.visibleDraftOwnerUserId === null) {
      where.push(`status <> 'draft'`);
    } else {
      values.push(query.visibleDraftOwnerUserId);
      where.push(`(status <> 'draft' or created_by_user_id = $${values.length})`);
    }
  }
  if (query.contentForm) {
    values.push(query.contentForm);
    where.push(`content_form = $${values.length}`);
  }
  if (query.sourceType) {
    values.push(query.sourceType);
    where.push(`source_type = $${values.length}`);
  }
  if (query.tag) {
    values.push(query.tag);
    where.push(`tags @> array[$${values.length}]::text[]`);
  }
  const q = query.q?.trim();
  if (q) {
    values.push(`%${q}%`);
    where.push(`title ilike $${values.length}`);
  }

  values.push(query.limit ?? 100);
  const result = await db.query<KnowledgeEntryRow>(
    `
    select *
    from knowledge_entries
    where ${where.join("\n      and ")}
    order by updated_at desc, id desc
    limit $${values.length}
    `,
    values
  );

  return loadEntryExtras(db, auth, result.rows);
}

export async function listRevisions(db: Queryable, auth: AuthContext, entryId: string): Promise<KnowledgeRevisionDto[]> {
  const result = await db.query<KnowledgeRevisionRow>(
    `
    select *
    from knowledge_revisions
    where organization_id = $1
      and entry_id = $2
    order by revision_number desc
    `,
    [auth.organization.id, entryId]
  );

  return result.rows.map(toRevisionDto);
}

export async function getRevisionById(
  db: Queryable,
  auth: AuthContext,
  entryId: string,
  revisionId: string
): Promise<KnowledgeRevisionDto | null> {
  const result = await db.query<KnowledgeRevisionRow>(
    `
    select *
    from knowledge_revisions
    where organization_id = $1
      and entry_id = $2
      and id = $3
    limit 1
    `,
    [auth.organization.id, entryId, revisionId]
  );
  const row = result.rows[0];
  return row ? toRevisionDto(row) : null;
}

export async function getFileById(db: Queryable, auth: AuthContext, fileId: string): Promise<KnowledgeFileDto | null> {
  const result = await db.query<KnowledgeFileRow>(
    `
    select *
    from knowledge_files
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [auth.organization.id, fileId]
  );
  const row = result.rows[0];
  return row ? toFileDto(row) : null;
}

export async function deleteEntry(db: Queryable, auth: AuthContext, entryId: string): Promise<boolean> {
  // Break the head-revision reference first so the revision cascade can proceed.
  await db.query(
    `
    update knowledge_entries
    set head_revision_id = null
    where organization_id = $1
      and id = $2
    `,
    [auth.organization.id, entryId]
  );
  const result = await db.query(
    `
    delete from knowledge_entries
    where organization_id = $1
      and id = $2
    `,
    [auth.organization.id, entryId]
  );

  return (result.rowCount ?? 0) > 0;
}

function buildExcerpt(searchText: string, query: string) {
  const normalized = searchText.replace(/\s+/g, " ").trim();
  const lower = normalized.toLocaleLowerCase();
  const index = lower.indexOf(query.toLocaleLowerCase());
  if (index < 0) {
    return normalized.slice(0, 160);
  }
  const start = Math.max(0, index - 60);
  const end = Math.min(normalized.length, index + query.length + 100);
  return `${start > 0 ? "…" : ""}${normalized.slice(start, end)}${end < normalized.length ? "…" : ""}`;
}

/**
 * Published-only retrieval (D13): PostgreSQL FTS ranks latin text; the trigram
 * ILIKE branch matches CJK substrings that default FTS cannot segment.
 */
export async function searchPublishedEntries(
  db: Queryable,
  auth: AuthContext,
  query: { q: string; limit?: number }
): Promise<KnowledgeSearchResultDto[]> {
  const trimmed = query.q.trim();
  const result = await db.query<KnowledgeSearchRow>(
    `
    select id, title, content_form, tags, search_text, head_revision_id, updated_at
    from knowledge_entries
    where organization_id = $1
      and status = 'published'
      and (
        to_tsvector('english', search_text) @@ plainto_tsquery('english', $2)
        or search_text ilike $3
      )
    order by
      ts_rank(to_tsvector('english', search_text), plainto_tsquery('english', $2)) desc,
      similarity(search_text, $2) desc,
      updated_at desc
    limit $4
    `,
    [auth.organization.id, trimmed, `%${trimmed}%`, query.limit ?? 20]
  );

  return result.rows.map((row) => ({
    entryId: row.id,
    title: row.title,
    contentForm: row.content_form,
    tags: row.tags ?? [],
    excerpt: buildExcerpt(row.search_text, trimmed),
    updatedAt: dateTimeToIso(row.updated_at),
    revisionId: row.head_revision_id
  }));
}

function buildChunkExcerpt(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 200 ? `${normalized.slice(0, 200)}…` : normalized;
}

/**
 * Published-only trigram-similarity ranking for the related-knowledge
 * recommendation: `word_similarity` scores how well the derived
 * conclusion/impact query matches the best contiguous extent of each entry's
 * search text (CJK works through trigrams, latin text too), and rows below the
 * cutoff are dropped so unrelated entries are never padded in.
 */
export async function searchPublishedEntriesByTextSimilarity(
  db: Queryable,
  auth: AuthContext,
  query: { q: string; minSimilarity: number; limit: number }
): Promise<KnowledgeSearchResultDto[]> {
  const result = await db.query<KnowledgeSearchRow>(
    `
    select id, title, content_form, tags, search_text, head_revision_id, updated_at
    from knowledge_entries
    where organization_id = $1
      and status = 'published'
      and word_similarity($2, search_text) >= $3
    order by
      word_similarity($2, search_text) desc,
      updated_at desc
    limit $4
    `,
    [auth.organization.id, query.q, query.minSimilarity, query.limit]
  );

  return result.rows.map((row) => ({
    entryId: row.id,
    title: row.title,
    contentForm: row.content_form,
    tags: row.tags ?? [],
    excerpt: buildExcerpt(row.search_text, query.q),
    updatedAt: dateTimeToIso(row.updated_at),
    revisionId: row.head_revision_id
  }));
}

/**
 * Semantic branch of hybrid retrieval: exact cosine scan over published chunk
 * embeddings, deduplicated to the best chunk per entry. Callers must confirm
 * pgvector support first — the `::vector` cast does not parse without it.
 * `maxDistance` is the relevance cutoff used by the related-knowledge
 * recommendation; absent means no cutoff (the plain search endpoint).
 */
export async function searchPublishedChunksByEmbedding(
  db: Queryable,
  auth: AuthContext,
  query: { embedding: number[]; limit?: number; maxDistance?: number }
): Promise<KnowledgeSearchResultDto[]> {
  const values: unknown[] = [auth.organization.id, `[${query.embedding.join(",")}]`];
  let distanceCutoff = "";
  if (query.maxDistance !== undefined) {
    values.push(query.maxDistance);
    distanceCutoff = `and c.embedding <=> $2::vector <= $${values.length}`;
  }
  values.push(query.limit ?? 20);

  const result = await db.query<KnowledgeChunkSearchRow>(
    `
    select best.*
    from (
      select distinct on (c.entry_id)
        c.entry_id, e.title, e.content_form, e.tags, c.revision_id, c.text, e.updated_at,
        c.embedding <=> $2::vector as distance
      from knowledge_chunks c
      join knowledge_entries e
        on e.id = c.entry_id
       and e.organization_id = c.organization_id
      where c.organization_id = $1
        and e.status = 'published'
        and c.embedding is not null
        ${distanceCutoff}
      order by c.entry_id, c.embedding <=> $2::vector asc
    ) best
    order by best.distance asc
    limit $${values.length}
    `,
    values
  );

  return result.rows.map((row) => ({
    entryId: row.entry_id,
    title: row.title,
    contentForm: row.content_form,
    tags: row.tags ?? [],
    excerpt: buildChunkExcerpt(row.text),
    updatedAt: dateTimeToIso(row.updated_at),
    revisionId: row.revision_id
  }));
}
