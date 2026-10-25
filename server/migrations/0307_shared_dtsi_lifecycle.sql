-- Resource availability is independent of immutable source versions and draft revisions.
alter table public.shared_dtsi_resources
  add column state text not null default 'active' check (state in ('active','retired')),
  add column lifecycle_revision integer not null default 1 check (lifecycle_revision>0),
  add column lifecycle_request jsonb;
