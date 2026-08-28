-- Issue #649: finish graph backfill and close the one-active-version boundary.
--
-- 0118/0119 are the expand and identity contract migrations. This migration
-- is intentionally separate so applied migration files stay immutable while
-- operators run the audited reconciliation job against already-dirty data.

-- First repair only missing property subjects for a uniquely matching schema.
-- This has to happen before linking dts_property_specs: the expand-phase guard
-- rejects an active property whose schema is linked while its subject is still
-- null. Existing non-null disagreements are intentionally left dirty for the
-- audited reconciliation job rather than guessed during migration.
with schema_matches as (
  select
    dps.id as dts_property_spec_id,
    ds.id as driver_schema_id,
    count(*) over (partition by dps.id) as match_count
  from dts_property_specs dps
  inner join parameter_specs ps on ps.id = dps.parameter_spec_id
  inner join driver_schemas ds
    on ds.schema_namespace = dps.schema_namespace
   and ds.organization_id is not distinct from ps.organization_id
   and ds.attribution_subject_id is not null
  where dps.driver_schema_id is null
)
update parameter_specs ps
set attribution_subject_id = ds.attribution_subject_id
from schema_matches sm
inner join driver_schemas ds on ds.id = sm.driver_schema_id
inner join dts_property_specs dps on dps.id = sm.dts_property_spec_id
where sm.match_count = 1
  and ps.id = dps.parameter_spec_id
  and ps.attribution_subject_id is null
  and ds.attribution_subject_id is not null
  and not exists (
    select 1
    from parameter_specs collision
    where collision.id <> ps.id
      and collision.organization_id is not distinct from ps.organization_id
      and collision.attribution_subject_id = ds.attribution_subject_id
      and collision.property_key = coalesce(ps.property_key, dps.property_key)
  );

-- Link legacy property rows to their uniquely matching schema namespace now
-- that every driver schema has a subject. Ambiguous namespaces and existing
-- non-null subject disagreements remain visible to reconciliation.
with schema_matches as (
  select
    dps.id as dts_property_spec_id,
    ds.id as driver_schema_id,
    count(*) over (partition by dps.id) as match_count
  from dts_property_specs dps
  inner join parameter_specs ps on ps.id = dps.parameter_spec_id
  inner join driver_schemas ds
    on ds.schema_namespace = dps.schema_namespace
   and ds.organization_id is not distinct from ps.organization_id
   and ds.attribution_subject_id is not null
  where dps.driver_schema_id is null
)
update dts_property_specs dps
set driver_schema_id = sm.driver_schema_id
from schema_matches sm, parameter_specs ps, driver_schemas ds
where dps.id = sm.dts_property_spec_id
  and ps.id = dps.parameter_spec_id
  and ds.id = sm.driver_schema_id
  and sm.match_count = 1
  and dps.driver_schema_id is null
  and ps.attribution_subject_id = ds.attribution_subject_id;

-- A DTS property spec and its driver schema must share the canonical subject.
-- Only rows with a missing subject are repaired here. Existing disagreements
-- are unresolved evidence and must be handled by reconciliation.
update parameter_specs ps
set attribution_subject_id = ds.attribution_subject_id
from dts_property_specs dps
inner join driver_schemas ds on ds.id = dps.driver_schema_id
where ps.id = dps.parameter_spec_id
  and ps.source_kind = 'dts'
  and ps.attribution_subject_id is null
  and ds.attribution_subject_id is not null
  and not exists (
    select 1
    from parameter_specs collision
    where collision.id <> ps.id
      and collision.organization_id is not distinct from ps.organization_id
      and collision.attribution_subject_id = ds.attribution_subject_id
      and collision.property_key = coalesce(ps.property_key, dps.property_key)
  );

-- Prefer a valid legacy registration default when it belongs to this
-- organization; otherwise retain the existing driver-group parent as the
-- deterministic fallback placement.
with candidates as (
  select distinct on (pm.organization_id, pm.attribution_subject_id)
    pm.organization_id,
    pm.attribution_subject_id,
    pm.id as driver_group_module_id,
    case
      when default_category.id is not null then default_category.id
      when parent.kind = 'business' then parent.id
      else null
    end as default_business_category_module_id
  from parameter_modules pm
  left join parameter_modules parent
    on parent.id = pm.parent_id
   and parent.organization_id = pm.organization_id
  left join driver_registrations dr on dr.attribution_subject_id = pm.attribution_subject_id
  left join parameter_modules default_category
    on default_category.id = dr.default_business_category_module_id
   and default_category.organization_id = pm.organization_id
   and default_category.kind = 'business'
  where pm.kind = 'driver-group'
    and pm.attribution_subject_id is not null
  order by
    pm.organization_id,
    pm.attribution_subject_id,
    case when pm.origin = 'curated' then 0 else 1 end,
    pm.id
)
update driver_registration_placements placement
set default_business_category_module_id = candidates.default_business_category_module_id,
    updated_at = now()
from candidates
where placement.organization_id = candidates.organization_id
  and placement.attribution_subject_id = candidates.attribution_subject_id
  and placement.default_business_category_module_id is null
  and candidates.default_business_category_module_id is not null;

-- A definition has one current active version. Existing duplicate active
-- versions are left for reconciliation/verification; all future writes fail
-- closed instead of making a lateral "current" query choose arbitrarily.
create or replace function wiseeff_guard_single_active_parameter_spec_version()
returns trigger
language plpgsql
as $$
begin
  if new.version_status = 'active' then
    -- Serialize activation per definition. The unique/version checks below are
    -- intentionally implemented as a trigger because legacy tables cannot
    -- express the conditional invariant with a portable partial constraint;
    -- the advisory lock closes the concurrent insert race between two writers.
    perform pg_advisory_xact_lock(hashtext(new.parameter_spec_id));
  end if;

  if new.version_status = 'active' and exists (
    select 1
    from parameter_spec_versions existing
    where existing.parameter_spec_id = new.parameter_spec_id
      and existing.version_status = 'active'
      and existing.id <> new.id
  ) then
    raise exception 'parameter spec % cannot have more than one active version', new.parameter_spec_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists wiseeff_single_active_parameter_spec_version_guard on parameter_spec_versions;
create trigger wiseeff_single_active_parameter_spec_version_guard
before insert or update of version_status, lifecycle
on parameter_spec_versions
for each row execute function wiseeff_guard_single_active_parameter_spec_version();

comment on function wiseeff_guard_single_active_parameter_spec_version() is
  'Issue #649 contract guard: one active current version per parameter definition.';
