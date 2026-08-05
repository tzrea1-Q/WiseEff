-- C1 / TD-060: durable project parameter initialization (semantic binding snapshots).
-- Dedicated initialization_status keeps ops `projects.status` (e.g. initialized/maintenance) intact.
-- Existing projects default to initialized so current workflows stay unlocked.

alter table projects
  add column if not exists initialization_status text not null default 'initialized';

alter table projects
  drop constraint if exists projects_initialization_status_check;

alter table projects
  add constraint projects_initialization_status_check
  check (
    initialization_status in (
      'not_initialized',
      'initialization_draft',
      'initialization_pending_review',
      'initialization_rejected',
      'initialized'
    )
  );

create index if not exists projects_initialization_status_idx
  on projects (organization_id, initialization_status);

create table if not exists project_parameter_initialization_drafts (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id) on delete cascade,
  project_name text not null,
  project_code text not null,
  owner_user_id text not null references users(id),
  source_project_ids jsonb not null default '[]'::jsonb,
  primary_source_project_id text,
  supplement_source_project_ids jsonb not null default '[]'::jsonb,
  selected_module_ids jsonb not null default '[]'::jsonb,
  selected_risks jsonb not null default '[]'::jsonb,
  selected_source_binding_ids jsonb not null default '[]'::jsonb,
  binding_snapshots jsonb not null default '[]'::jsonb,
  empty_library boolean not null default false,
  notes text not null default '',
  created_by_user_id text not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id)
);

create index if not exists project_parameter_initialization_drafts_org_project_idx
  on project_parameter_initialization_drafts (organization_id, project_id);

create table if not exists project_parameter_initialization_reviews (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id) on delete cascade,
  draft_id text not null references project_parameter_initialization_drafts(id) on delete cascade,
  status text not null,
  submitted_by_user_id text not null references users(id),
  submitted_at timestamptz not null default now(),
  reviewed_by_user_id text references users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  constraint project_parameter_initialization_reviews_status_check
    check (status in ('pending', 'approved', 'rejected'))
);

create index if not exists project_parameter_initialization_reviews_org_status_idx
  on project_parameter_initialization_reviews (organization_id, status, submitted_at desc);

create unique index if not exists project_parameter_initialization_reviews_one_pending_per_project
  on project_parameter_initialization_reviews (organization_id, project_id)
  where status = 'pending';
