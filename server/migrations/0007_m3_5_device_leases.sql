create table if not exists debug_device_leases (
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  device_id text not null references debugging_devices(id),
  session_id text not null references debugging_sessions(id),
  lease_owner_user_id text not null references users(id),
  expires_at timestamptz not null,
  acquired_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_id, device_id)
);

create index if not exists debug_device_leases_expires_idx on debug_device_leases(expires_at);
create index if not exists debug_device_leases_session_idx on debug_device_leases(session_id);
