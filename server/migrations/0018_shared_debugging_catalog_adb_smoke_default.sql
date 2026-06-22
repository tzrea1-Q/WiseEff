alter table debugging_parameters
  alter column project_id drop not null;

alter table debugging_parameter_node_bindings
  alter column project_id drop not null;

alter table debugging_parameter_node_bindings
  add column if not exists is_smoke_default boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'debugging_parameter_node_bindings_smoke_default_protocol_check'
  ) then
    alter table debugging_parameter_node_bindings
      add constraint debugging_parameter_node_bindings_smoke_default_protocol_check
      check (is_smoke_default = false or protocol = 'adb');
  end if;
end;
$$;

create unique index if not exists debugging_parameters_shared_key_idx
  on debugging_parameters(organization_id, key)
  where project_id is null;

create unique index if not exists debugging_parameters_shared_node_path_idx
  on debugging_parameters(organization_id, node_path)
  where project_id is null;

create index if not exists debugging_parameters_shared_filter_idx
  on debugging_parameters(organization_id, module, risk, sort_order)
  where project_id is null;

create index if not exists debugging_parameter_node_bindings_shared_protocol_idx
  on debugging_parameter_node_bindings(organization_id, protocol, enabled)
  where project_id is null;

create unique index if not exists debugging_parameter_node_bindings_default_adb_smoke_idx
  on debugging_parameter_node_bindings(organization_id)
  where protocol = 'adb'
    and is_smoke_default = true;
