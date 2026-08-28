-- Issue #649: preserve the legacy two-step import boundary.
--
-- Older importers insert an active ParameterSpec and its DTS property row
-- before the matching DriverSchema has been resolved.  0117's expand trigger
-- was intentionally strict for linked rows, but rejecting this transient
-- unlinked row breaks those transactional imports.  The effective projection
-- and the independent reconciliation verifier still keep it out of product
-- reads until the graph is complete.  Once driver_schema_id is present, the
-- subject/registration checks remain hard database constraints.

create or replace function wiseeff_guard_active_dts_property_definition()
returns trigger
language plpgsql
as $$
declare
  spec_source text;
  spec_lifecycle text;
  subject_id text;
  schema_subject_id text;
begin
  select ps.source_kind, ps.definition_lifecycle, ps.attribution_subject_id
    into spec_source, spec_lifecycle, subject_id
  from parameter_specs ps
  where ps.id = new.parameter_spec_id;

  if spec_source <> 'dts' or spec_lifecycle <> 'active' then
    return new;
  end if;

  -- The importer may resolve the schema in a later statement in the same
  -- transaction.  The verifier/reconciliation job is the fail-closed gate for
  -- this transitional state; a linked row must satisfy the strict checks.
  if new.driver_schema_id is null then
    return new;
  end if;

  if subject_id is null then
    raise exception 'active DTS property definition % must have an AttributionSubject', new.parameter_spec_id
      using errcode = '23514';
  end if;

  select ds.attribution_subject_id
    into schema_subject_id
  from driver_schemas ds
  where ds.id = new.driver_schema_id;

  if schema_subject_id is null then
    raise exception 'active DTS property definition % must link to a subject-bearing driver schema', new.parameter_spec_id
      using errcode = '23514';
  end if;

  if schema_subject_id <> subject_id then
    raise exception 'active DTS property definition % subject % disagrees with driver schema subject %',
      new.parameter_spec_id, subject_id, schema_subject_id
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from attribution_subjects asub
    inner join driver_registrations dr on dr.attribution_subject_id = asub.id
    where asub.id = subject_id and asub.subject_kind = 'driver-registration'
  ) then
    raise exception 'active DTS property definition % subject % is not a driver registration',
      new.parameter_spec_id, subject_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function wiseeff_guard_active_dts_property_definition() is
  'Issue #649 contract guard: linked active DTS property rows require canonical driver registration provenance; unlinked import rows are reconciled before effective use.';
