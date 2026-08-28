-- Issue #649 follow-up: nodename-only schema identities are node-type
-- definitions, not DriverRegistration subjects.  Earlier migrations created
-- `nodetype:*` subjects as driver registrations, which let the effective
-- catalog bypass driver placement while still reporting an unclassified row.
-- Keep the subject/source identity and history; correct only the durable
-- discriminant and its taxonomy child.

insert into node_type_definitions (attribution_subject_id, bare_node_name)
select asub.id,
       coalesce(
         nullif(regexp_replace(lower(asub.source_key), '^nodetype:', ''), ''),
         asub.display_name
       )
from attribution_subjects asub
where asub.subject_kind = 'driver-registration'
  and lower(asub.source_key) like 'nodetype:%'
on conflict (attribution_subject_id) do nothing;

-- Keep the old registration and placement rows as immutable migration evidence.
-- They are no longer considered by effective queries after the subject kind is
-- corrected, and retaining them avoids silently destroying operator history.

update parameter_modules pm
set kind = 'node-type',
    updated_at = now()
where pm.kind = 'driver-group'
  and lower(pm.source_key) like 'nodetype:%'
  and pm.attribution_subject_id in (
    select id
    from attribution_subjects
    where subject_kind = 'driver-registration'
      and lower(source_key) like 'nodetype:%'
  );

update attribution_subjects
set subject_kind = 'node-type-definition',
    updated_at = now()
where subject_kind = 'driver-registration'
  and lower(source_key) like 'nodetype:%';

-- Keep the active-DTS write guard aligned with the corrected discriminant.
-- Node-type definitions still need a canonical subject and taxonomy child, but
-- their organization module is resolved per tenant at the effective-query seam
-- (a platform schema cannot carry one tenant's module id in this trigger).
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
  subject_kind text;
begin
  select ps.source_kind, ps.definition_lifecycle, ps.attribution_subject_id,
         dps.driver_schema_id
    into spec_source, spec_lifecycle, subject_id, driver_schema_id
  from parameter_specs ps
  left join dts_property_specs dps on dps.parameter_spec_id = ps.id
  where ps.id = p_parameter_spec_id;

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

  select asub.subject_kind
    into subject_kind
  from attribution_subjects asub
  where asub.id = subject_id;

  if subject_kind = 'node-type-definition' then
    if not exists (
      select 1 from node_type_definitions ntd
      where ntd.attribution_subject_id = subject_id
    ) then
      raise exception 'active DTS node-type definition % subject % is missing its taxonomy child',
        p_parameter_spec_id, subject_id using errcode = '23514';
    end if;
    return;
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

comment on function wiseeff_assert_active_dts_property_spec(text) is
  'Issue #649 contract guard for active DTS property identity, driver/node-type provenance, and placement readiness.';

create or replace function wiseeff_guard_active_dts_property_definition()
returns trigger
language plpgsql
as $$
declare
  spec_source text;
  spec_lifecycle text;
  subject_id text;
  schema_subject_id text;
  subject_kind text;
begin
  select ps.source_kind, ps.definition_lifecycle, ps.attribution_subject_id
    into spec_source, spec_lifecycle, subject_id
  from parameter_specs ps
  where ps.id = new.parameter_spec_id;

  if spec_source <> 'dts' or spec_lifecycle <> 'active' or new.driver_schema_id is null then
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
      new.parameter_spec_id, subject_id, schema_subject_id using errcode = '23514';
  end if;

  select asub.subject_kind
    into subject_kind
  from attribution_subjects asub
  where asub.id = subject_id;

  if subject_kind = 'node-type-definition' then
    if not exists (
      select 1 from node_type_definitions ntd
      where ntd.attribution_subject_id = subject_id
    ) then
      raise exception 'active DTS node-type definition % subject % is missing its taxonomy child',
        new.parameter_spec_id, subject_id using errcode = '23514';
    end if;
    return new;
  end if;

  if not exists (
    select 1 from attribution_subjects asub
    inner join driver_registrations dr on dr.attribution_subject_id = asub.id
    where asub.id = subject_id and asub.subject_kind = 'driver-registration'
  ) then
    raise exception 'active DTS property definition % subject % is not a driver registration',
      new.parameter_spec_id, subject_id using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function wiseeff_guard_active_dts_property_definition() is
  'Issue #649 contract guard: linked active DTS property rows require canonical driver or node-type provenance; unlinked import rows are reconciled before effective use.';
