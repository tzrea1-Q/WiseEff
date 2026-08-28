-- Issue #649: close the write boundary after the expand migration.
--
-- 0117 intentionally retains existing dirty rows so the audited reconciliation
-- job can classify them. These triggers make the invariant hold for every new
-- activation/update while that data migration is being run: an active DTS
-- property row must have a subject-bearing driver schema whose subject agrees
-- with the definition and is placed in the organization. Driver root specs
-- (the parameter_spec row owned by driver_schemas) have no dts_property_specs
-- row and are therefore not subject to the property guard.

create or replace function wiseeff_assert_active_dts_property_spec(p_parameter_spec_id text)
returns void
language plpgsql
as $$
declare
  spec_source text;
  spec_lifecycle text;
  subject_id text;
  driver_schema_id text;
  schema_subject_id text;
begin
  select ps.source_kind, ps.definition_lifecycle, ps.attribution_subject_id,
         dps.driver_schema_id
    into spec_source, spec_lifecycle, subject_id, driver_schema_id
  from parameter_specs ps
  left join dts_property_specs dps on dps.parameter_spec_id = ps.id
  where ps.id = p_parameter_spec_id;

  -- A driver root is a DTS ParameterSpec without a property row. It is a
  -- catalog source for driver schema versions, not an effective property.
  if not found or spec_source <> 'dts' or spec_lifecycle <> 'active'
     or driver_schema_id is null then
    return;
  end if;

  if subject_id is null then
    raise exception 'active DTS property definition % must have an AttributionSubject',
      p_parameter_spec_id using errcode = '23514';
  end if;

  select ds.attribution_subject_id
    into schema_subject_id
  from driver_schemas ds
  where ds.id = driver_schema_id;

  if schema_subject_id is null then
    raise exception 'active DTS property definition % must link to a subject-bearing driver schema',
      p_parameter_spec_id using errcode = '23514';
  end if;

  if schema_subject_id <> subject_id then
    raise exception 'active DTS property definition % subject % disagrees with driver schema subject %',
      p_parameter_spec_id, subject_id, schema_subject_id using errcode = '23514';
  end if;

  if not exists (
    select 1
    from attribution_subjects asub
    inner join driver_registrations dr on dr.attribution_subject_id = asub.id
    where asub.id = subject_id
      and asub.subject_kind = 'driver-registration'
  ) then
    raise exception 'active DTS property definition % subject % is not a driver registration',
      p_parameter_spec_id, subject_id using errcode = '23514';
  end if;
end;
$$;

create or replace function wiseeff_guard_active_dts_parameter_spec()
returns trigger
language plpgsql
as $$
begin
  perform wiseeff_assert_active_dts_property_spec(new.id);
  return new;
end;
$$;

drop trigger if exists wiseeff_active_dts_parameter_spec_guard on parameter_specs;
create trigger wiseeff_active_dts_parameter_spec_guard
before insert or update of source_kind, definition_lifecycle, attribution_subject_id
on parameter_specs
for each row execute function wiseeff_guard_active_dts_parameter_spec();

create or replace function wiseeff_guard_active_dts_parameter_spec_version()
returns trigger
language plpgsql
as $$
begin
  if new.version_status = 'active' or new.lifecycle = 'active' then
    perform wiseeff_assert_active_dts_property_spec(new.parameter_spec_id);
  end if;
  return new;
end;
$$;

drop trigger if exists wiseeff_active_dts_parameter_spec_version_guard on parameter_spec_versions;
create trigger wiseeff_active_dts_parameter_spec_version_guard
before insert or update of lifecycle, version_status
on parameter_spec_versions
for each row execute function wiseeff_guard_active_dts_parameter_spec_version();

comment on function wiseeff_assert_active_dts_property_spec(text) is
  'Issue #649 contract guard for active DTS property identity, schema subject, and registration provenance.';
