-- Round 5: immutable stage-review / finalize phase audit for identity migration.

create table if not exists parameter_identity_migration_phases (
  id text primary key,
  migration_run_id text not null references parameter_identity_migration_runs(id) on delete cascade,
  phase text not null check (phase in ('stage-review', 'finalize')),
  status text not null check (status in ('staged', 'finalized', 'completed', 'failed', 'blocked')),
  report jsonb not null default '{}'::jsonb,
  db_snapshot_id text,
  object_snapshot_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists parameter_identity_migration_phases_run_phase_idx
  on parameter_identity_migration_phases (migration_run_id, phase, created_at desc);

alter table parameter_spec_review_tasks
  add column if not exists migration_run_id text references parameter_identity_migration_runs(id);

alter table identity_mapping_tasks
  add column if not exists migration_run_id text references parameter_identity_migration_runs(id);

create index if not exists parameter_spec_review_tasks_migration_run_status_idx
  on parameter_spec_review_tasks (migration_run_id, status)
  where migration_run_id is not null;

create index if not exists identity_mapping_tasks_migration_run_status_idx
  on identity_mapping_tasks (migration_run_id, status)
  where migration_run_id is not null;
