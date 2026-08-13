-- Structural parameter-to-knowledge references (knowledge design deferred roadmap item 2).
-- References bind to parameter_specs.id — the stable surrogate key (ADR-0017) — so
-- identity corrections never break them, and spec deprecation (ADR-0011 soft
-- retirement) never removes them. The parameter_spec_id FK keeps the default
-- restrictive delete behavior on purpose: the catalog has no spec hard-delete path
-- today, and any future one must decide reference disposition explicitly.
-- Entry hard-delete cascades reference rows; the delete audit records the count.

create table if not exists knowledge_parameter_references (
  id uuid primary key,
  organization_id text not null references organizations(id),
  entry_id uuid not null references knowledge_entries(id) on delete cascade,
  parameter_spec_id text not null references parameter_specs(id),
  created_by_user_id text not null references users(id),
  created_at timestamptz not null default now(),
  unique (entry_id, parameter_spec_id)
);

-- Parameter-side read: published entries referencing one definition, org-scoped.
create index if not exists knowledge_parameter_references_org_spec_idx
  on knowledge_parameter_references (organization_id, parameter_spec_id);

create index if not exists knowledge_parameter_references_entry_idx
  on knowledge_parameter_references (entry_id, created_at desc);
