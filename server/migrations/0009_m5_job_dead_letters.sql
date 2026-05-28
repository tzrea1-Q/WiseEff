alter table jobs
  add column if not exists next_run_at timestamptz,
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists dead_letter_reason text;

create index if not exists jobs_retry_claimable_idx
  on jobs(kind, status, next_run_at, created_at, id);

create index if not exists jobs_dead_lettered_idx
  on jobs(kind, dead_lettered_at)
  where dead_lettered_at is not null;
