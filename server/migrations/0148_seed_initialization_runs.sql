-- Issue #849 PU-04 (decision 17): a bounded, explicit seed-initialization scope.
--
-- The seed rebuild is a separately invoked, resumable operation pinned to a seed
-- digest. Recording the run makes a repeated initialization of the same completed
-- run a no-op, so a retry can never reseed or reset project values. Ordinary startup,
-- upgrade, ordinary seed orchestration and definition publication never touch this
-- table and therefore cannot reset project values.
--
-- No parameter data is created here; this is the run journal the plan is checked
-- against.

create table if not exists seed_initialization_runs (
  organization_id text not null references organizations(id) on delete restrict,
  seed_digest text not null check (seed_digest <> '' and btrim(seed_digest) = seed_digest),
  status text not null check (status in ('planned', 'running', 'completed', 'failed')),
  scope text not null check (scope in ('atlas-aurora-nebula')),
  target_project_ids jsonb not null check (jsonb_typeof(target_project_ids) = 'array'),
  blocked jsonb not null default '[]'::jsonb check (jsonb_typeof(blocked) = 'array'),
  started_by_user_id text references users(id) on delete restrict,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, seed_digest)
);

create index if not exists seed_initialization_runs_status_idx
  on seed_initialization_runs (organization_id, status, updated_at desc);
