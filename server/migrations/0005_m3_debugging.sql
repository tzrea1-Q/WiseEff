create table if not exists debugging_devices (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  name text not null,
  transport text not null,
  status text not null,
  firmware text not null,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists debugging_targets (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  device_id text not null references debugging_devices(id),
  target_ref text not null,
  label text not null,
  status text not null,
  detected_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (device_id, target_ref)
);

create table if not exists debugging_parameters (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  name text not null,
  key text not null,
  description text not null,
  module text not null,
  node_path text not null,
  access_mode text not null,
  unit text not null,
  range_label text not null,
  min_value numeric,
  max_value numeric,
  risk text not null,
  current_value text not null,
  target_value text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, key),
  unique (project_id, node_path)
);

create table if not exists debugging_sessions (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  device_id text not null references debugging_devices(id),
  target_id text not null references debugging_targets(id),
  actor_user_id text not null references users(id),
  status text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists node_operations (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  session_id text not null references debugging_sessions(id),
  parameter_id text references debugging_parameters(id),
  node_path text not null,
  operation_type text not null,
  status text not null,
  requested_value text,
  previous_value text,
  read_value text,
  readback_value text,
  verified boolean not null default false,
  failure_reason text,
  duration_ms integer not null default 0,
  approval_id text,
  snapshot_id text,
  actor_user_id text not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists debugging_snapshots (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  session_id text not null references debugging_sessions(id),
  operation_id text references node_operations(id),
  status text not null,
  risk text not null,
  entries jsonb not null,
  created_by_user_id text not null references users(id),
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'node_operations_snapshot_fk'
  ) then
    alter table node_operations
      add constraint node_operations_snapshot_fk
      foreign key (snapshot_id) references debugging_snapshots(id)
      deferrable initially deferred;
  end if;
end;
$$;

create table if not exists debugging_events (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  session_id text references debugging_sessions(id),
  operation_id text references node_operations(id),
  kind text not null,
  severity text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists debugging_devices_project_idx on debugging_devices(project_id);
create index if not exists debugging_parameters_project_idx on debugging_parameters(project_id, module, risk);
create index if not exists debugging_sessions_project_idx on debugging_sessions(project_id, started_at desc);
create index if not exists node_operations_session_idx on node_operations(session_id, created_at desc);
create index if not exists debugging_events_session_idx on debugging_events(session_id, created_at desc);
