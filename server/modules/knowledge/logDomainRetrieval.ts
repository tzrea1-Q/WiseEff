import type { Queryable } from "../../shared/database/client";
import { fuseKnowledgeSearchResults } from "./hybridSearch";
import type { KnowledgeEmbeddingClient } from "./indexing/embeddingClient";
import { hasKnowledgeVectorSupport, toVectorLiteral } from "./indexing/repository";
import type { KnowledgeRetrievalMode, KnowledgeSearchResultDto } from "./types";

/**
 * Worker-facing retrieval seam for the log analysis agent's `read_domain_knowledge`
 * tool. The log worker runs without a user AuthContext, so organization isolation is
 * enforced right here in the SQL — and the published-only invariant (design D13) is
 * hardcoded in every branch: linking an entry to a log domain never widens retrieval
 * beyond `published`, and entries archived after linking drop out automatically.
 *
 * Scope semantics mirror the uncategorized-log-domain fallback: when the domain has
 * linked entries, retrieval is restricted to that set (`domain-linked`); with no links
 * (or no domain) it degrades to organization-wide generic retrieval and says so.
 */
export type LogDomainKnowledgeScope = "domain-linked" | "organization-generic";

export type LogDomainKnowledgeSearchResult = {
  scope: LogDomainKnowledgeScope;
  retrievalMode: KnowledgeRetrievalMode;
  items: KnowledgeSearchResultDto[];
};

type EntrySearchRow = {
  id: string;
  title: string;
  content_form: KnowledgeSearchResultDto["contentForm"];
  tags: string[];
  search_text: string;
  head_revision_id: string | null;
  updated_at: string | Date;
};

type ChunkSearchRow = {
  entry_id: string;
  title: string;
  content_form: KnowledgeSearchResultDto["contentForm"];
  tags: string[];
  revision_id: string;
  text: string;
  updated_at: string | Date;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function buildExcerpt(searchText: string, query: string) {
  const normalized = searchText.replace(/\s+/g, " ").trim();
  const lower = normalized.toLocaleLowerCase();
  const index = lower.indexOf(query.toLocaleLowerCase());
  if (index < 0) {
    return normalized.slice(0, 200);
  }
  const start = Math.max(0, index - 60);
  const end = Math.min(normalized.length, index + query.length + 120);
  return `${start > 0 ? "…" : ""}${normalized.slice(start, end)}${end < normalized.length ? "…" : ""}`;
}

function buildChunkExcerpt(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 200 ? `${normalized.slice(0, 200)}…` : normalized;
}

async function searchEntriesFts(
  db: Queryable,
  input: { organizationId: string; query: string; restrictToEntryIds?: string[]; limit: number }
): Promise<KnowledgeSearchResultDto[]> {
  const values: unknown[] = [input.organizationId, input.query, `%${input.query}%`];
  let restriction = "";
  if (input.restrictToEntryIds) {
    values.push(input.restrictToEntryIds);
    restriction = `and e.id = any($${values.length}::uuid[])`;
  }
  values.push(input.limit);

  const result = await db.query<EntrySearchRow>(
    `
    select e.id, e.title, e.content_form, e.tags, e.search_text, e.head_revision_id, e.updated_at
    from knowledge_entries e
    where e.organization_id = $1
      and e.status = 'published'
      ${restriction}
      and (
        to_tsvector('english', e.search_text) @@ plainto_tsquery('english', $2)
        or e.search_text ilike $3
      )
    order by
      ts_rank(to_tsvector('english', e.search_text), plainto_tsquery('english', $2)) desc,
      similarity(e.search_text, $2) desc,
      e.updated_at desc
    limit $${values.length}
    `,
    values
  );

  return result.rows.map((row) => ({
    entryId: row.id,
    title: row.title,
    contentForm: row.content_form,
    tags: row.tags ?? [],
    excerpt: buildExcerpt(row.search_text, input.query),
    updatedAt: dateTimeToIso(row.updated_at),
    revisionId: row.head_revision_id
  }));
}

async function searchChunksByEmbedding(
  db: Queryable,
  input: { organizationId: string; embedding: number[]; restrictToEntryIds?: string[]; limit: number }
): Promise<KnowledgeSearchResultDto[]> {
  const values: unknown[] = [input.organizationId, toVectorLiteral(input.embedding)];
  let restriction = "";
  if (input.restrictToEntryIds) {
    values.push(input.restrictToEntryIds);
    restriction = `and c.entry_id = any($${values.length}::uuid[])`;
  }
  values.push(input.limit);

  const result = await db.query<ChunkSearchRow>(
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
        ${restriction}
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

export async function searchPublishedKnowledgeForLogAnalysis(
  db: Queryable,
  input: {
    organizationId: string;
    query: string;
    /** Linked entry ids for the bound log domain; empty/absent = organization-generic fallback. */
    linkedEntryIds?: string[];
    limit?: number;
    embeddingClient?: KnowledgeEmbeddingClient;
  }
): Promise<LogDomainKnowledgeSearchResult> {
  const limit = input.limit ?? 5;
  const query = input.query.trim();
  const scoped = (input.linkedEntryIds?.length ?? 0) > 0;
  const scope: LogDomainKnowledgeScope = scoped ? "domain-linked" : "organization-generic";
  const restrictToEntryIds = scoped ? input.linkedEntryIds : undefined;

  const ftsItems = await searchEntriesFts(db, {
    organizationId: input.organizationId,
    query,
    restrictToEntryIds,
    limit
  });

  const vectorAvailable = await hasKnowledgeVectorSupport(db).catch(() => false);
  if (!vectorAvailable || !input.embeddingClient) {
    return { scope, retrievalMode: "fts_only", items: ftsItems };
  }

  try {
    const [queryEmbedding] = await input.embeddingClient.embed([query]);
    const vectorItems = await searchChunksByEmbedding(db, {
      organizationId: input.organizationId,
      embedding: queryEmbedding,
      restrictToEntryIds,
      limit
    });
    return {
      scope,
      retrievalMode: "semantic_fts",
      items: fuseKnowledgeSearchResults({ fts: ftsItems, vector: vectorItems, limit })
    };
  } catch {
    // Per-query degradation stays honest: the FTS results are still valid.
    return { scope, retrievalMode: "fts_only", items: ftsItems };
  }
}
