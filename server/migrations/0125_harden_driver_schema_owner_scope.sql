-- Issue #649 follow-up: make DriverSchema root ownership symmetric.
--
-- 0124 rejected an organization-owned root that pointed at a different
-- organization, but allowed a platform (NULL owner) root to point at an
-- organization-owned ParameterSpec. That exception is not part of the
-- identity tuple: platform roots must reference platform definitions and
-- organization roots must reference definitions in the same organization.
-- Existing dirty rows remain migration evidence for the verifier/reconciler;
-- this trigger only closes the future write boundary.

create or replace function wiseeff_guard_driver_schema_identity_owner()
returns trigger
language plpgsql
as $$
declare
  spec_organization_id text;
  spec_subject_id text;
begin
  select ps.organization_id, ps.attribution_subject_id
    into spec_organization_id, spec_subject_id
  from parameter_specs ps
  where ps.id = new.parameter_spec_id;

  if not found then
    return new;
  end if;

  if new.organization_id is distinct from spec_organization_id then
    raise exception 'driver schema % organization does not match its parameter spec owner', new.id
      using errcode = '23514';
  end if;

  if new.attribution_subject_id is null
     and spec_subject_id is null then
    return new;
  end if;

  if new.attribution_subject_id is null
     or spec_subject_id is null
     or new.attribution_subject_id is distinct from spec_subject_id then
    raise exception 'driver schema % subject does not match its parameter spec subject', new.id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists wiseeff_driver_schema_identity_owner_guard on driver_schemas;
create trigger wiseeff_driver_schema_identity_owner_guard
before insert or update of parameter_spec_id, organization_id, attribution_subject_id
on driver_schemas
for each row execute function wiseeff_guard_driver_schema_identity_owner();

comment on function wiseeff_guard_driver_schema_identity_owner() is
  'Issue #649 contract guard: DriverSchema owner scope and canonical subject must match its ParameterSpec.';
