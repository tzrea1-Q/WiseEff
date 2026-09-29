-- Canonical Knowledge references use immutable Catalog Definition identity.
-- Legacy Spec references remain in knowledge_parameter_references as history.

create unique index if not exists users_id_organization_unique_idx
  on users (id, organization_id);

create table if not exists knowledge_definition_references (
  id uuid primary key,
  organization_id text not null references organizations(id),
  entry_id uuid not null,
  definition_id text not null,
  created_by_user_id text,
  created_at timestamptz not null default now(),
  unique (entry_id, definition_id),
  foreign key (entry_id, organization_id)
    references knowledge_entries (id, organization_id) on delete cascade,
  foreign key (created_by_user_id, organization_id)
    references users (id, organization_id)
    on delete set null (created_by_user_id)
);

create index if not exists knowledge_definition_references_org_definition_idx
  on knowledge_definition_references (organization_id, definition_id);

create index if not exists knowledge_definition_references_entry_idx
  on knowledge_definition_references (entry_id, created_at desc);
