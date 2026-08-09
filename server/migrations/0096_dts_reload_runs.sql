-- DTS reload debugging: reload runs and their per-parameter debug values (#281 / spec #280).
--
-- A reload run is the audit and evidence subject. It carries the generated debug overlay source
-- and compiled artifact by object-store key; debug values live only on the run and never touch
-- binding revisions, drafts, or release baselines (ADR-0019).

create table if not exists dts_reload_runs (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id) on delete cascade,
  config_revision_id text references dts_config_revisions(id) on delete set null,
  status text not null check (status in ('pending', 'blocked', 'validated')),
  failure_code text,
  steps jsonb not null default '[]'::jsonb,
  diagnostics jsonb not null default '[]'::jsonb,
  tool_versions jsonb not null default '{}'::jsonb,
  overlay_source_storage_key text,
  overlay_source_sha256 text,
  overlay_artifact_storage_key text,
  overlay_artifact_sha256 text,
  overlay_artifact_bytes integer,
  created_by_user_id text references users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists dts_reload_runs_project_created_idx
  on dts_reload_runs (organization_id, project_id, created_at desc);

-- One row per parameter carried by the run. A run is a batch even while the surface starts one
-- parameter at a time, so widening the batch needs no schema change.
create table if not exists dts_reload_run_targets (
  id text primary key,
  reload_run_id text not null references dts_reload_runs(id) on delete cascade,
  binding_id text not null references project_parameter_bindings(id) on delete cascade,
  node_path text not null,
  property_key text not null,
  baseline_value text,
  debug_value text not null,
  sort_order integer not null default 0,
  unique (reload_run_id, binding_id)
);

create index if not exists dts_reload_run_targets_run_idx
  on dts_reload_run_targets (reload_run_id, sort_order);

-- Grant the dedicated reload permission to the committer and admin roles seeded in `0021` / `0078`.
update roles
set permissions = array_append(permissions, 'debugging:dts-reload')
where id in ('hardware-committer', 'software-committer', 'admin', 'platform-admin')
  and not ('debugging:dts-reload' = any (permissions));
