begin transaction isolation level repeatable read read only;
\pset format csv

with metrics as (
  select 'violation'::text as metric_kind,
         'active-dts-property-missing-subject'::text as metric_name,
         count(*)::bigint as row_count,
         'expected-zero'::text as expectation
  from parameter_specs ps
  inner join dts_property_specs dps on dps.parameter_spec_id = ps.id
  where ps.source_kind = 'dts'
    and ps.definition_lifecycle = 'active'
    and ps.attribution_subject_id is null

  union all
  select 'violation', 'active-dts-property-missing-property-key', count(*)::bigint, 'expected-zero'
  from parameter_specs ps
  inner join dts_property_specs dps on dps.parameter_spec_id = ps.id
  where ps.source_kind = 'dts'
    and ps.definition_lifecycle = 'active'
    and (ps.property_key is null or btrim(ps.property_key) = '')

  union all
  select 'violation', 'linked-property-subject-mismatch', count(*)::bigint, 'expected-zero'
  from parameter_specs ps
  inner join dts_property_specs dps on dps.parameter_spec_id = ps.id
  inner join driver_schemas ds on ds.id = dps.driver_schema_id
  where ps.attribution_subject_id is distinct from ds.attribution_subject_id

  union all
  select 'violation', 'linked-property-schema-owner-cross-organization', count(*)::bigint, 'expected-zero'
  from parameter_specs ps
  inner join dts_property_specs dps on dps.parameter_spec_id = ps.id
  inner join driver_schemas ds on ds.id = dps.driver_schema_id
  where ds.organization_id is not null
    and ds.organization_id is distinct from ps.organization_id

  union all
  select 'violation', 'duplicate-definition-identity-groups', count(*)::bigint, 'expected-zero'
  from (
    select organization_id, attribution_subject_id, property_key
    from parameter_specs
    where attribution_subject_id is not null
      and property_key is not null
    group by organization_id, attribution_subject_id, property_key
    having count(*) > 1
  ) duplicates

  union all
  select 'violation', 'multiple-active-versions-per-definition', count(*)::bigint, 'expected-zero'
  from (
    select parameter_spec_id
    from parameter_spec_versions
    where version_status = 'active'
    group by parameter_spec_id
    having count(*) > 1
  ) duplicates

  union all
  select 'violation', 'active-definition-without-one-active-version', count(*)::bigint, 'expected-zero'
  from parameter_specs ps
  where ps.definition_lifecycle = 'active'
    and (select count(*) from parameter_spec_versions psv where psv.parameter_spec_id = ps.id and psv.version_status = 'active') <> 1

  union all
  select 'violation', 'driver-subject-missing-registration-child', count(*)::bigint, 'expected-zero'
  from attribution_subjects asub
  left join driver_registrations dr on dr.attribution_subject_id = asub.id
  where asub.subject_kind = 'driver-registration'
    and dr.attribution_subject_id is null

  union all
  select 'violation', 'node-type-subject-missing-definition-child', count(*)::bigint, 'expected-zero'
  from attribution_subjects asub
  left join node_type_definitions ntd on ntd.attribution_subject_id = asub.id
  where asub.subject_kind = 'node-type-definition'
    and ntd.attribution_subject_id is null

  union all
  select 'violation', 'blank-node-type-name', count(*)::bigint, 'expected-zero'
  from node_type_definitions
  where btrim(bare_node_name) = ''

  union all
  select 'violation', 'driver-schema-missing-subject', count(*)::bigint, 'expected-zero'
  from driver_schemas
  where attribution_subject_id is null

  union all
  select 'violation', 'driver-schema-root-owner-mismatch', count(*)::bigint, 'expected-zero'
  from driver_schemas ds
  inner join parameter_specs ps on ps.id = ds.parameter_spec_id
  where ds.organization_id is distinct from ps.organization_id

  union all
  select 'violation', 'placement-subject-or-module-mismatch', count(*)::bigint, 'expected-zero'
  from driver_registration_placements drp
  left join parameter_modules pm on pm.id = drp.driver_group_module_id
  left join attribution_subjects asub on asub.id = drp.attribution_subject_id
  where pm.id is null
     or asub.id is null
     or pm.organization_id <> drp.organization_id
     or pm.kind <> 'driver-group'
     or pm.attribution_subject_id is distinct from drp.attribution_subject_id
     or asub.subject_kind <> 'driver-registration'
     or (asub.organization_id is not null and asub.organization_id <> drp.organization_id)

  union all
  select 'violation', 'duplicate-placement-groups', count(*)::bigint, 'expected-zero'
  from (
    select organization_id, attribution_subject_id
    from driver_registration_placements
    group by organization_id, attribution_subject_id
    having count(*) > 1
  ) duplicates

  union all
  select 'violation', 'ready-platform-driver-missing-organization-placement', count(*)::bigint, 'expected-zero'
  from organizations org
  cross join attribution_subjects asub
  where asub.organization_id is null
    and asub.subject_kind = 'driver-registration'
    and exists (
      select 1
      from parameter_specs ps
      inner join dts_property_specs dps on dps.parameter_spec_id = ps.id
      inner join driver_schemas ds
        on ds.id = dps.driver_schema_id
       and ds.attribution_subject_id = ps.attribution_subject_id
      where ps.organization_id is null
        and ps.source_kind = 'dts'
        and ps.definition_lifecycle = 'active'
        and ps.attribution_subject_id = asub.id
        and exists (
          select 1 from parameter_spec_versions psv
          where psv.parameter_spec_id = ps.id and psv.version_status = 'active'
        )
        and exists (
          select 1 from driver_schema_versions dsv
          where dsv.driver_schema_id = ds.id and dsv.lifecycle = 'active'
        )
    )
    and not exists (
      select 1 from driver_registration_placements drp
      where drp.organization_id = org.id
        and drp.attribution_subject_id = asub.id
    )

  union all
  select 'violation', 'binding-owner-mismatch', count(*)::bigint, 'expected-zero'
  from project_parameter_bindings ppb
  inner join projects p on p.id = ppb.project_id
  where ppb.organization_id <> p.organization_id

  union all
  select 'diagnostic', 'binding-definition-not-active', count(*)::bigint, 'migration-input'
  from project_parameter_bindings ppb
  inner join parameter_specs ps on ps.id = ppb.parameter_spec_id
  where ps.definition_lifecycle <> 'active'

  union all
  select 'violation', 'binding-module-subject-mismatch', count(*)::bigint, 'expected-zero'
  from project_parameter_bindings ppb
  inner join parameter_specs ps on ps.id = ppb.parameter_spec_id
  inner join parameter_modules pm on pm.id = ppb.module_id
  where ps.attribution_subject_id is not null
    and pm.attribution_subject_id is distinct from ps.attribution_subject_id

  union all
  select 'violation', 'binding-revision-version-owner-mismatch', count(*)::bigint, 'expected-zero'
  from project_parameter_binding_revisions ppbr
  inner join project_parameter_bindings ppb on ppb.id = ppbr.binding_id
  inner join parameter_spec_versions psv on psv.id = ppbr.parameter_spec_version_id
  where psv.parameter_spec_id <> ppb.parameter_spec_id

  union all
  select 'diagnostic', 'open-parameter-spec-review-tasks', count(*)::bigint, 'migration-input'
  from parameter_spec_review_tasks
  where status = 'open'

  union all
  select 'diagnostic', 'open-identity-mapping-tasks', count(*)::bigint, 'migration-input'
  from identity_mapping_tasks
  where status = 'open'

  union all
  select 'diagnostic', 'legacy-migration-evidence-rows', count(*)::bigint, 'migration-input'
  from legacy_parameter_migration_evidence

  union all
  select 'violation', 'schema-migration-missing-checksum', count(*)::bigint, 'expected-zero'
  from schema_migrations
  where checksum is null or btrim(checksum) = ''
)
select metric_kind, metric_name, row_count, expectation
from metrics
order by metric_kind, metric_name;

commit;
