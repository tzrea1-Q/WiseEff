create table log_skill_analysis_cases (
  id text primary key,
  organization_id text not null references organizations(id),
  skill_id text not null,
  name text not null check (length(name) between 1 and 200),
  expectations jsonb not null,
  uploads jsonb not null,
  files jsonb not null,
  archive_path text,
  source_yaml text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (skill_id, organization_id) references log_domains(id, organization_id) on delete cascade
);
create index log_skill_analysis_cases_skill_idx on log_skill_analysis_cases(organization_id, skill_id);
create table log_skill_analysis_case_runs (
  id text primary key,
  organization_id text not null references organizations(id),
  skill_id text not null,
  skill_revision_id text not null,
  published_revision_id text,
  case_fingerprint text not null,
  status text not null check (status in ('processing', 'complete', 'failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  results jsonb not null default '[]',
  error text,
  created_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  owner_pid integer not null,
  owner_key integer not null,
  unique (id, organization_id),
  foreign key (skill_id, organization_id) references log_domains(id, organization_id) on delete cascade
);
create unique index log_skill_analysis_case_runs_active_idx on log_skill_analysis_case_runs(organization_id) where status = 'processing';
create index log_skill_analysis_case_runs_skill_idx on log_skill_analysis_case_runs(organization_id, skill_id, created_at desc);
-- Preserve upload bytes separately from the normalized text used by the worker.
create table log_original_uploads (
  organization_id text not null references organizations(id),
  record_id text not null,
  position integer not null,
  file_name text not null,
  object_key text not null,
  size_bytes bigint not null,
  primary key (record_id, organization_id, position),
  foreign key (record_id, organization_id) references log_records(id, organization_id) on delete cascade
);
do $$
declare role_name text;
begin
  for role_name in select rolname from pg_roles
    where has_table_privilege(oid, 'public.log_domains', 'INSERT')
      and oid <> (select relowner from pg_class where oid = 'public.log_skill_analysis_cases'::regclass)
      and rolname <> 'PUBLIC'
  loop
    execute format('grant select, insert, update, delete on public.log_skill_analysis_cases, public.log_skill_analysis_case_runs, public.log_original_uploads to %I', role_name);
  end loop;
end $$;
