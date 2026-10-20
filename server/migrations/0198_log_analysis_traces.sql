-- Dry runs never enter log_records, jobs, search, statistics or the webhook outbox.
create table log_skill_dry_runs (
  id text primary key,
  organization_id text not null references organizations(id),
  skill_id text not null,
  -- Draft rows are replaced on save. Keep the admitted revision identity as provenance.
  skill_revision_id text not null,
  sample_file_name text not null,
  sample_object_key text not null,
  status text not null check (status in ('processing', 'complete', 'failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  report jsonb,
  error text check (length(error) <= 120),
  created_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  unique (id, organization_id),
  foreign key (skill_id, organization_id) references log_domains(id, organization_id) on delete cascade
);
create unique index log_skill_dry_runs_active_idx on log_skill_dry_runs(organization_id, skill_id) where status = 'processing';
create index log_skill_dry_runs_history_idx on log_skill_dry_runs(organization_id, skill_id, created_at desc, id);

alter table log_analysis_runs add unique (id, organization_id);
create table log_analysis_trace_steps (
  organization_id text not null references organizations(id),
  run_id text,
  dry_run_id text,
  step_index integer not null check (step_index between 1 and 200),
  step jsonb not null check (jsonb_typeof(step) = 'object' and octet_length(step::text) <= 524288),
  check (num_nonnulls(run_id, dry_run_id) = 1),
  foreign key (run_id, organization_id) references log_analysis_runs(id, organization_id) on delete cascade,
  foreign key (dry_run_id, organization_id) references log_skill_dry_runs(id, organization_id) on delete cascade
);
create unique index log_analysis_trace_steps_run_idx on log_analysis_trace_steps(organization_id, run_id, step_index) where run_id is not null;
create unique index log_analysis_trace_steps_dry_idx on log_analysis_trace_steps(organization_id, dry_run_id, step_index) where dry_run_id is not null;

do $$
declare role_name text;
begin
  for role_name in select rolname from pg_roles
    where has_table_privilege(oid, 'public.log_domains', 'INSERT')
      and oid <> (select relowner from pg_class where oid = 'public.log_skill_dry_runs'::regclass)
      and rolname <> 'PUBLIC'
  loop
    execute format('grant select, insert, update, delete on public.log_skill_dry_runs, public.log_analysis_trace_steps to %I', role_name);
  end loop;
end $$;

-- Dry-run admission: process ownership and one active dry run per organization.
alter table log_skill_dry_runs add column owner_pid integer, add column owner_key integer;
alter table log_skill_dry_runs add constraint log_skill_dry_runs_owner_check
  check (status <> 'processing' or (owner_pid is not null and owner_pid > 0 and owner_key is not null and owner_key > 0));
create unique index log_skill_dry_runs_org_active_idx on log_skill_dry_runs(organization_id) where status = 'processing';
