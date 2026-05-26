create table if not exists log_file_objects (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null,
  storage_key text not null,
  file_name text not null,
  content_type text not null,
  file_size_bytes bigint not null,
  checksum_sha256 text not null,
  uploaded_by_user_id text references users(id),
  created_at timestamptz not null default now()
);

create table if not exists log_records (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null,
  file_object_id text not null references log_file_objects(id),
  file_name text not null,
  source text not null,
  status text not null,
  archive_state text not null default 'active',
  current_run_id text,
  analysis_question text,
  related_parameter_id text,
  failure_reason text,
  submitted_by_user_id text references users(id),
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists log_analysis_runs (
  id text primary key,
  organization_id text not null references organizations(id),
  log_record_id text not null references log_records(id),
  status text not null,
  current_stage text not null,
  progress integer not null default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'log_records_current_run_fk'
  ) then
    alter table log_records
      add constraint log_records_current_run_fk
      foreign key (current_run_id) references log_analysis_runs(id);
  end if;
end;
$$;

create table if not exists log_analysis_stages (
  id text primary key,
  organization_id text not null references organizations(id),
  run_id text not null references log_analysis_runs(id),
  stage text not null,
  status text not null,
  progress integer not null,
  message text not null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, stage)
);

create table if not exists log_analysis_reports (
  id text primary key,
  organization_id text not null references organizations(id),
  log_record_id text not null references log_records(id),
  run_id text not null references log_analysis_runs(id),
  confidence numeric not null,
  conclusion text not null,
  impact text not null,
  severity text not null,
  suggested_actions jsonb not null,
  raw_lines jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists log_evidence (
  id text primary key,
  organization_id text not null references organizations(id),
  log_record_id text not null references log_records(id),
  run_id text not null references log_analysis_runs(id),
  stage text not null,
  line_numbers integer[] not null,
  inference text not null,
  suggested_action text not null,
  rule_hit text,
  created_at timestamptz not null default now()
);

create table if not exists log_feedback (
  id text primary key,
  organization_id text not null references organizations(id),
  log_record_id text not null references log_records(id),
  user_id text references users(id),
  rating text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id text primary key,
  organization_id text not null references organizations(id),
  kind text not null,
  target_type text not null,
  target_id text not null,
  status text not null,
  progress integer not null default 0,
  current_stage text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists log_records_org_project_status_idx on log_records(organization_id, project_id, status);
create index if not exists log_records_archive_state_idx on log_records(archive_state);
create index if not exists log_analysis_runs_log_record_idx on log_analysis_runs(log_record_id, created_at desc);
create index if not exists log_evidence_run_idx on log_evidence(run_id);
create index if not exists jobs_kind_target_idx on jobs(kind, target_type, target_id);
