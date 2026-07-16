-- Spec review application: occurrence→spec decisions + reusable matcher overrides.
-- Dismissed overrides are fail-closed for release (no pretend-matched bindings).

create table if not exists parameter_spec_matcher_overrides (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id) on delete cascade,
  compatible_fingerprint text not null default '',
  node_locator text,
  property_key text not null,
  decision text not null check (decision in ('resolved', 'dismissed')),
  parameter_spec_id text references parameter_specs(id),
  source_review_task_id text references parameter_spec_review_tasks(id),
  reason text,
  created_by_user_id text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parameter_spec_matcher_overrides_resolved_spec_chk check (
    (decision = 'resolved' and parameter_spec_id is not null)
    or (decision = 'dismissed')
  ),
  unique (organization_id, project_id, compatible_fingerprint, property_key)
);

create index if not exists parameter_spec_matcher_overrides_org_project_idx
  on parameter_spec_matcher_overrides (organization_id, project_id, property_key);

create table if not exists dts_property_occurrence_spec_decisions (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id) on delete cascade,
  config_revision_id text not null references dts_config_revisions(id) on delete cascade,
  property_occurrence_id text not null references dts_property_occurrences(id) on delete cascade,
  logical_node_id text references dts_logical_nodes(id),
  property_key text not null,
  decision text not null check (decision in ('resolved', 'dismissed')),
  parameter_spec_id text references parameter_specs(id),
  binding_id text references project_parameter_bindings(id),
  review_task_id text references parameter_spec_review_tasks(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_occurrence_id)
);

create index if not exists dts_property_occurrence_spec_decisions_revision_idx
  on dts_property_occurrence_spec_decisions (config_revision_id, decision);
