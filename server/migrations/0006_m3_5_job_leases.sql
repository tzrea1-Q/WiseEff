alter table jobs add column if not exists lease_owner text;
alter table jobs add column if not exists lease_expires_at timestamptz;
alter table jobs add column if not exists attempt_count integer not null default 0;

create index if not exists jobs_claimable_idx on jobs(kind, status, created_at, id);
create index if not exists jobs_processing_lease_idx on jobs(kind, lease_expires_at)
  where status = 'processing';
