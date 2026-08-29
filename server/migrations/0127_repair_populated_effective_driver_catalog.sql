-- Issue #649 populated-upgrade repair.
--
-- The expand/contract migrations intentionally preserved malformed historical
-- rows for audited classification. A populated self-hosted database exposed a
-- missing deterministic case: canonical platform driver schemas/properties were
-- complete, but their legacy root ParameterSpec had no subject and no tenant had
-- a driver-group placement. At the same time, unrelated subjectless DTS staging
-- surfaces remained lifecycle=active and kept the independent gate blocked.
--
-- This migration repairs only identities proven by the DriverSchema graph,
-- creates an organization placement directly from that canonical subject, and
-- moves evidence with no driver identity back to draft governance. It never
-- matches a driver by property_key, deletes history, or guesses a business
-- category.

-- A DriverSchema root is canonical only when all schemas using that root agree
-- on one non-null subject and owner. Property surfaces are excluded explicitly.
with canonical_roots as (
  select
    ps.id as parameter_spec_id,
    min(ds.attribution_subject_id) as attribution_subject_id
  from parameter_specs ps
  inner join driver_schemas ds
    on ds.parameter_spec_id = ps.id
   and ds.organization_id is not distinct from ps.organization_id
  inner join attribution_subjects asub
    on asub.id = ds.attribution_subject_id
   and (
     asub.organization_id is null
     or asub.organization_id = ps.organization_id
   )
  where ps.attribution_subject_id is null
    and not exists (
      select 1
      from dts_property_specs property_surface
      where property_surface.parameter_spec_id = ps.id
    )
  group by ps.id
  having count(distinct ds.attribution_subject_id) = 1
)
update parameter_specs ps
set attribution_subject_id = canonical.attribution_subject_id
from canonical_roots canonical
where ps.id = canonical.parameter_spec_id
  and ps.attribution_subject_id is null;

-- An unlinked, subjectless DTS property has no canonical driver identity. Its
-- current version remains as evidence, but neither the definition nor version
-- may continue to claim active status.
with unresolved_surfaces as (
  select ps.id
  from parameter_specs ps
  inner join dts_property_specs dps on dps.parameter_spec_id = ps.id
  where ps.source_kind = 'dts'
    and ps.definition_lifecycle = 'active'
    and ps.attribution_subject_id is null
    and dps.driver_schema_id is null
    and not exists (
      select 1
      from driver_schemas driver_root
      where driver_root.parameter_spec_id = ps.id
    )
)
update parameter_spec_versions version
set version_status = 'draft', lifecycle = 'draft'
where version.parameter_spec_id in (select id from unresolved_surfaces)
  and (
    version.version_status = 'active'
    or version.lifecycle = 'active'
  );

with unresolved_surfaces as (
  select ps.id
  from parameter_specs ps
  inner join dts_property_specs dps on dps.parameter_spec_id = ps.id
  where ps.source_kind = 'dts'
    and ps.definition_lifecycle = 'active'
    and ps.attribution_subject_id is null
    and dps.driver_schema_id is null
    and not exists (
      select 1
      from driver_schemas driver_root
      where driver_root.parameter_spec_id = ps.id
    )
)
update parameter_specs ps
set definition_lifecycle = 'draft'
where ps.id in (select id from unresolved_surfaces);

-- Active, fully linked platform driver properties are reusable catalog input.
-- Each organization receives one deterministic top-level driver-group for the
-- canonical registration. The module is intentionally uncategorized until a
-- human or authoritative registration default supplies a business category.
with canonical_driver_subjects as (
  select distinct
    ps.attribution_subject_id,
    asub.display_name,
    asub.source_key
  from parameter_specs ps
  inner join dts_property_specs dps on dps.parameter_spec_id = ps.id
  inner join driver_schemas ds on ds.id = dps.driver_schema_id
  inner join attribution_subjects asub
    on asub.id = ps.attribution_subject_id
   and asub.subject_kind = 'driver-registration'
   and asub.organization_id is null
  inner join driver_registrations registration
    on registration.attribution_subject_id = ps.attribution_subject_id
  where ps.organization_id is null
    and ps.source_kind = 'dts'
    and ps.definition_lifecycle = 'active'
    and ds.organization_id is null
    and ds.attribution_subject_id = ps.attribution_subject_id
    and exists (
      select 1
      from parameter_spec_versions active_version
      where active_version.parameter_spec_id = ps.id
        and active_version.version_status = 'active'
        and active_version.lifecycle = 'active'
    )
    and exists (
      select 1
      from driver_schema_versions active_schema_version
      where active_schema_version.driver_schema_id = ds.id
        and active_schema_version.lifecycle = 'active'
    )
), module_candidates as (
  select
    organization.id as organization_id,
    subject.attribution_subject_id,
    subject.source_key,
    coalesce(
      nullif(trim(subject.display_name), ''),
      nullif(trim(subject.source_key), ''),
      subject.attribution_subject_id
    ) as base_name
  from organizations organization
  cross join canonical_driver_subjects subject
  where not exists (
    select 1
    from parameter_modules existing
    where existing.organization_id = organization.id
      and existing.kind = 'driver-group'
      and existing.attribution_subject_id = subject.attribution_subject_id
  )
), named_candidates as (
  select
    candidate.*,
    case
      when count(*) over (
        partition by candidate.organization_id, lower(candidate.base_name)
      ) > 1
      or exists (
        select 1
        from parameter_modules conflicting_name
        where conflicting_name.organization_id = candidate.organization_id
          and conflicting_name.parent_id is null
          and lower(conflicting_name.name) = lower(candidate.base_name)
      )
      then candidate.base_name || ' [' ||
        substr(md5(candidate.attribution_subject_id), 1, 8) || ']'
      else candidate.base_name
    end as module_name
  from module_candidates candidate
)
insert into parameter_modules (
  id, organization_id, parent_id, name, path, depth, sort_order,
  description, scope, kind, origin, source_key, attribution_subject_id
)
select
  'pmod:driver:' || md5(
    candidate.organization_id || E'\u001f' || candidate.attribution_subject_id
  ),
  candidate.organization_id,
  null,
  candidate.module_name,
  'pmod:driver:' || md5(
    candidate.organization_id || E'\u001f' || candidate.attribution_subject_id
  ),
  1,
  0,
  candidate.module_name || ' canonical driver group.',
  'Canonical driver registration ' || candidate.attribution_subject_id,
  'driver-group',
  'auto',
  candidate.source_key,
  candidate.attribution_subject_id
from named_candidates candidate
on conflict do nothing;

with unique_driver_modules as (
  select
    module.organization_id,
    module.attribution_subject_id,
    min(module.id) as module_id
  from parameter_modules module
  where module.kind = 'driver-group'
    and module.attribution_subject_id is not null
  group by module.organization_id, module.attribution_subject_id
  having count(*) = 1
)
insert into driver_registration_placements (
  id, organization_id, attribution_subject_id, driver_group_module_id,
  default_business_category_module_id
)
select
  'drp:' || md5(
    module.organization_id || E'\u001f' || module.attribution_subject_id
  ),
  module.organization_id,
  module.attribution_subject_id,
  module.module_id,
  null
from unique_driver_modules module
inner join attribution_subjects asub
  on asub.id = module.attribution_subject_id
 and asub.subject_kind = 'driver-registration'
 and (
   asub.organization_id is null
   or asub.organization_id = module.organization_id
 )
inner join driver_registrations registration
  on registration.attribution_subject_id = module.attribution_subject_id
where not exists (
  select 1
  from driver_registration_placements existing
  where existing.organization_id = module.organization_id
    and existing.attribution_subject_id = module.attribution_subject_id
)
on conflict do nothing;

-- A binding already pointing at a complete canonical property may still carry
-- the legacy unclassified/node-type module. Move only collision-free bindings
-- to the newly declared driver placement; unresolved subjectless bindings are
-- deliberately untouched and remain review evidence.
with canonical_binding_targets as (
  select
    binding.id as binding_id,
    placement.driver_group_module_id
  from project_parameter_bindings binding
  inner join parameter_specs ps on ps.id = binding.parameter_spec_id
  inner join attribution_subjects asub
    on asub.id = ps.attribution_subject_id
   and asub.subject_kind = 'driver-registration'
  inner join dts_property_specs dps on dps.parameter_spec_id = ps.id
  inner join driver_schemas schema
    on schema.id = dps.driver_schema_id
   and schema.attribution_subject_id = ps.attribution_subject_id
   and (
     schema.organization_id is null
     or schema.organization_id = ps.organization_id
   )
  inner join driver_registration_placements placement
    on placement.organization_id = binding.organization_id
   and placement.attribution_subject_id = ps.attribution_subject_id
  inner join parameter_modules placement_module
    on placement_module.id = placement.driver_group_module_id
   and placement_module.organization_id = binding.organization_id
   and placement_module.kind = 'driver-group'
   and placement_module.attribution_subject_id = ps.attribution_subject_id
  where ps.definition_lifecycle = 'active'
    and binding.module_id is distinct from placement.driver_group_module_id
    and not exists (
      select 1
      from project_parameter_bindings collision
      where collision.id <> binding.id
        and collision.project_id = binding.project_id
        and collision.logical_node_id is not distinct from binding.logical_node_id
        and collision.parameter_spec_id = binding.parameter_spec_id
        and collision.module_id = placement.driver_group_module_id
    )
)
update project_parameter_bindings binding
set module_id = target.driver_group_module_id
from canonical_binding_targets target
where binding.id = target.binding_id;

-- Keep the repaired invariant true after the upgrade. Platform DriverSchema
-- properties can be materialized lazily (API ingest/vendor sync), and local
-- bootstrap can add an organization after the catalog already exists. Either
-- order must produce the same one-placement-per-organization result in the
-- transaction that makes the catalog row effective.
create or replace function wiseeff_ensure_effective_driver_placements_for_subject(
  target_subject_id text
) returns void
language plpgsql
as $$
declare
  subject_display_name text;
  subject_source_key text;
  organization_row record;
  base_module_name text;
  candidate_module_name text;
  candidate_module_id text;
  matching_module_count integer;
begin
  select asub.display_name, asub.source_key
  into subject_display_name, subject_source_key
  from attribution_subjects asub
  inner join driver_registrations registration
    on registration.attribution_subject_id = asub.id
  where asub.id = target_subject_id
    and asub.organization_id is null
    and asub.subject_kind = 'driver-registration'
    and exists (
      select 1
      from parameter_specs ps
      inner join dts_property_specs dps on dps.parameter_spec_id = ps.id
      inner join driver_schemas ds
        on ds.id = dps.driver_schema_id
       and ds.organization_id is null
       and ds.attribution_subject_id = ps.attribution_subject_id
      where ps.organization_id is null
        and ps.source_kind = 'dts'
        and ps.definition_lifecycle = 'active'
        and ps.attribution_subject_id = asub.id
        and exists (
          select 1
          from parameter_spec_versions active_version
          where active_version.parameter_spec_id = ps.id
            and active_version.version_status = 'active'
            and active_version.lifecycle = 'active'
        )
        and exists (
          select 1
          from driver_schema_versions active_schema_version
          where active_schema_version.driver_schema_id = ds.id
            and active_schema_version.lifecycle = 'active'
        )
    );

  if not found then
    return;
  end if;

  base_module_name := coalesce(
    nullif(trim(subject_display_name), ''),
    nullif(trim(subject_source_key), ''),
    target_subject_id
  );

  for organization_row in select id from organizations order by id loop
    select count(*), min(module.id)
    into matching_module_count, candidate_module_id
    from parameter_modules module
    where module.organization_id = organization_row.id
      and module.kind = 'driver-group'
      and module.attribution_subject_id = target_subject_id;

    if matching_module_count = 0 then
      candidate_module_name := base_module_name;
      if exists (
        select 1
        from parameter_modules conflicting_name
        where conflicting_name.organization_id = organization_row.id
          and conflicting_name.parent_id is null
          and lower(conflicting_name.name) = lower(candidate_module_name)
      ) then
        candidate_module_name := base_module_name || ' [' ||
          substr(md5(target_subject_id), 1, 8) || ']';
      end if;
      candidate_module_id := 'pmod:driver:' || md5(
        organization_row.id || E'\u001f' || target_subject_id
      );

      insert into parameter_modules (
        id, organization_id, parent_id, name, path, depth, sort_order,
        description, scope, kind, origin, source_key, attribution_subject_id
      ) values (
        candidate_module_id,
        organization_row.id,
        null,
        candidate_module_name,
        candidate_module_id,
        1,
        0,
        candidate_module_name || ' canonical driver group.',
        'Canonical driver registration ' || target_subject_id,
        'driver-group',
        'auto',
        subject_source_key,
        target_subject_id
      )
      on conflict do nothing;

      select count(*), min(module.id)
      into matching_module_count, candidate_module_id
      from parameter_modules module
      where module.organization_id = organization_row.id
        and module.kind = 'driver-group'
        and module.attribution_subject_id = target_subject_id;
    end if;

    -- Multiple exact modules are governance ambiguity; never choose one by id.
    if matching_module_count = 1 then
      insert into driver_registration_placements (
        id, organization_id, attribution_subject_id, driver_group_module_id,
        default_business_category_module_id
      ) values (
        'drp:' || md5(organization_row.id || E'\u001f' || target_subject_id),
        organization_row.id,
        target_subject_id,
        candidate_module_id,
        null
      )
      on conflict do nothing;
    end if;
  end loop;
end;
$$;

create or replace function wiseeff_refresh_effective_driver_placements()
returns trigger
language plpgsql
as $$
declare
  target_subject_id text;
  subject_row record;
begin
  if tg_table_name = 'organizations' then
    for subject_row in
      select asub.id
      from attribution_subjects asub
      where asub.organization_id is null
        and asub.subject_kind = 'driver-registration'
    loop
      perform wiseeff_ensure_effective_driver_placements_for_subject(subject_row.id);
    end loop;
    return new;
  end if;

  if tg_table_name = 'parameter_specs' then
    target_subject_id := new.attribution_subject_id;
  elsif tg_table_name = 'parameter_spec_versions' then
    select ps.attribution_subject_id into target_subject_id
    from parameter_specs ps
    where ps.id = new.parameter_spec_id;
  elsif tg_table_name = 'dts_property_specs' then
    select ps.attribution_subject_id into target_subject_id
    from parameter_specs ps
    where ps.id = new.parameter_spec_id;
  elsif tg_table_name = 'driver_schemas' then
    target_subject_id := new.attribution_subject_id;
  elsif tg_table_name = 'driver_schema_versions' then
    select ds.attribution_subject_id into target_subject_id
    from driver_schemas ds
    where ds.id = new.driver_schema_id;
  end if;

  if target_subject_id is not null then
    perform wiseeff_ensure_effective_driver_placements_for_subject(target_subject_id);
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_refresh_effective_driver_placements
  on organizations;
create trigger organizations_refresh_effective_driver_placements
after insert on organizations
for each row execute function wiseeff_refresh_effective_driver_placements();

drop trigger if exists parameter_specs_refresh_effective_driver_placements
  on parameter_specs;
create trigger parameter_specs_refresh_effective_driver_placements
after insert or update of attribution_subject_id, definition_lifecycle
on parameter_specs
for each row execute function wiseeff_refresh_effective_driver_placements();

drop trigger if exists parameter_spec_versions_refresh_effective_driver_placements
  on parameter_spec_versions;
create trigger parameter_spec_versions_refresh_effective_driver_placements
after insert or update of lifecycle, version_status
on parameter_spec_versions
for each row execute function wiseeff_refresh_effective_driver_placements();

drop trigger if exists dts_property_specs_refresh_effective_driver_placements
  on dts_property_specs;
create trigger dts_property_specs_refresh_effective_driver_placements
after insert or update of driver_schema_id
on dts_property_specs
for each row execute function wiseeff_refresh_effective_driver_placements();

drop trigger if exists driver_schemas_refresh_effective_driver_placements
  on driver_schemas;
create trigger driver_schemas_refresh_effective_driver_placements
after insert or update of attribution_subject_id
on driver_schemas
for each row execute function wiseeff_refresh_effective_driver_placements();

drop trigger if exists driver_schema_versions_refresh_effective_driver_placements
  on driver_schema_versions;
create trigger driver_schema_versions_refresh_effective_driver_placements
after insert or update of lifecycle
on driver_schema_versions
for each row execute function wiseeff_refresh_effective_driver_placements();

comment on table driver_registration_placements is
  'Authoritative organization placement for a canonical driver registration; Issue #649 populated upgrades bootstrap an uncategorized top-level group only from complete DriverSchema identity.';
