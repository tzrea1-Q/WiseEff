-- TD-032 Phase A: separate node registry from parameter reload bindings.

create table if not exists debug_nodes (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text references projects(id),
  name text not null,
  description text not null default '',
  protocol text not null,
  node_path text not null,
  access_mode text not null,
  value_kind text not null default 'scalar',
  value_format text not null default 'raw',
  normalization_mode text not null default 'trim',
  max_value_bytes integer,
  sort_order integer not null default 0,
  enabled boolean not null default true,
  archived_at timestamptz,
  archived_by text references users(id),
  archive_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists parameter_reload_bindings (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text references projects(id),
  parameter_definition_id text not null references parameter_definitions(id),
  protocol text not null,
  node_path text not null,
  access_mode text not null default 'RW',
  enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parameter_definition_id, protocol)
);

create index if not exists debug_nodes_org_project_idx on debug_nodes(organization_id, project_id);
create index if not exists parameter_reload_bindings_org_project_idx
  on parameter_reload_bindings(organization_id, project_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'debug_nodes_protocol_check') then
    alter table debug_nodes add constraint debug_nodes_protocol_check check (protocol in ('hdc', 'adb'));
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'debug_nodes_access_mode_check') then
    alter table debug_nodes add constraint debug_nodes_access_mode_check check (access_mode in ('RO', 'WO', 'RW'));
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'parameter_reload_bindings_protocol_check') then
    alter table parameter_reload_bindings
      add constraint parameter_reload_bindings_protocol_check check (protocol in ('hdc', 'adb'));
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'parameter_reload_bindings_access_mode_check') then
    alter table parameter_reload_bindings
      add constraint parameter_reload_bindings_access_mode_check check (access_mode in ('RO', 'WO', 'RW'));
  end if;
end;
$$;

alter table debugging_sessions
  add column if not exists session_kind text not null default 'node';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'debugging_sessions_session_kind_check') then
    alter table debugging_sessions
      add constraint debugging_sessions_session_kind_check check (session_kind in ('node', 'parameter_reload'));
  end if;
end;
$$;

alter table debugging_parameters
  add column if not exists parameter_definition_id text references parameter_definitions(id);

alter table node_operations
  add column if not exists parameter_definition_id text references parameter_definitions(id);

create index if not exists debugging_parameters_parameter_definition_idx
  on debugging_parameters(parameter_definition_id)
  where parameter_definition_id is not null;

create index if not exists node_operations_parameter_definition_idx
  on node_operations(parameter_definition_id)
  where parameter_definition_id is not null;
