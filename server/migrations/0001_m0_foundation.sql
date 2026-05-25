create table if not exists organizations (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  organization_id text not null references organizations(id),
  name text not null,
  email text not null unique,
  title text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_active_at timestamptz
);

create table if not exists roles (
  id text primary key,
  name text not null,
  level text not null,
  permissions text[] not null
);

create table if not exists user_role_bindings (
  id text primary key,
  user_id text not null references users(id),
  organization_id text not null references organizations(id),
  project_id text,
  role_id text not null references roles(id),
  created_at timestamptz not null default now()
);

create index if not exists user_role_bindings_user_id_idx on user_role_bindings(user_id);
create index if not exists user_role_bindings_project_id_idx on user_role_bindings(project_id);

create table if not exists audit_events (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text,
  actor_user_id text references users(id),
  actor_type text not null,
  app text not null,
  kind text not null,
  action text not null,
  severity text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  trace_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_project_id_created_at_idx on audit_events(project_id, created_at desc);
create index if not exists audit_events_actor_user_id_idx on audit_events(actor_user_id);
create index if not exists audit_events_kind_idx on audit_events(kind);
