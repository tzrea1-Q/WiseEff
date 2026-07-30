-- ADR-0014 follow-up: staged atomic ParameterSpecVersion cutover jobs.
-- Prepare successor binding revisions, then finalize once all items are ready.

create table if not exists parameter_spec_version_cutover_runs (
  id text primary key,
  organization_id text not null references organizations(id),
  parameter_spec_id text not null references parameter_specs(id) on delete cascade,
  from_version_id text not null references parameter_spec_versions(id),
  to_version_id text not null references parameter_spec_versions(id),
  status text not null
    check (status in ('preparing', 'ready', 'finalized', 'cancelled', 'failed')),
  created_by_user_id text references users(id),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists parameter_spec_version_cutover_runs_open_uidx
  on parameter_spec_version_cutover_runs (parameter_spec_id)
  where status in ('preparing', 'ready');

create index if not exists parameter_spec_version_cutover_runs_org_idx
  on parameter_spec_version_cutover_runs (organization_id, created_at desc);

create table if not exists parameter_spec_version_cutover_items (
  id text primary key,
  run_id text not null references parameter_spec_version_cutover_runs(id) on delete cascade,
  binding_id text not null,
  project_id text,
  status text not null
    check (status in ('pending', 'ready', 'incompatible', 'skipped', 'applied')),
  base_revision_id text,
  successor_revision_id text,
  incompatibility_code text,
  details jsonb not null default '{}'::jsonb,
  unique (run_id, binding_id)
);

create index if not exists parameter_spec_version_cutover_items_run_idx
  on parameter_spec_version_cutover_items (run_id, status);
