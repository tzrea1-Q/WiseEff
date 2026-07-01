-- TD-032: move protocol/path/access_mode from debug_nodes into debug_node_bindings.

create table if not exists debug_node_bindings (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text references projects(id),
  node_id text not null references debug_nodes(id) on delete cascade,
  protocol text not null,
  node_path text not null,
  access_mode text not null default 'RW',
  enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (node_id, protocol)
);

create index if not exists debug_node_bindings_org_project_idx
  on debug_node_bindings(organization_id, project_id);

create index if not exists debug_node_bindings_node_protocol_idx
  on debug_node_bindings(node_id, protocol, enabled);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'debug_node_bindings_protocol_check') then
    alter table debug_node_bindings
      add constraint debug_node_bindings_protocol_check check (protocol in ('hdc', 'adb'));
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'debug_node_bindings_access_mode_check') then
    alter table debug_node_bindings
      add constraint debug_node_bindings_access_mode_check check (access_mode in ('RO', 'WO', 'RW'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'debug_nodes'
      and column_name = 'protocol'
  ) then
    return;
  end if;

  with mapped as (
    select
      case
        when id ~ ':(hdc|adb)$' then regexp_replace(id, ':(hdc|adb)$', '')
        else id
      end as logical_id,
      organization_id,
      project_id,
      name,
      description,
      protocol,
      node_path,
      access_mode,
      value_kind,
      value_format,
      normalization_mode,
      max_value_bytes,
      sort_order,
      enabled,
      archived_at,
      archived_by,
      archive_reason,
      created_at,
      updated_at
    from debug_nodes
  ),
  ranked as (
    select distinct on (logical_id)
      logical_id,
      organization_id,
      project_id,
      name,
      description,
      protocol,
      node_path,
      access_mode,
      value_kind,
      value_format,
      normalization_mode,
      max_value_bytes,
      sort_order,
      enabled,
      archived_at,
      archived_by,
      archive_reason,
      created_at,
      updated_at
    from mapped
    order by logical_id, sort_order asc, updated_at desc
  )
  insert into debug_nodes (
    id,
    organization_id,
    project_id,
    name,
    description,
    protocol,
    node_path,
    access_mode,
    value_kind,
    value_format,
    normalization_mode,
    max_value_bytes,
    sort_order,
    enabled,
    archived_at,
    archived_by,
    archive_reason,
    created_at,
    updated_at
  )
  select
    logical_id,
    organization_id,
    project_id,
    name,
    description,
    protocol,
    node_path,
    access_mode,
    value_kind,
    value_format,
    normalization_mode,
    max_value_bytes,
    sort_order,
    enabled,
    archived_at,
    archived_by,
    archive_reason,
    created_at,
    updated_at
  from ranked
  on conflict (id) do update set
    name = excluded.name,
    description = excluded.description,
    protocol = excluded.protocol,
    node_path = excluded.node_path,
    access_mode = excluded.access_mode,
    value_kind = excluded.value_kind,
    value_format = excluded.value_format,
    normalization_mode = excluded.normalization_mode,
    max_value_bytes = excluded.max_value_bytes,
    sort_order = excluded.sort_order,
    enabled = excluded.enabled,
    project_id = excluded.project_id,
    archived_at = coalesce(excluded.archived_at, debug_nodes.archived_at),
    archived_by = coalesce(excluded.archived_by, debug_nodes.archived_by),
    archive_reason = coalesce(excluded.archive_reason, debug_nodes.archive_reason),
    updated_at = now();

  insert into debug_node_bindings (
    id,
    organization_id,
    project_id,
    node_id,
    protocol,
    node_path,
    access_mode,
    enabled,
    notes
  )
  select
    concat(
      case
        when dn.id ~ ':(hdc|adb)$' then regexp_replace(dn.id, ':(hdc|adb)$', '')
        else dn.id
      end,
      ':',
      dn.protocol
    ),
    dn.organization_id,
    dn.project_id,
    case
      when dn.id ~ ':(hdc|adb)$' then regexp_replace(dn.id, ':(hdc|adb)$', '')
      else dn.id
    end,
    dn.protocol,
    dn.node_path,
    dn.access_mode,
    dn.enabled,
    'Backfilled from debug_nodes row.'
  from debug_nodes dn
  on conflict (node_id, protocol) do update set
    organization_id = excluded.organization_id,
    project_id = excluded.project_id,
    node_path = excluded.node_path,
    access_mode = excluded.access_mode,
    enabled = excluded.enabled,
    notes = coalesce(excluded.notes, debug_node_bindings.notes),
    updated_at = now();

  update node_operations
  set node_id = regexp_replace(node_id, ':(hdc|adb)$', '')
  where node_id is not null
    and node_id ~ ':(hdc|adb)$';

  delete from debug_nodes
  where id ~ ':(hdc|adb)$';

  alter table debug_nodes drop constraint if exists debug_nodes_protocol_check;
  alter table debug_nodes drop constraint if exists debug_nodes_access_mode_check;

  alter table debug_nodes drop column if exists protocol;
  alter table debug_nodes drop column if exists node_path;
  alter table debug_nodes drop column if exists access_mode;
end;
$$;
