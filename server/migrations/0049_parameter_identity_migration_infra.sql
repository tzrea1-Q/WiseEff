-- Formal infrastructure for parameter identity migration / cutover markers.
-- Dry-run must never CREATE these tables; apply/check assume they exist.

create table if not exists parameter_identity_migration_runs (
  id text primary key,
  mode text not null check (mode in ('dry-run', 'apply')),
  status text not null check (status in ('completed', 'failed', 'blocked')),
  report jsonb not null default '{}'::jsonb,
  db_snapshot_id text,
  object_snapshot_id text,
  write_lock_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists parameter_identity_cutovers (
  id text primary key,
  migration_run_id text not null references parameter_identity_migration_runs(id),
  cutover_at timestamptz not null default now()
);

create unique index if not exists parameter_identity_cutovers_singleton_idx
  on parameter_identity_cutovers ((true));
