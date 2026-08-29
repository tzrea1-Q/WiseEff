-- Issue #649 populated-upgrade follow-up.
--
-- 0127 creates one canonical driver-group per organization, but a retained
-- auto-discovered module may already own the same compatible source_key under
-- an older organization-scoped DriverRegistration. The source-key uniqueness
-- constraint then makes 0127's insert lose with ON CONFLICT DO NOTHING, while
-- the effective catalog correctly remains blocked for missing placement.
--
-- A source key is stable driver identity for auto-discovered modules. When one
-- complete platform DriverSchema proves the canonical subject and exactly one
-- auto driver-group already owns that key in an organization, cut that module
-- and its optional placement over in place. Preserve module id, name, parent,
-- bindings, category and the historical subject rows. Curated, ambiguous, or
-- differently keyed modules remain untouched and fail closed.

create or replace function wiseeff_repair_driver_placement_subject_cutover(
  target_subject_id text
) returns void
language plpgsql
as $$
declare
  target_source_key text;
  module_row record;
begin
  select asub.source_key
  into target_source_key
  from attribution_subjects asub
  inner join driver_registrations registration
    on registration.attribution_subject_id = asub.id
  where asub.id = target_subject_id
    and asub.organization_id is null
    and asub.subject_kind = 'driver-registration'
    and nullif(trim(asub.source_key), '') is not null
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

  for module_row in
    select
      module.id,
      module.organization_id,
      module.attribution_subject_id as previous_subject_id
    from parameter_modules module
    inner join attribution_subjects previous_subject
      on previous_subject.id = module.attribution_subject_id
     and previous_subject.subject_kind = 'driver-registration'
     and previous_subject.source_key = target_source_key
     and (
       previous_subject.organization_id is null
       or previous_subject.organization_id = module.organization_id
     )
    inner join driver_registrations previous_registration
      on previous_registration.attribution_subject_id = previous_subject.id
    where module.kind = 'driver-group'
      and module.origin = 'auto'
      and module.source_key = target_source_key
      and module.attribution_subject_id is distinct from target_subject_id
      and not exists (
        select 1
        from parameter_modules canonical_module
        where canonical_module.organization_id = module.organization_id
          and canonical_module.kind = 'driver-group'
          and canonical_module.attribution_subject_id = target_subject_id
          and canonical_module.id <> module.id
      )
    order by module.organization_id, module.id
    for update of module
  loop
    -- Serialize the unique (organization, subject) and
    -- (organization, module) placement identities before changing either side.
    perform 1
    from driver_registration_placements placement
    where placement.organization_id = module_row.organization_id
      and (
        placement.attribution_subject_id = target_subject_id
        or placement.driver_group_module_id = module_row.id
      )
    for update;

    -- A separately placed canonical module or a placement whose subject no
    -- longer agrees with the locked module is governance evidence, not a safe
    -- automatic cutover.
    if exists (
      select 1
      from driver_registration_placements target_placement
      where target_placement.organization_id = module_row.organization_id
        and target_placement.attribution_subject_id = target_subject_id
        and target_placement.driver_group_module_id <> module_row.id
    ) or exists (
      select 1
      from driver_registration_placements module_placement
      where module_placement.organization_id = module_row.organization_id
        and module_placement.driver_group_module_id = module_row.id
        and module_placement.attribution_subject_id not in (
          module_row.previous_subject_id,
          target_subject_id
        )
    ) then
      continue;
    end if;

    update parameter_modules module
    set attribution_subject_id = target_subject_id,
        updated_at = now()
    where module.id = module_row.id
      and module.organization_id = module_row.organization_id
      and module.kind = 'driver-group'
      and module.origin = 'auto'
      and module.source_key = target_source_key
      and module.attribution_subject_id = module_row.previous_subject_id;

    if not found then
      continue;
    end if;

    -- The placement guard reads the module's current subject, so update the
    -- module first and the retained placement second inside the same transaction.
    update driver_registration_placements placement
    set attribution_subject_id = target_subject_id,
        updated_at = now()
    where placement.organization_id = module_row.organization_id
      and placement.driver_group_module_id = module_row.id
      and placement.attribution_subject_id = module_row.previous_subject_id
      and not exists (
        select 1
        from driver_registration_placements target_placement
        where target_placement.organization_id = module_row.organization_id
          and target_placement.attribution_subject_id = target_subject_id
          and target_placement.id <> placement.id
      );
  end loop;
end;
$$;

-- Keep the repaired cutover rule active for later platform DriverSchema
-- materialization. The original 0127 ensure function remains the single module
-- and placement creator; this refresh wrapper only adopts a uniquely proven
-- retained auto module before that creator runs.
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
      perform wiseeff_repair_driver_placement_subject_cutover(subject_row.id);
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
    perform wiseeff_repair_driver_placement_subject_cutover(target_subject_id);
    perform wiseeff_ensure_effective_driver_placements_for_subject(target_subject_id);
  end if;
  return new;
end;
$$;

-- Apply the cutover immediately to canonical subjects retained by the
-- populated database, then let the 0127 creator insert any still-missing row.
do $$
declare
  subject_row record;
begin
  for subject_row in
    select asub.id
    from attribution_subjects asub
    where asub.organization_id is null
      and asub.subject_kind = 'driver-registration'
    order by asub.id
  loop
    perform wiseeff_repair_driver_placement_subject_cutover(subject_row.id);
    perform wiseeff_ensure_effective_driver_placements_for_subject(subject_row.id);
  end loop;
end;
$$;

-- 0127 could not move a recognized binding while the canonical placement was
-- still blocked by the source-key collision. Re-run the same collision-free
-- placement alignment after the subject cutover; bindings already using the
-- retained module id are naturally unchanged.
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

comment on function wiseeff_repair_driver_placement_subject_cutover(text) is
  'Issue #649 append-only repair: reattribute one uniquely keyed auto driver-group and its retained placement to the complete canonical platform DriverSchema subject.';
