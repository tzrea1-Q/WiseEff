-- T2.3b: disposer is not a PUBLIC catalog writer. Restore 0153 occurrence digest gate.

revoke execute on function parameter_catalog.dispose_plane_residue(text, text, text, text[]) from public;
do $$
begin
  execute format(
    'grant execute on function parameter_catalog.dispose_plane_residue(text, text, text, text[]) to %I',
    current_user
  );
end;
$$;

create or replace function parameter_catalog.protect_source_occurrence_identity()
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
    raise exception using errcode = '55000', message = 'Source occurrence identity is immutable';
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.project_id is distinct from old.project_id
     or new.config_set_id is distinct from old.config_set_id
     or new.file_id is distinct from old.file_id
     or new.occurrence_kind is distinct from old.occurrence_kind
     or new.logical_node_id is distinct from old.logical_node_id
     or new.configuration_instance_id is distinct from old.configuration_instance_id
     or new.configuration_schema_subject_id is distinct from old.configuration_schema_subject_id
     or new.root_pointer is distinct from old.root_pointer
     or new.root_pointer_digest is distinct from old.root_pointer_digest then
    raise exception using errcode = '55000', message = 'Source occurrence identity is immutable';
  end if;
  return new;
end;
$$;
alter function parameter_catalog.protect_source_occurrence_identity() owner to catalog_migration_owner;
