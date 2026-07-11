create table if not exists project_parameter_files (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  file_name text not null,
  format text not null check (format in ('dts', 'json')),
  module_hint text references parameter_modules(id),
  current_version_id text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, file_name)
);

create table if not exists project_parameter_file_versions (
  id text primary key,
  file_id text not null references project_parameter_files(id) on delete cascade,
  version_number integer not null,
  storage_key text not null,
  checksum text not null,
  size_bytes bigint not null,
  parsed_index jsonb not null default '{}'::jsonb,
  origin text not null check (origin in ('upload', 'writeback')),
  created_by_user_id text references users(id),
  created_at timestamptz not null default now(),
  unique (file_id, version_number)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_parameter_files_current_version_fk'
  ) then
    alter table project_parameter_files
      add constraint project_parameter_files_current_version_fk
      foreign key (current_version_id) references project_parameter_file_versions(id);
  end if;
end;
$$;

alter table project_parameter_values
  add column if not exists source_file_name text,
  add column if not exists source_node_path text;

alter table parameter_drafts
  add column if not exists origin text not null default 'manual',
  add column if not exists origin_file_version_id text references project_parameter_file_versions(id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'parameter_drafts_origin_check'
  ) then
    alter table parameter_drafts
      add constraint parameter_drafts_origin_check
      check (origin in ('manual', 'file_sync'));
  end if;
end;
$$;

create table if not exists parameter_file_sync_conflicts (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  project_parameter_value_id text not null references project_parameter_values(id),
  parameter_definition_id text not null references parameter_definitions(id),
  file_version_id text not null references project_parameter_file_versions(id),
  file_draft_id text not null references parameter_drafts(id),
  ui_draft_id text not null references parameter_drafts(id),
  file_value text not null,
  ui_draft_value text not null,
  status text not null default 'open' check (status in ('open', 'resolved_file', 'resolved_ui')),
  resolved_by_user_id text references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists project_parameter_files_project_idx
  on project_parameter_files (organization_id, project_id);
create index if not exists project_parameter_file_versions_file_idx
  on project_parameter_file_versions (file_id, version_number desc);
create index if not exists parameter_file_sync_conflicts_project_open_idx
  on parameter_file_sync_conflicts (project_id, status)
  where status = 'open';
create index if not exists project_parameter_values_source_idx
  on project_parameter_values (project_id, source_file_name, source_node_path)
  where source_file_name is not null;
