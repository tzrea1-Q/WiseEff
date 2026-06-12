create table if not exists local_registration_role_requests (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  current_role_id text not null references roles(id),
  requested_role_id text not null references roles(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by_user_id text references users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (requested_role_id in ('hardware-committer', 'software-committer')),
  check (current_role_id in ('hardware-user', 'software-user'))
);

create unique index if not exists local_registration_role_requests_pending_user_role_idx
  on local_registration_role_requests (user_id, requested_role_id)
  where status = 'pending';

create index if not exists local_registration_role_requests_org_status_created_idx
  on local_registration_role_requests (organization_id, status, created_at desc);
