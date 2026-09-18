-- T3.1: residue DELETE allow-list helper is not a PUBLIC catalog writer.
-- Trigger functions that consult it run as SECURITY DEFINER under
-- catalog_migration_owner so ordinary sessions still receive SQLSTATE 55000.

create or replace function parameter_catalog.protect_binding_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if parameter_catalog.plane_disposal_allows_delete(tg_table_schema, tg_table_name, old.id) then
      return old;
    end if;
    raise exception using errcode = '55000', message = 'Project parameter bindings cannot be deleted';
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.project_id is distinct from old.project_id
     or new.logical_node_id is distinct from old.logical_node_id
     or new.registration_id is distinct from old.registration_id
     or new.subject_id is distinct from old.subject_id
     or new.definition_id is distinct from old.definition_id then
    raise exception using errcode = '55000', message = 'Project parameter binding identity is immutable';
  end if;
  return new;
end;
$$;
alter function parameter_catalog.protect_binding_identity() owner to catalog_migration_owner;
revoke all on function parameter_catalog.protect_binding_identity()
  from public, catalog_synchronizer_role, parameter_governance_writer_role;

create or replace function parameter_catalog.reject_immutable_catalog_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op = 'DELETE'
     and parameter_catalog.plane_disposal_allows_delete(tg_table_schema, tg_table_name, old.id) then
    return old;
  end if;
  raise exception using
    errcode = '55000',
    message = format('%I.%I is append-only', tg_table_schema, tg_table_name);
end;
$$;
alter function parameter_catalog.reject_immutable_catalog_change() owner to catalog_migration_owner;
revoke all on function parameter_catalog.reject_immutable_catalog_change()
  from public, catalog_synchronizer_role, parameter_governance_writer_role;

revoke execute on function parameter_catalog.plane_disposal_allows_delete(text, text, text) from public;
grant execute on function parameter_catalog.plane_disposal_allows_delete(text, text, text)
  to catalog_migration_owner;
