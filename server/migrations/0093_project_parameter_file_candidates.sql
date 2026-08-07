-- Staged candidate file versions (ADR-0018 / PCW-D8).
-- Candidates are never stored as the active-version pointer; activation is a separate act.

create table if not exists project_parameter_file_candidates (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  file_id text references project_parameter_files(id) on delete cascade,
  file_name text not null,
  format text not null check (format in ('dts', 'json')),
  status text not null check (
    status in ('uploading', 'parsing', 'ready', 'blocked', 'failed', 'abandoned')
  ),
  base_version_id text references project_parameter_file_versions(id) on delete set null,
  storage_key text,
  checksum text,
  size_bytes bigint,
  parsed_index jsonb not null default '{}'::jsonb,
  diagnostics jsonb not null default '[]'::jsonb,
  impact jsonb not null default '{}'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  created_by_user_id text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  abandoned_at timestamptz,
  abandoned_by_user_id text references users(id)
);

create index if not exists project_parameter_file_candidates_project_idx
  on project_parameter_file_candidates (organization_id, project_id, created_at desc);

create index if not exists project_parameter_file_candidates_file_idx
  on project_parameter_file_candidates (file_id, created_at desc)
  where file_id is not null;

create index if not exists project_parameter_file_candidates_status_idx
  on project_parameter_file_candidates (organization_id, project_id, status)
  where status <> 'abandoned';
