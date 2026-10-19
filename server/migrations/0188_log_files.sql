-- Per-record inventory; composite ownership is enforced by PostgreSQL.
-- log_records_id_org_unique already exists from the run-snapshot migration.
create table log_files (
  id text primary key,
  organization_id text not null references organizations(id),
  record_id text not null,
  path text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null,
  encoding text not null check (encoding in ('utf-8', 'utf-16le', 'utf-16be')),
  lossy boolean not null default false,
  line_count integer not null check (line_count >= 0),
  status text not null check (status in ('analyzed', 'skipped')),
  skip_reason text,
  object_key text,
  created_at timestamptz not null default now(),
  unique (record_id, path),
  foreign key (record_id, organization_id) references log_records(id, organization_id) on delete cascade,
  check ((status = 'analyzed' and object_key is not null and skip_reason is null)
    or (status = 'skipped' and object_key is null and skip_reason is not null))
);
create index log_files_org_record_idx on log_files(organization_id, record_id);
alter table log_evidence add column file_path text;
do $$
declare role_name text;
begin
  for role_name in select rolname from pg_roles
    where has_table_privilege(oid, 'public.log_domains', 'INSERT')
      and oid <> (select relowner from pg_class where oid = 'public.log_files'::regclass)
      and rolname <> 'PUBLIC'
  loop
    execute format('grant select, insert, update, delete on public.log_files to %I', role_name);
  end loop;
end $$;
