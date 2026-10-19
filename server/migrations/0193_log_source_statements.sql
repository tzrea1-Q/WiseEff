alter table log_source_snapshots add column statement_patterns jsonb not null default '[]'::jsonb;
alter table log_source_snapshots add column statement_count integer not null default 0 check (statement_count >= 0);
alter table log_source_snapshots add column statements_truncated boolean not null default false;
alter table log_source_files add unique (snapshot_id, organization_id, path);
alter table log_source_chunks add column chunk_ordinal integer not null default 0 check (chunk_ordinal >= 0);

create table log_source_statements (
  id text primary key,
  organization_id text not null references organizations(id),
  snapshot_id text not null,
  file_id text not null,
  path text not null,
  line integer not null check (line > 0),
  function_name text,
  raw_call text not null check (length(raw_call) <= 4096),
  skeleton text not null check (length(skeleton) <= 4096),
  match_key text not null,
  foreign key (snapshot_id, organization_id) references log_source_snapshots(id, organization_id) on delete cascade,
  foreign key (file_id, organization_id, snapshot_id) references log_source_files(id, organization_id, snapshot_id) on delete cascade,
  foreign key (snapshot_id, organization_id, path) references log_source_files(snapshot_id, organization_id, path) on delete cascade
);
create index log_source_statements_match_idx on log_source_statements (organization_id, snapshot_id, match_key);

-- Existing ready snapshots predate statement indexing and must be rebuilt before
-- source-location tools can advertise them as ready.
update log_source_snapshots set status = 'queued', updated_at = now() where status = 'ready';

alter table log_evidence add column source_snapshot_id text;
alter table log_evidence add column source_path text;
alter table log_evidence add column source_line integer;
alter table log_evidence add constraint log_evidence_source_location_check check (
  (source_snapshot_id is null and source_path is null and source_line is null) or
  (source_snapshot_id is not null and source_path is not null and source_line is not null and source_line > 0)
);
alter table log_evidence add foreign key (source_snapshot_id, organization_id)
  references log_source_snapshots(id, organization_id);
alter table log_evidence add foreign key (source_snapshot_id, organization_id, source_path)
  references log_source_files(snapshot_id, organization_id, path);

do $$
declare role_name text;
begin
  for role_name in select rolname from pg_roles
    where has_table_privilege(oid, 'public.log_domains', 'INSERT')
      and oid <> (select relowner from pg_class where oid = 'public.log_source_statements'::regclass)
      and rolname <> 'PUBLIC'
  loop
    execute format('grant select, insert, update, delete on public.log_source_statements to %I', role_name);
  end loop;
end $$;
