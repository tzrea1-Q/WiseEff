-- Issue #649 follow-up: close owner and property-key identity gaps.
--
-- 0118-0123 preserve dirty rows for the audited reconciliation job. This
-- migration hardens all subsequent writes while the verifier/reconciler keep
-- existing malformed rows fail-closed and visible for repair.

create or replace function wiseeff_assert_active_dts_property_spec(p_parameter_spec_id text)
returns void
language plpgsql
as $$
declare
  spec_source text;
  spec_lifecycle text;
  spec_organization_id text;
  subject_id text;
  subject_kind text;
  subject_organization_id text;
  parameter_property_key text;
  dts_property_key text;
  driver_schema_id text;
  schema_subject_id text;
  schema_organization_id text;
begin
  select ps.source_kind,
         ps.definition_lifecycle,
         ps.organization_id,
         ps.attribution_subject_id,
         ps.property_key,
         dps.driver_schema_id,
         dps.property_key
    into spec_source,
         spec_lifecycle,
         spec_organization_id,
         subject_id,
         parameter_property_key,
         driver_schema_id,
         dts_property_key
  from parameter_specs ps
  left join dts_property_specs dps on dps.parameter_spec_id = ps.id
  where ps.id = p_parameter_spec_id;

  -- Driver roots and unlinked legacy staging rows are completed by
  -- reconciliation before they can become effective.
  if not found or spec_source <> 'dts' or spec_lifecycle <> 'active'
     or driver_schema_id is null then
    return;
  end if;

  if subject_id is null then
    raise exception 'active DTS property definition % must have an AttributionSubject',
      p_parameter_spec_id using errcode = '23514';
  end if;

  if parameter_property_key is null
     or dts_property_key is null
     or parameter_property_key is distinct from dts_property_key then
    raise exception 'active DTS property definition % has inconsistent property keys (% / %)',
      p_parameter_spec_id, parameter_property_key, dts_property_key
      using errcode = '23514';
  end if;

  select ds.organization_id, ds.attribution_subject_id
    into schema_organization_id, schema_subject_id
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

  if schema_organization_id is not null
     and schema_organization_id is distinct from spec_organization_id then
    raise exception 'active DTS property definition % has a driver schema owned by another organization',
      p_parameter_spec_id using errcode = '23514';
  end if;

  select asub.subject_kind, asub.organization_id
    into subject_kind, subject_organization_id
  from attribution_subjects asub
  where asub.id = subject_id;

  if subject_kind is null
     or (subject_organization_id is not null
       and subject_organization_id is distinct from spec_organization_id) then
    raise exception 'active DTS property definition % has a subject owned by another organization',
      p_parameter_spec_id using errcode = '23514';
  end if;

  if subject_kind = 'node-type-definition' then
    if not exists (
      select 1
      from node_type_definitions ntd
      where ntd.attribution_subject_id = subject_id
    ) then
      raise exception 'active DTS node-type definition % subject % is missing its taxonomy child',
        p_parameter_spec_id, subject_id using errcode = '23514';
    end if;
    return;
  end if;

  if subject_kind <> 'driver-registration' or not exists (
    select 1
    from driver_registrations dr
    where dr.attribution_subject_id = subject_id
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
before insert or update of source_kind, definition_lifecycle, organization_id,
  attribution_subject_id, property_key
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

create or replace function wiseeff_guard_active_dts_property_definition()
returns trigger
language plpgsql
as $$
begin
  perform wiseeff_assert_active_dts_property_spec(new.parameter_spec_id);
  return new;
end;
$$;

drop trigger if exists wiseeff_active_dts_property_definition_guard on dts_property_specs;
create trigger wiseeff_active_dts_property_definition_guard
before insert or update on dts_property_specs
for each row execute function wiseeff_guard_active_dts_property_definition();

-- DriverSchema roots are the canonical owner of driver identity. Prevent an
-- organization or subject from being silently crossed when a registry sync
-- updates an existing root row.
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

  if new.organization_id is not null
     and new.organization_id is distinct from spec_organization_id then
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

comment on function wiseeff_assert_active_dts_property_spec(text) is
  'Issue #649 contract guard for active DTS property owner, subject, property-key, and provenance identity.';

-- BEFORE triggers cannot observe the row's NEW values by selecting the table
-- again. Keep the table-reading helper for ordinary callers, but route write
-- guards through an explicit-value variant so subject/owner/property-key edits
-- are validated against the proposed tuple rather than the old row.
create or replace function wiseeff_assert_active_dts_property_spec_values(
  p_parameter_spec_id text,
  p_source text,
  p_lifecycle text,
  p_spec_organization_id text,
  p_subject_id text,
  p_parameter_property_key text,
  p_driver_schema_id text,
  p_dts_property_key text
)
returns void
language plpgsql
as $$
declare
  subject_kind text;
  subject_organization_id text;
  schema_subject_id text;
  schema_organization_id text;
begin
  if p_source <> 'dts' or p_lifecycle <> 'active' or p_driver_schema_id is null then
    return;
  end if;

  if p_subject_id is null then
    raise exception 'active DTS property definition % must have an AttributionSubject',
      p_parameter_spec_id using errcode = '23514';
  end if;

  if p_parameter_property_key is null
     or p_dts_property_key is null
     or p_parameter_property_key is distinct from p_dts_property_key then
    raise exception 'active DTS property definition % has inconsistent property keys (% / %)',
      p_parameter_spec_id, p_parameter_property_key, p_dts_property_key
      using errcode = '23514';
  end if;

  select ds.organization_id, ds.attribution_subject_id
    into schema_organization_id, schema_subject_id
  from driver_schemas ds
  where ds.id = p_driver_schema_id;

  if schema_subject_id is null then
    raise exception 'active DTS property definition % must link to a subject-bearing driver schema',
      p_parameter_spec_id using errcode = '23514';
  end if;

  if schema_subject_id <> p_subject_id then
    raise exception 'active DTS property definition % subject % disagrees with driver schema subject %',
      p_parameter_spec_id, p_subject_id, schema_subject_id using errcode = '23514';
  end if;

  if schema_organization_id is not null
     and schema_organization_id is distinct from p_spec_organization_id then
    raise exception 'active DTS property definition % has a driver schema owned by another organization',
      p_parameter_spec_id using errcode = '23514';
  end if;

  select asub.subject_kind, asub.organization_id
    into subject_kind, subject_organization_id
  from attribution_subjects asub
  where asub.id = p_subject_id;

  if subject_kind is null
     or (subject_organization_id is not null
       and subject_organization_id is distinct from p_spec_organization_id) then
    raise exception 'active DTS property definition % has a subject owned by another organization',
      p_parameter_spec_id using errcode = '23514';
  end if;

  if subject_kind = 'node-type-definition' then
    if not exists (
      select 1 from node_type_definitions ntd
      where ntd.attribution_subject_id = p_subject_id
    ) then
      raise exception 'active DTS node-type definition % subject % is missing its taxonomy child',
        p_parameter_spec_id, p_subject_id using errcode = '23514';
    end if;
    return;
  end if;

  if subject_kind <> 'driver-registration' or not exists (
    select 1 from driver_registrations dr
    where dr.attribution_subject_id = p_subject_id
  ) then
    raise exception 'active DTS property definition % subject % is not a driver registration',
      p_parameter_spec_id, p_subject_id using errcode = '23514';
  end if;
end;
$$;

create or replace function wiseeff_assert_active_dts_property_spec(p_parameter_spec_id text)
returns void
language plpgsql
as $$
declare
  spec_source text;
  spec_lifecycle text;
  spec_organization_id text;
  subject_id text;
  parameter_property_key text;
  driver_schema_id text;
  dts_property_key text;
begin
  select ps.source_kind,
         ps.definition_lifecycle,
         ps.organization_id,
         ps.attribution_subject_id,
         ps.property_key,
         dps.driver_schema_id,
         dps.property_key
    into spec_source,
         spec_lifecycle,
         spec_organization_id,
         subject_id,
         parameter_property_key,
         driver_schema_id,
         dts_property_key
  from parameter_specs ps
  left join dts_property_specs dps on dps.parameter_spec_id = ps.id
  where ps.id = p_parameter_spec_id;

  if not found then
    return;
  end if;
  perform wiseeff_assert_active_dts_property_spec_values(
    p_parameter_spec_id,
    spec_source,
    spec_lifecycle,
    spec_organization_id,
    subject_id,
    parameter_property_key,
    driver_schema_id,
    dts_property_key
  );
end;
$$;

create or replace function wiseeff_guard_active_dts_parameter_spec()
returns trigger
language plpgsql
as $$
declare
  dts_driver_schema_id text;
  dts_property_key text;
begin
  select dps.driver_schema_id, dps.property_key
    into dts_driver_schema_id, dts_property_key
  from dts_property_specs dps
  where dps.parameter_spec_id = new.id;
  perform wiseeff_assert_active_dts_property_spec_values(
    new.id,
    new.source_kind,
    new.definition_lifecycle,
    new.organization_id,
    new.attribution_subject_id,
    new.property_key,
    dts_driver_schema_id,
    dts_property_key
  );
  return new;
end;
$$;

create or replace function wiseeff_guard_active_dts_property_definition()
returns trigger
language plpgsql
as $$
declare
  spec_source text;
  spec_lifecycle text;
  spec_organization_id text;
  subject_id text;
  parameter_property_key text;
begin
  select ps.source_kind,
         ps.definition_lifecycle,
         ps.organization_id,
         ps.attribution_subject_id,
         ps.property_key
    into spec_source,
         spec_lifecycle,
         spec_organization_id,
         subject_id,
         parameter_property_key
  from parameter_specs ps
  where ps.id = new.parameter_spec_id;
  perform wiseeff_assert_active_dts_property_spec_values(
    new.parameter_spec_id,
    spec_source,
    spec_lifecycle,
    spec_organization_id,
    subject_id,
    parameter_property_key,
    new.driver_schema_id,
    new.property_key
  );
  return new;
end;
$$;
