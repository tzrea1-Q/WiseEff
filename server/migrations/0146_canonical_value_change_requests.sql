-- Issue #849 C4: the canonical pending → reviewed → applied change unit.
--
-- A submitted canonical value change freezes the exact canonical identity
-- (binding, definition revision, catalog release) plus the exact base pins
-- (current value, config revision, source reference) and the target value.
-- Approval is the single authorized apply unit: it re-resolves those pins,
-- rejects drift, writes the value and its source through the existing canonical
-- owners, and commits workflow status, history and audit in the same owned
-- PostgreSQL transaction. Rejection and withdrawal never write a value.
--
-- This table is deliberately separate from the legacy `parameter_change_requests`,
-- which is bound to the legacy `project_parameter_values` value owner by a NOT NULL
-- foreign key. Reusing it would require dual-shape rows, which is the coexistence
-- this work removes.
--
-- Storage stays in `public` alongside the other workflow tables; every reference
-- below is a genuine canonical identity or a canonical-draft identity, not a
-- renamed legacy id.

create table if not exists project_parameter_value_change_requests (
  id text primary key,
  organization_id text not null references organizations(id) on delete restrict,
  project_id text not null,
  -- The applied draft is removed once the change is committed; the request keeps
  -- its own frozen pins, so losing the draft pointer costs no lineage.
  draft_id text references project_parameter_value_drafts(id) on delete set null,
  binding_id text not null,
  definition_id text not null,
  definition_revision_id text not null,
  catalog_release_id text not null,
  base_current_value_id text not null,
  config_revision_id text not null,
  source_ref text not null check (btrim(source_ref) <> ''),
  action text not null check (action in ('set', 'delete')),
  target_value jsonb not null,
  reason text not null check (btrim(reason) <> ''),
  status text not null check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  submitter_user_id text not null references users(id) on delete restrict,
  assigned_to_user_id text references users(id) on delete restrict,
  reviewer_user_id text references users(id) on delete restrict,
  reviewer_note text,
  applied_value_id text,
  apply_outcome text check (apply_outcome in ('committed', 'replayed')),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_parameter_value_change_requests_project_fk
    foreign key (project_id, organization_id)
    references projects(id, organization_id)
    on delete restrict deferrable initially deferred,
  constraint project_parameter_value_change_requests_release_fk
    foreign key (catalog_release_id)
    references parameter_catalog.catalog_releases(id)
    on delete restrict deferrable initially deferred,
  constraint project_parameter_value_change_requests_binding_fk
    foreign key (binding_id)
    references parameter_catalog.project_parameter_bindings(id)
    on delete restrict deferrable initially deferred,
  constraint project_parameter_value_change_requests_outcome_ck check (
    (status = 'approved' and applied_value_id is not null and applied_at is not null and apply_outcome is not null)
    or (status <> 'approved' and applied_value_id is null and applied_at is null and apply_outcome is null)
  )
);

-- One open request per draft. Closed history remains for review and audit.
create unique index if not exists project_parameter_value_change_requests_open_uk
  on project_parameter_value_change_requests (draft_id)
  where status = 'pending';

create index if not exists project_parameter_value_change_requests_project_idx
  on project_parameter_value_change_requests (organization_id, project_id, status, updated_at desc);

create index if not exists project_parameter_value_change_requests_reviewer_idx
  on project_parameter_value_change_requests (organization_id, project_id, assigned_to_user_id)
  where status = 'pending';

create index if not exists project_parameter_value_change_requests_submitter_idx
  on project_parameter_value_change_requests (organization_id, project_id, submitter_user_id, updated_at desc);
