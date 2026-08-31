-- Fail the import unless the deterministic populated graph is complete.
do $$
declare
  actual bigint;
begin
  select count(*) into actual from wayfinder_rehearsal.fixture_cases;
  if actual <> 9 then
    raise exception 'Wayfinder fixture case registry: expected 9 rows, got %', actual;
  end if;

  select count(*) into actual
  from (
    select name, checksum from schema_migrations
    except
    select name, checksum from wayfinder_rehearsal.migration_inventory
  ) unexpected;
  if actual <> 0 then
    raise exception 'Wayfinder migration ledger has % unexpected rows', actual;
  end if;

  select count(*) into actual
  from (
    select name, checksum from wayfinder_rehearsal.migration_inventory
    except
    select name, checksum from schema_migrations
  ) missing;
  if actual <> 0 then
    raise exception 'Wayfinder migration ledger is missing % rows', actual;
  end if;

  select count(*) into actual from parameter_specs;
  if actual <> 6 then
    raise exception 'Wayfinder parameter specs: expected 6 rows, got %', actual;
  end if;

  select count(*) into actual from parameter_spec_versions;
  if actual <> 6 then
    raise exception 'Wayfinder parameter spec versions: expected 6 rows, got %', actual;
  end if;

  select count(*) into actual
  from parameter_specs ps
  join dts_property_specs dps on dps.parameter_spec_id = ps.id
  where ps.source_kind = 'dts'
    and ps.definition_lifecycle = 'active'
    and ps.attribution_subject_id is not null
    and dps.driver_schema_id is not null;
  if actual <> 2 then
    raise exception 'Wayfinder formal definitions: expected 2 rows, got %', actual;
  end if;

  select count(*) into actual
  from parameter_specs ps
  join attribution_subjects subject on subject.id = ps.attribution_subject_id
  join driver_registrations registration
    on registration.attribution_subject_id = subject.id
  join dts_property_specs dps on dps.parameter_spec_id = ps.id
  join driver_schemas ds
    on ds.id = dps.driver_schema_id
   and ds.attribution_subject_id = subject.id
  where ps.organization_id is null
    and ps.definition_lifecycle = 'active'
    and subject.subject_kind = 'driver-registration';
  if actual <> 1 then
    raise exception 'Wayfinder formal Platform Driver definitions: expected 1 row, got %', actual;
  end if;

  select count(*) into actual
  from parameter_specs ps
  join attribution_subjects subject on subject.id = ps.attribution_subject_id
  join node_type_definitions node_type
    on node_type.attribution_subject_id = subject.id
  join dts_property_specs dps on dps.parameter_spec_id = ps.id
  join driver_schemas ds
    on ds.id = dps.driver_schema_id
   and ds.attribution_subject_id = subject.id
  where ps.organization_id is null
    and ps.definition_lifecycle = 'active'
    and subject.subject_kind = 'node-type-definition';
  if actual <> 1 then
    raise exception 'Wayfinder formal Platform NodeType definitions: expected 1 row, got %', actual;
  end if;

  select count(*) into actual
  from parameter_specs ps
  join dts_property_specs dps on dps.parameter_spec_id = ps.id
  where ps.source_kind = 'dts'
    and ps.definition_lifecycle = 'draft'
    and ps.organization_id is null
    and ps.attribution_subject_id is null
    and dps.driver_schema_id is null;
  if actual <> 1 then
    raise exception 'Wayfinder subjectless DTS drafts: expected 1 row, got %', actual;
  end if;

  select count(*) into actual
  from parameter_specs ps
  join attribution_subjects subject on subject.id = ps.attribution_subject_id
  join node_type_definitions node_type
    on node_type.attribution_subject_id = subject.id
  join dts_property_specs dps on dps.parameter_spec_id = ps.id
  where ps.source_kind = 'manual'
    and ps.definition_lifecycle = 'draft'
    and ps.organization_id = 'wf671-org'
    and subject.organization_id = 'wf671-org'
    and subject.subject_kind = 'node-type-definition'
    and dps.driver_schema_id is null;
  if actual <> 1 then
    raise exception 'Wayfinder organization NodeType drafts: expected 1 row, got %', actual;
  end if;

  select count(*) into actual
  from driver_schemas ds
  join parameter_specs ps on ps.id = ds.parameter_spec_id
  where ps.property_key is null;
  if actual <> 2 then
    raise exception 'Wayfinder schema roots: expected 2 rows, got %', actual;
  end if;

  select count(*) into actual from driver_registration_placements;
  if actual <> 1 then
    raise exception 'Wayfinder driver placements: expected 1 row, got %', actual;
  end if;

  select count(*) into actual from parameter_modules;
  if actual <> 3 then
    raise exception 'Wayfinder parameter modules: expected 3 rows, got %', actual;
  end if;

  select count(*) into actual from parameter_module_mappings;
  if actual <> 2 then
    raise exception 'Wayfinder module mappings: expected 2 rows, got %', actual;
  end if;

  select count(*) into actual
  from project_parameter_bindings ppb
  join parameter_specs ps on ps.id = ppb.parameter_spec_id
  join parameter_modules pm on pm.id = ppb.module_id
  where pm.attribution_subject_id is distinct from ps.attribution_subject_id;
  if actual <> 1 then
    raise exception 'Wayfinder binding/module identity mismatches: expected 1 row, got %', actual;
  end if;

  select count(*) into actual
  from project_parameter_bindings ppb
  join parameter_specs ps on ps.id = ppb.parameter_spec_id
  where ps.definition_lifecycle <> 'active';
  if actual <> 1 then
    raise exception 'Wayfinder inactive-definition bindings: expected 1 row, got %', actual;
  end if;

  select count(*) into actual
  from project_parameter_binding_revisions pbr
  join project_parameter_bindings pb on pb.id = pbr.binding_id
  join parameter_spec_versions psv on psv.id = pbr.parameter_spec_version_id
  where psv.parameter_spec_id = pb.parameter_spec_id;
  if actual <> 3 then
    raise exception 'Wayfinder pinned binding revisions: expected 3 rows, got %', actual;
  end if;

  select count(*) into actual
  from users
  where id like 'wf671-%'
     or email like '%@example.invalid';
  if actual <> 0 then
    raise exception 'Wayfinder fixture must not create users, got %', actual;
  end if;
end
$$;
