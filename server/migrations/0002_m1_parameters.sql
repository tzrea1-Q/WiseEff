create table if not exists projects (
  id text primary key,
  organization_id text not null references organizations(id),
  name text not null,
  code text not null,
  status text not null default 'initialized',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_modules (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  name text not null,
  sort_order integer not null default 0,
  unique (project_id, name)
);

create table if not exists parameter_definitions (
  id text primary key,
  organization_id text not null references organizations(id),
  name text not null,
  description text not null,
  explanation text not null,
  config_format text not null,
  module text not null,
  default_range text not null,
  unit text not null,
  risk text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_parameter_values (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  parameter_definition_id text not null references parameter_definitions(id),
  current_value text not null,
  recommended_value text not null,
  value_version integer not null default 1,
  updated_by_user_id text references users(id),
  updated_at timestamptz not null default now(),
  unique (project_id, parameter_definition_id)
);

create table if not exists parameter_history_entries (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  parameter_definition_id text not null references parameter_definitions(id),
  project_parameter_value_id text not null references project_parameter_values(id),
  version integer not null,
  value text not null,
  changed_by_user_id text references users(id),
  request_id text,
  changed_at timestamptz not null default now()
);

create table if not exists parameter_drafts (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  project_parameter_value_id text not null references project_parameter_values(id),
  user_id text not null references users(id),
  target_value text not null,
  reason text not null,
  updated_at timestamptz not null default now(),
  unique (project_id, project_parameter_value_id, user_id)
);

create table if not exists parameter_submission_rounds (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  submitter_user_id text not null references users(id),
  status text not null,
  summary text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists parameter_change_requests (
  id text primary key,
  organization_id text not null references organizations(id),
  submission_round_id text references parameter_submission_rounds(id),
  project_id text not null references projects(id),
  project_parameter_value_id text not null references project_parameter_values(id),
  parameter_definition_id text not null references parameter_definitions(id),
  base_version integer not null,
  current_value text not null,
  target_value text not null,
  status text not null,
  submitter_user_id text not null references users(id),
  assigned_to_user_id text references users(id),
  reviewer_note text,
  reject_reason text,
  fast_track boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists parameter_submission_items (
  id text primary key,
  organization_id text not null references organizations(id),
  submission_round_id text not null references parameter_submission_rounds(id),
  change_request_id text not null references parameter_change_requests(id),
  project_parameter_value_id text not null references project_parameter_values(id),
  current_value text not null,
  target_value text not null,
  reason text not null
);

create table if not exists parameter_review_decisions (
  id text primary key,
  organization_id text not null references organizations(id),
  request_id text not null references parameter_change_requests(id),
  reviewer_user_id text not null references users(id),
  decision text not null,
  from_status text not null,
  to_status text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists parameter_import_batches (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  created_by_user_id text not null references users(id),
  source_name text not null,
  status text not null,
  summary jsonb not null,
  items jsonb not null,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create index if not exists projects_organization_id_idx on projects(organization_id);
create index if not exists parameter_definitions_org_module_risk_idx on parameter_definitions(organization_id, module, risk);
create index if not exists project_parameter_values_project_idx on project_parameter_values(project_id, updated_at desc);
create index if not exists parameter_history_value_idx on parameter_history_entries(project_parameter_value_id, changed_at desc);
create index if not exists parameter_drafts_user_project_idx on parameter_drafts(user_id, project_id, updated_at desc);
create index if not exists parameter_change_requests_project_status_idx on parameter_change_requests(project_id, status, updated_at desc);
create unique index if not exists parameter_change_requests_open_unique_idx
  on parameter_change_requests(project_id, project_parameter_value_id)
  where status not in ('merged', 'rejected', 'withdrawn');
create index if not exists parameter_submission_rounds_project_created_idx on parameter_submission_rounds(project_id, created_at desc);
create index if not exists parameter_import_batches_project_created_idx on parameter_import_batches(project_id, created_at desc);
