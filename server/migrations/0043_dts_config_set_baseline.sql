create table if not exists dts_config_set (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  name text not null,
  description text,
  derived_from_id text references dts_config_set(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);

alter table project_parameter_files
  add column if not exists config_set_id text references dts_config_set(id),
  add column if not exists config_set_role text,
  add column if not exists config_set_sort_order integer not null default 0;

create table if not exists dts_release_baseline (
  id text primary key,
  organization_id text not null references organizations(id),
  config_set_id text not null references dts_config_set(id) on delete cascade,
  name text not null,
  notes text,
  status text not null default 'draft' check (status in ('draft', 'released')),
  created_by_user_id text references users(id),
  created_at timestamptz not null default now(),
  unique (config_set_id, name)
);

create table if not exists dts_release_baseline_members (
  id text primary key,
  baseline_id text not null references dts_release_baseline(id) on delete cascade,
  file_id text not null references project_parameter_files(id),
  file_version_id text not null references project_parameter_file_versions(id),
  version_number integer not null,
  unique (baseline_id, file_id)
);

create index if not exists dts_config_set_project_idx on dts_config_set(organization_id, project_id);
create index if not exists project_parameter_files_config_set_idx on project_parameter_files(config_set_id, config_set_sort_order);
create index if not exists dts_release_baseline_set_idx on dts_release_baseline(config_set_id, created_at desc);
create index if not exists dts_release_baseline_members_baseline_idx on dts_release_baseline_members(baseline_id);

-- Backfill: ensure every existing project has an implicit default config set,
-- then point any parameter files without a config set at their project's default.
-- Idempotent: uses a deterministic id per project and only touches null config_set_id rows.
insert into dts_config_set (id, organization_id, project_id, name, description, created_at, updated_at)
select
  'dcs-default-' || p.id,
  p.organization_id,
  p.id,
  'default',
  'Auto-created default configuration set (backfill from 0043).',
  now(),
  now()
from projects p
where not exists (
  select 1
  from dts_config_set dcs
  where dcs.project_id = p.id
    and dcs.name = 'default'
);

update project_parameter_files ppf
set config_set_id = dcs.id
from dts_config_set dcs
where dcs.project_id = ppf.project_id
  and dcs.name = 'default'
  and ppf.config_set_id is null;

-- Extend project_parameter_file_versions.origin to allow 'rollback'.
do $$
declare
  cname text;
begin
  for cname in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'project_parameter_file_versions'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%origin%'
  loop
    execute format('alter table project_parameter_file_versions drop constraint %I', cname);
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_parameter_file_versions_origin_check'
  ) then
    alter table project_parameter_file_versions
      add constraint project_parameter_file_versions_origin_check
      check (origin in ('upload', 'writeback', 'rollback'));
  end if;
end;
$$;
