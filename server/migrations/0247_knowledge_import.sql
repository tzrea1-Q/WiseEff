alter table knowledge_revisions add column source_checksum text;

create table knowledge_import_batches (
  id uuid primary key,
  organization_id text not null references organizations(id),
  created_by_user_id text references users(id) on delete set null,
  tags text[] not null,
  document_count integer not null default 0 check (document_count between 0 and 200),
  total_bytes bigint not null default 0 check (total_bytes between 0 and 104857600),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, organization_id)
);

create table knowledge_import_documents (
  id uuid primary key,
  organization_id text not null references organizations(id),
  batch_id uuid not null,
  relative_path text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  status text not null check (status in ('created', 'duplicate_skipped', 'unsupported_skipped', 'extraction_failed', 'rejected')),
  entry_id uuid,
  error text,
  warnings text[] not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (batch_id, organization_id)
    references knowledge_import_batches (id, organization_id) on delete cascade,
  foreign key (entry_id, organization_id)
    references knowledge_entries (id, organization_id) on delete set null (entry_id)
);
create index knowledge_import_documents_batch_idx on knowledge_import_documents(batch_id);
