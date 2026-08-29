-- Keep retained Agent principal tombstones bound to the Organization and file
-- identity that created them.  The 0136 file-version foreign key can validate
-- principal existence, but its file has no denormalized organization column;
-- these guards close the remaining update paths without changing the public
-- provenance contract.

create or replace function parameter_execution_principal_tombstone_scope_guard()
returns trigger
language plpgsql
as $$
begin
  if new.principal_user_id is distinct from old.principal_user_id
     or new.organization_id is distinct from old.organization_id then
    raise exception 'Parameter execution principal tombstones are immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists parameter_execution_principal_tombstones_scope_guard
  on parameter_execution_principal_tombstones;
create trigger parameter_execution_principal_tombstones_scope_guard
before update of principal_user_id, organization_id
on parameter_execution_principal_tombstones
for each row execute function parameter_execution_principal_tombstone_scope_guard();

-- Reinstall the file-version identity trigger with every column that can alter
-- the scope lookup.  The function from 0136 performs the exact file-to-
-- tombstone Organization check and remains the sole provenance projection.
drop trigger if exists project_parameter_file_versions_execution_identity_default_user
  on project_parameter_file_versions;
create trigger project_parameter_file_versions_execution_identity_default_user
before insert or update of initiator_type, created_by_user_id,
  initiator_principal_user_id, file_id
on project_parameter_file_versions
for each row execute function parameter_execution_identity_default_user('created_by_user_id');

-- A file's Organization can be changed without touching its versions.  Reject
-- that move when any retained Agent version would become cross-Organization;
-- files with no tombstone-backed Agent evidence retain the existing behavior.
create or replace function parameter_execution_file_scope_guard()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is distinct from old.organization_id
     and exists (
       select 1
       from project_parameter_file_versions versions
       join parameter_execution_principal_tombstones tombstones
         on tombstones.principal_user_id = versions.initiator_principal_user_id
       where versions.file_id = old.id
         and tombstones.organization_id is distinct from new.organization_id
     ) then
    raise exception 'Cannot move a file with retained Agent provenance across Organizations'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists project_parameter_files_execution_scope_guard
  on project_parameter_files;
create trigger project_parameter_files_execution_scope_guard
before update of organization_id
on project_parameter_files
for each row execute function parameter_execution_file_scope_guard();
