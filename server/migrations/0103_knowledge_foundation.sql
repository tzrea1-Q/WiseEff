-- Knowledge base foundation (Phase 1): organization-scoped knowledge entries with
-- immutable revisions, file metadata with extraction status, published-only search
-- support (FTS + trigram), and the knowledge:* permission seeds.

-- Trigram matching backs CJK substring search; PostgreSQL default FTS covers latin text.
create extension if not exists pg_trgm;

create table if not exists knowledge_entries (
  id uuid primary key,
  organization_id text not null references organizations(id),
  title text not null,
  content_form text not null check (content_form in ('markdown', 'file')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  tags text[] not null default '{}',
  -- Source attribution: agents never write in Phase 1, but the schema already states it.
  source_type text not null default 'human' check (source_type in ('human', 'agent')),
  source_session_id text,
  created_by_user_id text not null references users(id),
  -- Optimistic concurrency: saves carry the expected head revision number.
  head_revision_id uuid,
  head_revision_number integer not null default 0,
  -- Denormalized published-only retrieval text (title + head content), maintained
  -- transactionally by the knowledge service. Phase 2 replaces it with chunk rows.
  search_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  archived_at timestamptz
);

create index if not exists knowledge_entries_org_updated_idx
  on knowledge_entries (organization_id, updated_at desc, id desc);

create index if not exists knowledge_entries_org_status_idx
  on knowledge_entries (organization_id, status, updated_at desc);

create index if not exists knowledge_entries_search_fts_idx
  on knowledge_entries using gin (to_tsvector('english', search_text));

create index if not exists knowledge_entries_search_trgm_idx
  on knowledge_entries using gin (search_text gin_trgm_ops);

create table if not exists knowledge_files (
  id uuid primary key,
  entry_id uuid not null references knowledge_entries(id) on delete cascade,
  organization_id text not null references organizations(id),
  storage_key text not null,
  file_name text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  checksum text not null,
  extraction_status text not null default 'pending' check (extraction_status in ('pending', 'succeeded', 'failed')),
  extracted_text text,
  extraction_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_files_entry_idx
  on knowledge_files (entry_id, created_at desc);

create table if not exists knowledge_revisions (
  id uuid primary key,
  entry_id uuid not null references knowledge_entries(id) on delete cascade,
  organization_id text not null references organizations(id),
  revision_number integer not null check (revision_number >= 1),
  title text not null,
  tags text[] not null default '{}',
  -- Markdown snapshot for markdown-form entries; file reference for file-form entries.
  content_markdown text,
  file_id uuid references knowledge_files(id),
  author_user_id text not null references users(id),
  restored_from_revision_id uuid references knowledge_revisions(id),
  created_at timestamptz not null default now(),
  unique (entry_id, revision_number)
);

create index if not exists knowledge_revisions_entry_idx
  on knowledge_revisions (entry_id, revision_number desc);

alter table knowledge_entries
  add constraint knowledge_entries_head_revision_fk
  foreign key (head_revision_id) references knowledge_revisions(id);

-- knowledge:view is the default for every organization member; knowledge:edit grants
-- create plus own-entry governance; knowledge:manage is admin-tier cross-entry governance.
update roles
set permissions = permissions || array['knowledge:view']
where not (permissions @> array['knowledge:view'])
  and id in ('guest', 'hardware-user', 'software-user', 'hardware-committer', 'software-committer', 'admin', 'platform-admin');

update roles
set permissions = permissions || array['knowledge:edit']
where not (permissions @> array['knowledge:edit'])
  and id in ('hardware-user', 'software-user', 'hardware-committer', 'software-committer', 'admin', 'platform-admin');

update roles
set permissions = permissions || array['knowledge:manage']
where not (permissions @> array['knowledge:manage'])
  and id in ('admin', 'platform-admin');
