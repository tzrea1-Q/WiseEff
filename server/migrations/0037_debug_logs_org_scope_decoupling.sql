-- Decouple log analysis (M2) and debugging (M3) from parameter-management projects.
-- After this migration, logs/debug tables must not reference projects(id).

-- 1) Drop cross-domain parameter reload bindings.
drop table if exists parameter_reload_bindings;

-- 2) Drop indexes on debugging runtime tables that reference project_id.
drop index if exists debugging_devices_project_idx;
drop index if exists debugging_sessions_project_idx;
drop index if exists debugging_targets_protocol_idx;
drop index if exists debugging_sessions_protocol_idx;

-- 3) Debugging catalog: drop project_id constraints and indexes before column drops.
alter table debugging_parameters
  drop constraint if exists debugging_parameters_project_id_key_key;

alter table debugging_parameters
  drop constraint if exists debugging_parameters_project_id_node_path_key;

drop index if exists debugging_parameters_project_idx;
drop index if exists debugging_parameters_shared_key_idx;
drop index if exists debugging_parameters_shared_node_path_idx;
drop index if exists debugging_parameters_shared_filter_idx;
drop index if exists debugging_parameter_node_bindings_shared_protocol_idx;
drop index if exists debugging_parameters_runtime_enabled_idx;
drop index if exists debugging_parameters_shared_runtime_enabled_idx;
drop index if exists debugging_parameters_admin_archive_idx;
drop index if exists debugging_parameter_node_bindings_project_idx;
drop index if exists debug_nodes_org_project_idx;
drop index if exists debug_node_bindings_org_project_idx;

-- Prefer org-wide shared catalog rows when duplicate keys/paths exist across projects.
delete from debugging_parameters
where id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by organization_id, key
        order by (project_id is null) desc, updated_at desc, id asc
      ) as rn
    from debugging_parameters
  ) ranked
  where rn > 1
);

delete from debugging_parameters
where id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by organization_id, node_path
        order by (project_id is null) desc, updated_at desc, id asc
      ) as rn
    from debugging_parameters
    where node_path is not null
      and length(trim(node_path)) > 0
  ) ranked
  where rn > 1
);

-- Drop project_id foreign keys on debugging runtime tables.
alter table debugging_events drop constraint if exists debugging_events_project_id_fkey;
alter table debugging_snapshots drop constraint if exists debugging_snapshots_project_id_fkey;
alter table node_operations drop constraint if exists node_operations_project_id_fkey;
alter table debugging_sessions drop constraint if exists debugging_sessions_project_id_fkey;
alter table debugging_targets drop constraint if exists debugging_targets_project_id_fkey;
alter table debugging_devices drop constraint if exists debugging_devices_project_id_fkey;

-- Drop project_id foreign keys on debugging catalog tables.
alter table debugging_parameter_node_bindings
  drop constraint if exists debugging_parameter_node_bindings_project_id_fkey;
alter table debug_nodes drop constraint if exists debug_nodes_project_id_fkey;
alter table debug_node_bindings drop constraint if exists debug_node_bindings_project_id_fkey;
alter table debugging_parameters drop constraint if exists debugging_parameters_project_id_fkey;

-- debug_device_leases: collapse PK to (organization_id, device_id).
alter table debug_device_leases drop constraint if exists debug_device_leases_project_id_fkey;

delete from debug_device_leases
where ctid in (
  select ctid
  from (
    select
      ctid,
      row_number() over (
        partition by organization_id, device_id
        order by expires_at desc, acquired_at desc, project_id asc
      ) as rn
    from debug_device_leases
  ) ranked
  where rn > 1
);

alter table debug_device_leases drop constraint if exists debug_device_leases_pkey;

alter table debugging_events drop column if exists project_id;
alter table debugging_snapshots drop column if exists project_id;
alter table node_operations drop column if exists project_id;
alter table debugging_sessions drop column if exists project_id;
alter table debugging_targets drop column if exists project_id;
alter table debugging_devices drop column if exists project_id;

alter table debug_device_leases drop column if exists project_id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'debug_device_leases_pkey'
  ) then
    alter table debug_device_leases
      add constraint debug_device_leases_pkey primary key (organization_id, device_id);
  end if;
end;
$$;

alter table debugging_parameter_node_bindings drop column if exists project_id;
alter table debug_nodes drop column if exists project_id;
alter table debug_node_bindings drop column if exists project_id;
alter table debugging_parameters drop column if exists project_id;

-- Replace project-scoped indexes with organization-scoped indexes.
create index if not exists debugging_devices_org_idx on debugging_devices(organization_id);
create index if not exists debugging_sessions_org_started_idx
  on debugging_sessions(organization_id, started_at desc);
create index if not exists debugging_targets_org_protocol_idx
  on debugging_targets(organization_id, protocol, status);
create index if not exists debugging_sessions_org_protocol_idx
  on debugging_sessions(organization_id, protocol, started_at desc);

create unique index if not exists debugging_parameters_org_key_idx
  on debugging_parameters(organization_id, key);
create unique index if not exists debugging_parameters_org_node_path_idx
  on debugging_parameters(organization_id, node_path);
create index if not exists debugging_parameters_org_filter_idx
  on debugging_parameters(organization_id, module, risk, sort_order);
create index if not exists debugging_parameters_runtime_enabled_idx
  on debugging_parameters(organization_id, module, risk, sort_order)
  where enabled = true
    and archived_at is null;
create index if not exists debugging_parameters_admin_archive_idx
  on debugging_parameters(organization_id, enabled, archived_at, sort_order);

-- Optional: drop parameter-definition FKs but keep nullable columns for audit history.
alter table debugging_parameters
  drop constraint if exists debugging_parameters_parameter_definition_id_fkey;
alter table node_operations
  drop constraint if exists node_operations_parameter_definition_id_fkey;

-- 4) Logs: remove project_id scope.
drop index if exists log_records_org_project_status_idx;

alter table log_records drop column if exists project_id;
alter table log_file_objects drop column if exists project_id;

create index if not exists log_records_org_status_idx on log_records(organization_id, status);
