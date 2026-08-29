-- Issue #649: a binding revision may reference only a version owned by the
-- binding's ParameterSpec. Historical disagreements remain visible to the
-- read-only verification gate; this guard prevents new ones.

create or replace function wiseeff_assert_binding_spec_version_owner()
returns trigger
language plpgsql
as $$
declare
  binding_spec_id text;
  version_spec_id text;
begin
  select binding.parameter_spec_id
    into binding_spec_id
  from project_parameter_bindings binding
  where binding.id = new.binding_id;

  select version.parameter_spec_id
    into version_spec_id
  from parameter_spec_versions version
  where version.id = new.parameter_spec_version_id;

  -- Let the existing foreign keys report missing rows. This trigger owns only
  -- the cross-table identity invariant once both referenced rows exist.
  if binding_spec_id is null or version_spec_id is null then
    return new;
  end if;

  if binding_spec_id is distinct from version_spec_id then
    raise exception using
      errcode = '23514',
      message = 'Binding ParameterSpecVersion must belong to the binding ParameterSpec.',
      detail = format(
        'binding_id=%s binding_spec_id=%s version_id=%s version_spec_id=%s',
        new.binding_id,
        binding_spec_id,
        new.parameter_spec_version_id,
        version_spec_id
      );
  end if;

  return new;
end;
$$;

drop trigger if exists project_parameter_binding_revision_owner_guard
  on project_parameter_binding_revisions;
create trigger project_parameter_binding_revision_owner_guard
before insert or update of binding_id, parameter_spec_version_id
on project_parameter_binding_revisions
for each row execute function wiseeff_assert_binding_spec_version_owner();
