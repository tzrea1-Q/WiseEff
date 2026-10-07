-- Issue #898: keep debug-node Catalog linkage explicit and tenant-complete.
-- The legacy project_parameter_binding_id columns remain untouched for history
-- and backwards-compatible unassociated operation rows.

alter table debug_nodes
  add column if not exists canonical_binding_id text,
  add column if not exists canonical_project_id text;

alter table debug_nodes
  drop constraint if exists debug_nodes_canonical_binding_pair_ck;

alter table debug_nodes
  add constraint debug_nodes_canonical_binding_pair_ck
  check ((canonical_binding_id is null) = (canonical_project_id is null));

alter table node_operations
  add column if not exists canonical_binding_id text,
  add column if not exists canonical_project_id text,
  add column if not exists canonical_pin jsonb;

alter table node_operations
  drop constraint if exists node_operations_canonical_binding_pair_ck;

alter table node_operations
  add constraint node_operations_canonical_binding_pair_ck
  check ((canonical_binding_id is null) = (canonical_project_id is null));

alter table node_operations
  drop constraint if exists node_operations_canonical_pin_object_ck;

alter table node_operations
  add constraint node_operations_canonical_pin_object_ck
  check (canonical_pin is null or jsonb_typeof(canonical_pin) = 'object');

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'debug_nodes_canonical_binding_owner_fk'
  ) then
    alter table debug_nodes
      add constraint debug_nodes_canonical_binding_owner_fk
      foreign key (canonical_binding_id, organization_id)
      references parameter_catalog.project_parameter_bindings (id, organization_id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'debug_nodes_canonical_project_owner_fk'
  ) then
    alter table debug_nodes
      add constraint debug_nodes_canonical_project_owner_fk
      foreign key (canonical_project_id, organization_id)
      references public.projects (id, organization_id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'node_operations_canonical_binding_owner_fk'
  ) then
    alter table node_operations
      add constraint node_operations_canonical_binding_owner_fk
      foreign key (canonical_binding_id, organization_id)
      references parameter_catalog.project_parameter_bindings (id, organization_id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'node_operations_canonical_project_owner_fk'
  ) then
    alter table node_operations
      add constraint node_operations_canonical_project_owner_fk
      foreign key (canonical_project_id, organization_id)
      references public.projects (id, organization_id)
      on delete restrict;
  end if;
end;
$$;
