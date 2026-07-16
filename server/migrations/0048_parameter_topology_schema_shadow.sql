-- Additive semantic shadow schema for topology- and schema-aware parameters.
-- Production must not dual-write yet; legacy identity columns stay in place.
-- example_value is illustrative only and must never appear in constraints or release policy.

-- ---------------------------------------------------------------------------
-- Stable / versioned specification roots
-- ---------------------------------------------------------------------------

create table if not exists parameter_specs (
  id text primary key,
  organization_id text references organizations(id),
  source_kind text not null check (source_kind in ('dts', 'json', 'manual')),
  specification_key text not null,
  created_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, source_kind, specification_key)
);

create table if not exists parameter_spec_versions (
  id text primary key,
  parameter_spec_id text not null references parameter_specs(id),
  version integer not null,
  display_name text not null,
  description text not null,
  value_shape jsonb not null,
  schema_default jsonb,
  example_value jsonb,
  lifecycle text not null check (lifecycle in ('draft', 'active', 'deprecated')),
  created_at timestamptz not null default now(),
  unique (parameter_spec_id, version)
);

create table if not exists driver_schemas (
  id text primary key,
  parameter_spec_id text not null unique references parameter_specs(id),
  organization_id text references organizations(id),
  schema_namespace text not null,
  created_at timestamptz not null default now()
);

create table if not exists driver_schema_versions (
  id text primary key,
  driver_schema_id text not null references driver_schemas(id),
  parameter_spec_version_id text not null unique references parameter_spec_versions(id),
  version integer not null,
  compatible_patterns jsonb not null default '[]'::jsonb,
  parent_bus_constraints jsonb not null default '{}'::jsonb,
  source text not null check (source in ('linux', 'vendor', 'manual', 'inferred')),
  lifecycle text not null check (lifecycle in ('draft', 'active', 'deprecated')),
  created_at timestamptz not null default now(),
  unique (driver_schema_id, version)
);

create table if not exists dts_property_specs (
  id text primary key,
  parameter_spec_id text not null unique references parameter_specs(id),
  driver_schema_id text references driver_schemas(id),
  property_key text not null,
  schema_namespace text not null,
  units text,
  constraints jsonb not null default '{}'::jsonb,
  reference_rules jsonb not null default '{}'::jsonb,
  documentation text,
  created_at timestamptz not null default now()
);

create table if not exists parameter_policy_targets (
  id text primary key,
  organization_id text not null references organizations(id),
  parameter_spec_id text not null references parameter_specs(id),
  parameter_spec_version_id text references parameter_spec_versions(id),
  product_code text,
  target_value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists business_categories (
  id text primary key,
  organization_id text not null references organizations(id),
  parent_id text references business_categories(id),
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, parent_id, name)
);

-- ---------------------------------------------------------------------------
-- Config revisions, source occurrences, logical nodes, provenance
-- ---------------------------------------------------------------------------

create table if not exists dts_config_revisions (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id) on delete cascade,
  config_set_id text not null references dts_config_set(id) on delete cascade,
  revision_number integer not null,
  status text not null check (status in (
    'draft',
    'resolving',
    'needs_mapping',
    'invalid',
    'resolved',
    'validated',
    'compiled',
    'pending_approval',
    'published'
  )),
  created_by_user_id text references users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (config_set_id, revision_number)
);

create table if not exists dts_config_revision_members (
  id text primary key,
  config_revision_id text not null references dts_config_revisions(id) on delete cascade,
  file_id text not null references project_parameter_files(id),
  file_version_id text not null references project_parameter_file_versions(id),
  role text not null,
  sort_order integer not null default 0,
  unique (config_revision_id, file_id)
);

create table if not exists dts_node_occurrences (
  id text primary key,
  config_revision_id text not null references dts_config_revisions(id) on delete cascade,
  file_version_id text not null references project_parameter_file_versions(id),
  parent_occurrence_id text references dts_node_occurrences(id) on delete cascade,
  name text not null,
  unit_address text,
  labels jsonb not null default '[]'::jsonb,
  ref_target text,
  is_overlay_root boolean not null default false,
  node_path text not null,
  start_offset integer not null,
  end_offset integer not null,
  start_line integer not null,
  start_column integer not null,
  end_line integer not null,
  end_column integer not null,
  raw_text text not null,
  ast_json jsonb not null default '{}'::jsonb,
  source_order integer not null default 0,
  content_hash text
);

create table if not exists dts_property_occurrences (
  id text primary key,
  config_revision_id text not null references dts_config_revisions(id) on delete cascade,
  node_occurrence_id text not null references dts_node_occurrences(id) on delete cascade,
  file_version_id text not null references project_parameter_file_versions(id),
  property_name text not null,
  start_offset integer not null,
  end_offset integer not null,
  start_line integer not null,
  start_column integer not null,
  end_line integer not null,
  end_column integer not null,
  raw_text text not null,
  ast_json jsonb not null default '{}'::jsonb,
  source_order integer not null default 0,
  content_hash text
);

create table if not exists dts_logical_nodes (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id) on delete cascade,
  config_set_id text not null references dts_config_set(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists dts_logical_node_revisions (
  id text primary key,
  logical_node_id text not null references dts_logical_nodes(id) on delete cascade,
  config_revision_id text not null references dts_config_revisions(id) on delete cascade,
  node_locator text not null,
  name text not null,
  unit_address text,
  compatible text,
  driver_schema_version_id text references driver_schema_versions(id),
  parent_logical_node_id text references dts_logical_nodes(id),
  unique (logical_node_id, config_revision_id)
);

create table if not exists dts_occurrence_effects (
  id text primary key,
  config_revision_id text not null references dts_config_revisions(id) on delete cascade,
  logical_node_revision_id text references dts_logical_node_revisions(id) on delete cascade,
  property_name text,
  effect_kind text not null check (effect_kind in ('set', 'override', 'delete')),
  node_occurrence_id text references dts_node_occurrences(id) on delete cascade,
  property_occurrence_id text references dts_property_occurrences(id) on delete cascade,
  source_order integer not null default 0
);

-- ---------------------------------------------------------------------------
-- Project bindings, mapping / review queues, validation
-- ---------------------------------------------------------------------------

create table if not exists project_parameter_bindings (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id) on delete cascade,
  logical_node_id text references dts_logical_nodes(id),
  parameter_spec_id text not null references parameter_specs(id),
  created_at timestamptz not null default now(),
  unique nulls not distinct (project_id, logical_node_id, parameter_spec_id)
);

create table if not exists project_parameter_binding_revisions (
  id text primary key,
  binding_id text not null references project_parameter_bindings(id) on delete cascade,
  config_revision_id text not null references dts_config_revisions(id) on delete cascade,
  parameter_spec_version_id text not null references parameter_spec_versions(id),
  typed_value jsonb not null,
  canonical_value jsonb,
  raw_value text,
  schema_state text,
  policy_state text,
  created_at timestamptz not null default now(),
  unique (binding_id, config_revision_id)
);

create table if not exists identity_mapping_tasks (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id) on delete cascade,
  config_revision_id text not null references dts_config_revisions(id) on delete cascade,
  previous_logical_node_id text references dts_logical_nodes(id),
  candidate_logical_node_ids jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  reviewer_user_id text references users(id),
  reason text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists parameter_spec_review_tasks (
  id text primary key,
  organization_id text not null references organizations(id),
  parameter_spec_id text references parameter_specs(id),
  source_evidence jsonb not null default '{}'::jsonb,
  candidate_schemas jsonb not null default '[]'::jsonb,
  project_count integer not null default 0,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  reviewer_user_id text references users(id),
  reason text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists dts_validation_runs (
  id text primary key,
  organization_id text not null references organizations(id),
  config_revision_id text not null references dts_config_revisions(id) on delete cascade,
  stage text not null,
  status text not null check (status in ('pending', 'passed', 'failed')),
  toolchain jsonb not null default '{}'::jsonb,
  artifact_hashes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists dts_validation_diagnostics (
  id text primary key,
  validation_run_id text not null references dts_validation_runs(id) on delete cascade,
  code text not null,
  severity text not null check (severity in ('error', 'warning', 'info')),
  stage text not null,
  message text not null,
  file_name text,
  start_line integer,
  start_column integer,
  logical_node_id text references dts_logical_nodes(id),
  property_name text,
  guidance text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Migration evidence + audit subject links (evidence first for FK order)
-- ---------------------------------------------------------------------------

create table if not exists legacy_parameter_migration_evidence (
  id text primary key,
  organization_id text not null references organizations(id),
  legacy_kind text not null,
  legacy_id text not null,
  legacy_name text,
  legacy_path text,
  legacy_current_value text,
  legacy_recommended_value text,
  legacy_row_hash text,
  parameter_spec_id text references parameter_specs(id),
  parameter_spec_version_id text references parameter_spec_versions(id),
  project_parameter_binding_id text references project_parameter_bindings(id),
  migration_run_id text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists audit_subject_links (
  audit_event_id text not null references audit_events(id) on delete cascade,
  subject_kind text not null,
  legacy_id text,
  semantic_id text not null,
  evidence_id text references legacy_parameter_migration_evidence(id),
  primary key (audit_event_id, subject_kind, semantic_id)
);

-- ---------------------------------------------------------------------------
-- Nullable semantic FKs on legacy workflow + debugging tables (no drops)
-- ---------------------------------------------------------------------------

alter table parameter_history_entries
  add column if not exists parameter_spec_id text references parameter_specs(id);

alter table parameter_history_entries
  add column if not exists project_parameter_binding_id text references project_parameter_bindings(id);

alter table parameter_drafts
  add column if not exists project_parameter_binding_id text references project_parameter_bindings(id);

alter table parameter_change_requests
  add column if not exists parameter_spec_id text references parameter_specs(id);

alter table parameter_change_requests
  add column if not exists project_parameter_binding_id text references project_parameter_bindings(id);

alter table parameter_submission_items
  add column if not exists project_parameter_binding_id text references project_parameter_bindings(id);

alter table parameter_file_sync_conflicts
  add column if not exists parameter_spec_id text references parameter_specs(id);

alter table parameter_file_sync_conflicts
  add column if not exists project_parameter_binding_id text references project_parameter_bindings(id);

alter table debugging_parameters
  add column if not exists parameter_spec_id text references parameter_specs(id);

alter table debugging_parameters
  add column if not exists project_parameter_binding_id text references project_parameter_bindings(id);

alter table node_operations
  add column if not exists parameter_spec_id text references parameter_specs(id);

alter table node_operations
  add column if not exists project_parameter_binding_id text references project_parameter_bindings(id);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists parameter_specs_org_kind_idx
  on parameter_specs (organization_id, source_kind);

create index if not exists parameter_spec_versions_spec_idx
  on parameter_spec_versions (parameter_spec_id, version desc);

create index if not exists driver_schema_versions_driver_idx
  on driver_schema_versions (driver_schema_id, version desc);

create index if not exists dts_property_specs_driver_key_idx
  on dts_property_specs (driver_schema_id, property_key);

create index if not exists parameter_policy_targets_org_spec_idx
  on parameter_policy_targets (organization_id, parameter_spec_id);

create index if not exists business_categories_org_parent_idx
  on business_categories (organization_id, parent_id, sort_order);

create index if not exists dts_config_revisions_set_idx
  on dts_config_revisions (config_set_id, revision_number desc);

create index if not exists dts_config_revision_members_revision_idx
  on dts_config_revision_members (config_revision_id, sort_order);

create index if not exists dts_node_occurrences_revision_path_idx
  on dts_node_occurrences (config_revision_id, node_path);

create index if not exists dts_property_occurrences_revision_node_idx
  on dts_property_occurrences (config_revision_id, node_occurrence_id, property_name);

create index if not exists dts_logical_nodes_project_idx
  on dts_logical_nodes (project_id, config_set_id);

create index if not exists dts_logical_node_revisions_revision_idx
  on dts_logical_node_revisions (config_revision_id, node_locator);

create index if not exists dts_occurrence_effects_revision_idx
  on dts_occurrence_effects (config_revision_id, source_order);

create index if not exists project_parameter_bindings_project_idx
  on project_parameter_bindings (project_id, parameter_spec_id);

create index if not exists project_parameter_binding_revisions_binding_idx
  on project_parameter_binding_revisions (binding_id, config_revision_id);

create index if not exists identity_mapping_tasks_revision_status_idx
  on identity_mapping_tasks (config_revision_id, status);

create index if not exists parameter_spec_review_tasks_org_status_idx
  on parameter_spec_review_tasks (organization_id, status, created_at desc);

create index if not exists dts_validation_runs_revision_idx
  on dts_validation_runs (config_revision_id, created_at desc);

create index if not exists dts_validation_diagnostics_run_idx
  on dts_validation_diagnostics (validation_run_id, severity);

create index if not exists legacy_parameter_migration_evidence_legacy_idx
  on legacy_parameter_migration_evidence (legacy_kind, legacy_id);

create index if not exists audit_subject_links_semantic_idx
  on audit_subject_links (subject_kind, semantic_id);

create index if not exists parameter_history_entries_spec_idx
  on parameter_history_entries (parameter_spec_id)
  where parameter_spec_id is not null;

create index if not exists parameter_history_entries_binding_idx
  on parameter_history_entries (project_parameter_binding_id)
  where project_parameter_binding_id is not null;

create index if not exists parameter_change_requests_binding_idx
  on parameter_change_requests (project_parameter_binding_id)
  where project_parameter_binding_id is not null;

create index if not exists debugging_parameters_spec_idx
  on debugging_parameters (parameter_spec_id)
  where parameter_spec_id is not null;

create index if not exists node_operations_spec_idx
  on node_operations (parameter_spec_id)
  where parameter_spec_id is not null;
