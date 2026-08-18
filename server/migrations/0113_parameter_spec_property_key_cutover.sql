-- ADR-0034 / TD-117: staged property-key source cutover (start / finalize).
-- Parallel to parameter_spec_version_cutover_*; do not add columns to those tables.
-- Migration number is claimed against origin/main at branch time (highest was 0112);
-- re-check at merge time per fleet-coordination.

create table if not exists parameter_spec_property_key_cutover_runs (
  id text primary key,
  organization_id text not null references organizations(id),
  parameter_spec_id text not null references parameter_specs(id) on delete cascade,
  from_key text not null,
  to_key text not null,
  status text not null
    check (status in ('preparing', 'ready', 'finalized', 'cancelled', 'failed')),
  created_by_user_id text references users(id),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists parameter_spec_property_key_cutover_runs_open_uidx
  on parameter_spec_property_key_cutover_runs (parameter_spec_id)
  where status in ('preparing', 'ready');

create index if not exists parameter_spec_property_key_cutover_runs_org_idx
  on parameter_spec_property_key_cutover_runs (organization_id, created_at desc);

create table if not exists parameter_spec_property_key_cutover_items (
  id text primary key,
  run_id text not null references parameter_spec_property_key_cutover_runs(id) on delete cascade,
  binding_id text not null,
  project_id text,
  status text not null
    check (status in ('pending', 'ready', 'incompatible', 'skipped', 'applied')),
  location_status text,
  incompatibility_code text,
  details jsonb not null default '{}'::jsonb,
  unique (run_id, binding_id)
);

create index if not exists parameter_spec_property_key_cutover_items_run_idx
  on parameter_spec_property_key_cutover_items (run_id, status);
