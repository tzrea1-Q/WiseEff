-- Issue #849 (C4): a canonical pending change is a draft, never an applied value.
--
-- Before this migration the only route named as draft creation for a published
-- definition wrote the canonical current ProjectValue directly and returned that
-- value id as a "draft id". That bypassed the pending-change behaviour entirely.
--
-- This table owns pending canonical value changes. Creating, editing or removing a
-- row here must never change:
--   * parameter_catalog.project_parameter_values (the current value tip),
--   * the binding's current_value_id pointer,
--   * the active config/source revision.
-- Only an authorised apply step (a later, separate deliverable) may move a draft
-- into the value tip.
--
-- Workflow storage stays in public alongside the existing workflow tables; the
-- physical schema name does not confer data authority. Every reference below is a
-- genuine canonical identity (catalog release, binding, definition revision) plus
-- the exact base value/source pins, not a renamed legacy id.

create table if not exists project_parameter_value_drafts (
  id text primary key,
  organization_id text not null references organizations(id) on delete restrict,
  project_id text not null,
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
  user_id text not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_parameter_value_drafts_project_fk
    foreign key (project_id, organization_id)
    references projects(id, organization_id)
    on delete restrict deferrable initially deferred,
  constraint project_parameter_value_drafts_release_fk
    foreign key (catalog_release_id)
    references parameter_catalog.catalog_releases(id)
    on delete restrict deferrable initially deferred,
  constraint project_parameter_value_drafts_binding_fk
    foreign key (binding_id)
    references parameter_catalog.project_parameter_bindings(id)
    on delete restrict deferrable initially deferred,
  constraint project_parameter_value_drafts_owner_uk
    unique (project_id, binding_id, user_id)
);

create index if not exists project_parameter_value_drafts_user_idx
  on project_parameter_value_drafts (organization_id, project_id, user_id, updated_at desc);

create index if not exists project_parameter_value_drafts_binding_idx
  on project_parameter_value_drafts (binding_id);
