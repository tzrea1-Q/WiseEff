-- Source archives are immutable; indexing metadata and archival state may change.
create table log_source_snapshots (
  id text primary key,
  organization_id text not null references organizations(id),
  skill_id text not null,
  version_label text not null check (length(btrim(version_label)) between 1 and 200),
  storage_key text not null,
  file_name text not null,
  status text not null default 'queued' check (status in ('queued', 'indexing', 'ready', 'failed', 'archived')),
  files_processed integer not null default 0 check (files_processed >= 0),
  files_total integer not null default 0 check (files_total >= 0),
  file_count integer not null default 0 check (file_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  skipped_files jsonb not null default '[]'::jsonb,
  error text,
  index_attempt_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (id, organization_id, skill_id),
  foreign key (skill_id, organization_id) references log_domains(id, organization_id) on delete cascade
);
create unique index log_source_snapshots_version_active_idx
  on log_source_snapshots (organization_id, skill_id, version_label) where status <> 'archived';
create index log_source_snapshots_queue_idx on log_source_snapshots (created_at) where status = 'queued';

create table log_source_files (
  id text primary key,
  organization_id text not null references organizations(id),
  snapshot_id text not null,
  path text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null,
  line_count integer not null check (line_count >= 0),
  language text not null,
  unique (id, organization_id, snapshot_id),
  unique (snapshot_id, path),
  foreign key (snapshot_id, organization_id) references log_source_snapshots(id, organization_id) on delete cascade
);
create index log_source_files_org_snapshot_idx on log_source_files (organization_id, snapshot_id);

create table log_source_chunks (
  id text primary key,
  organization_id text not null references organizations(id),
  snapshot_id text not null,
  file_id text not null,
  start_line integer not null check (start_line > 0),
  end_line integer not null check (end_line >= start_line),
  content text not null,
  search_vector tsvector generated always as (to_tsvector('simple', content)) stored,
  foreign key (file_id, organization_id, snapshot_id) references log_source_files(id, organization_id, snapshot_id) on delete cascade,
  foreign key (snapshot_id, organization_id) references log_source_snapshots(id, organization_id) on delete cascade
);
create index log_source_chunks_org_snapshot_idx on log_source_chunks (organization_id, snapshot_id);
create index log_source_chunks_fts_idx on log_source_chunks using gin (search_vector);
create index log_source_chunks_trgm_idx on log_source_chunks using gin (content gin_trgm_ops);

alter table log_analysis_runs add column source_snapshot_id text;
alter table log_analysis_runs add column source_snapshot_status text
  check (source_snapshot_status in ('queued', 'indexing', 'ready', 'failed', 'archived', 'missing'));
alter table log_analysis_runs add foreign key (source_snapshot_id, organization_id)
  references log_source_snapshots(id, organization_id);

-- Runtime roles provisioned before this migration inherit the new DML surface.
do $$
declare role_name text;
begin
  for role_name in select rolname from pg_roles
    where has_table_privilege(oid, 'public.log_domains', 'INSERT')
      and oid <> (select relowner from pg_class where oid = 'public.log_source_snapshots'::regclass)
      and rolname <> 'PUBLIC'
  loop
    execute format('grant select, insert, update, delete on public.log_source_snapshots, public.log_source_files, public.log_source_chunks to %I', role_name);
  end loop;
end $$;
