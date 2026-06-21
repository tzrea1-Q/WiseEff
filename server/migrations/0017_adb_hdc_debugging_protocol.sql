alter table debugging_devices
  alter column transport set default 'hdc';

alter table debugging_targets
  add column if not exists protocol text not null default 'hdc';

alter table debugging_sessions
  add column if not exists protocol text not null default 'hdc';

alter table node_operations
  add column if not exists protocol text not null default 'hdc';

create table if not exists debugging_parameter_node_bindings (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  parameter_id text not null references debugging_parameters(id),
  protocol text not null,
  node_path text not null,
  access_mode text not null,
  enabled boolean not null default true,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parameter_id, protocol)
);

insert into debugging_parameter_node_bindings (
  id,
  organization_id,
  project_id,
  parameter_id,
  protocol,
  node_path,
  access_mode,
  enabled,
  notes,
  metadata
)
select
  concat(id, ':hdc'),
  organization_id,
  project_id,
  id,
  'hdc',
  node_path,
  access_mode,
  true,
  'Backfilled from debugging_parameters.node_path/access_mode.',
  '{}'::jsonb
from debugging_parameters
where node_path is not null
  and length(trim(node_path)) > 0
on conflict (parameter_id, protocol) do update
set node_path = excluded.node_path,
  access_mode = excluded.access_mode,
  enabled = excluded.enabled,
  updated_at = now();

create index if not exists debugging_targets_protocol_idx on debugging_targets(project_id, protocol, status);
create index if not exists debugging_sessions_protocol_idx on debugging_sessions(project_id, protocol, started_at desc);
create index if not exists node_operations_protocol_idx on node_operations(session_id, protocol, created_at desc);
create index if not exists debugging_parameter_node_bindings_project_idx
  on debugging_parameter_node_bindings(project_id, protocol, enabled);
