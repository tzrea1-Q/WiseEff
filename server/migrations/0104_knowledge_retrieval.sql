-- Knowledge retrieval (Phase 2): chunk projection of published revisions with
-- FTS/trigram state, optional pgvector embeddings, and per-entry index status
-- for the async indexing worker (ADR-0025).

-- pgvector is optional. Install it only when the server offers it; when it is
-- absent (or installation fails) the knowledge base stays fully usable in
-- FTS-only mode and this migration must still succeed.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'vector') then
    begin
      create extension if not exists vector;
    exception when others then
      raise notice 'pgvector is available but could not be installed (%); knowledge retrieval stays FTS-only.', sqlerrm;
    end;
  else
    raise notice 'pgvector is not available on this server; knowledge retrieval stays FTS-only.';
  end if;
end
$$;

-- Derived retrieval projection of a published revision. Never authored, always
-- rebuildable from knowledge_revisions (D13: published entries only).
create table if not exists knowledge_chunks (
  id uuid primary key,
  organization_id text not null references organizations(id),
  entry_id uuid not null references knowledge_entries(id) on delete cascade,
  revision_id uuid not null references knowledge_revisions(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  text text not null,
  created_at timestamptz not null default now(),
  unique (entry_id, chunk_index)
);

create index if not exists knowledge_chunks_org_entry_idx
  on knowledge_chunks (organization_id, entry_id, chunk_index);

create index if not exists knowledge_chunks_fts_idx
  on knowledge_chunks using gin (to_tsvector('english', text));

create index if not exists knowledge_chunks_trgm_idx
  on knowledge_chunks using gin (text gin_trgm_ops);

-- The embedding column exists only when pgvector is installed; FTS-only
-- deployments simply never get it. Untyped vector keeps the schema
-- embedding-model-agnostic; the MVP searches with exact scans (no ANN index).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    execute 'alter table knowledge_chunks add column if not exists embedding vector';
  end if;
end
$$;

-- Per-entry index status doubles as the polling worker queue: enqueue upserts
-- the row to pending; the worker claims with FOR UPDATE SKIP LOCKED.
create table if not exists knowledge_index_status (
  entry_id uuid primary key references knowledge_entries(id) on delete cascade,
  organization_id text not null references organizations(id),
  status text not null default 'pending' check (status in ('pending', 'processing', 'succeeded', 'failed')),
  error text,
  indexed_revision_id uuid references knowledge_revisions(id) on delete set null,
  indexed_revision_number integer,
  chunk_count integer not null default 0,
  embedded_chunk_count integer not null default 0,
  embedding_model text,
  enqueued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_index_status_org_status_idx
  on knowledge_index_status (organization_id, status, enqueued_at);

-- Entries published before this migration join the queue so the first worker
-- pass builds their chunks without a manual rebuild.
insert into knowledge_index_status (entry_id, organization_id, status)
select id, organization_id, 'pending'
from knowledge_entries
where status = 'published'
on conflict (entry_id) do nothing;
