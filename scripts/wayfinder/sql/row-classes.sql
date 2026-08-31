begin transaction isolation level repeatable read read only;
\pset format csv

with
version_counts as (
  select
    parameter_spec_id,
    count(*)::bigint as version_count,
    count(*) filter (where version_status = 'active')::bigint as active_version_count
  from parameter_spec_versions
  group by parameter_spec_id
),
binding_counts as (
  select parameter_spec_id, count(*)::bigint as binding_count
  from project_parameter_bindings
  group by parameter_spec_id
),
definition_classes as (
  select
    'parameter-spec'::text as family,
    concat_ws(';',
      'owner=' || case when ps.organization_id is null then 'platform' else 'organization' end,
      'source=' || case when ps.source_kind in ('dts', 'json', 'manual') then ps.source_kind else 'other' end,
      'lifecycle=' || case when ps.definition_lifecycle in ('draft', 'active', 'deprecated') then ps.definition_lifecycle else 'other' end,
      'subject=' || case
        when ps.attribution_subject_id is null then 'missing'
        when asub.subject_kind = 'driver-registration' then 'driver-registration'
        when asub.subject_kind = 'node-type-definition' then 'node-type-definition'
        when asub.id is null then 'dangling'
        else 'other'
      end,
      'property-row=' || case
        when dps.id is null then 'absent'
        when dps.driver_schema_id is null then 'present-unlinked'
        when ds.id is null then 'present-dangling-schema'
        else 'present-linked'
      end,
      'property-key=' || case
        when ps.property_key is null or btrim(ps.property_key) = '' then 'missing'
        when dps.id is null then 'present-no-property-row'
        when ps.property_key = dps.property_key then 'aligned'
        else 'misaligned'
      end,
      'schema-subject=' || case
        when dps.id is null or dps.driver_schema_id is null then 'not-applicable'
        when ds.attribution_subject_id is null then 'missing'
        when ps.attribution_subject_id = ds.attribution_subject_id then 'aligned'
        else 'misaligned'
      end,
      'schema-owner=' || case
        when ds.id is null then 'not-applicable'
        when ds.organization_id is null then 'platform'
        when ds.organization_id = ps.organization_id then 'same-organization'
        else 'cross-organization'
      end,
      'versions=' || case
        when coalesce(vc.version_count, 0) = 0 then 'zero'
        when vc.version_count = 1 then 'one'
        else 'many'
      end,
      'active-versions=' || case
        when coalesce(vc.active_version_count, 0) = 0 then 'zero'
        when vc.active_version_count = 1 then 'one'
        else 'many'
      end,
      'bindings=' || case
        when coalesce(bc.binding_count, 0) = 0 then 'zero'
        when bc.binding_count = 1 then 'one'
        else 'many'
      end
    ) as class_key,
    count(*)::bigint as row_count
  from parameter_specs ps
  left join attribution_subjects asub on asub.id = ps.attribution_subject_id
  left join dts_property_specs dps on dps.parameter_spec_id = ps.id
  left join driver_schemas ds on ds.id = dps.driver_schema_id
  left join version_counts vc on vc.parameter_spec_id = ps.id
  left join binding_counts bc on bc.parameter_spec_id = ps.id
  group by class_key
),
version_classes as (
  select
    'parameter-spec-version'::text as family,
    concat_ws(';',
      'definition-owner=' || case when ps.organization_id is null then 'platform' else 'organization' end,
      'definition-lifecycle=' || case when ps.definition_lifecycle in ('draft', 'active', 'deprecated') then ps.definition_lifecycle else 'other' end,
      'version-status=' || case when psv.version_status in ('draft', 'active', 'superseded') then psv.version_status else 'other' end,
      'legacy-lifecycle=' || case when psv.lifecycle in ('draft', 'active', 'deprecated') then psv.lifecycle else 'other' end,
      'value-shape-json=' || coalesce(jsonb_typeof(psv.value_shape), 'null'),
      'schema-default=' || case when psv.schema_default is null then 'absent' else 'present' end,
      'example-value=' || case when psv.example_value is null then 'absent' else 'present' end,
      'constraints=' || case when psv.constraints = '{}'::jsonb then 'empty' else 'present' end,
      'units=' || case when psv.units is null or btrim(psv.units) = '' then 'absent' else 'present' end,
      'documentation=' || case when psv.documentation is null or btrim(psv.documentation) = '' then 'absent' else 'present' end
    ) as class_key,
    count(*)::bigint as row_count
  from parameter_spec_versions psv
  inner join parameter_specs ps on ps.id = psv.parameter_spec_id
  group by class_key
),
subject_counts as (
  select
    asub.id,
    (select count(*) from parameter_specs ps where ps.attribution_subject_id = asub.id) as spec_count,
    (select count(*) from driver_schemas ds where ds.attribution_subject_id = asub.id) as schema_count,
    (select count(*) from parameter_modules pm where pm.attribution_subject_id = asub.id) as module_count,
    (select count(*) from driver_registration_placements drp where drp.attribution_subject_id = asub.id) as placement_count
  from attribution_subjects asub
),
subject_classes as (
  select
    'attribution-subject'::text as family,
    concat_ws(';',
      'owner=' || case when asub.organization_id is null then 'platform' else 'organization' end,
      'kind=' || case
        when asub.subject_kind in ('driver-registration', 'node-type-definition') then asub.subject_kind
        else 'other'
      end,
      'origin=' || case when asub.origin in ('curated', 'auto') then asub.origin else 'other' end,
      'source-family=' || case
        when lower(asub.source_key) like 'compatible:%' then 'compatible'
        when lower(asub.source_key) like 'nodetype:%' then 'node-type'
        when btrim(asub.source_key) = '' then 'blank'
        else 'other'
      end,
      'driver-child=' || case when dr.attribution_subject_id is null then 'absent' else 'present' end,
      'node-type-child=' || case when ntd.attribution_subject_id is null then 'absent' else 'present' end,
      'specs=' || case when sc.spec_count = 0 then 'zero' when sc.spec_count = 1 then 'one' else 'many' end,
      'schemas=' || case when sc.schema_count = 0 then 'zero' when sc.schema_count = 1 then 'one' else 'many' end,
      'modules=' || case when sc.module_count = 0 then 'zero' when sc.module_count = 1 then 'one' else 'many' end,
      'placements=' || case when sc.placement_count = 0 then 'zero' when sc.placement_count = 1 then 'one' else 'many' end
    ) as class_key,
    count(*)::bigint as row_count
  from attribution_subjects asub
  inner join subject_counts sc on sc.id = asub.id
  left join driver_registrations dr on dr.attribution_subject_id = asub.id
  left join node_type_definitions ntd on ntd.attribution_subject_id = asub.id
  group by class_key
),
schema_counts as (
  select
    ds.id,
    count(distinct dsv.id)::bigint as version_count,
    count(distinct dsv.id) filter (where dsv.lifecycle = 'active')::bigint as active_version_count,
    count(distinct dps.id)::bigint as property_count
  from driver_schemas ds
  left join driver_schema_versions dsv on dsv.driver_schema_id = ds.id
  left join dts_property_specs dps on dps.driver_schema_id = ds.id
  group by ds.id
),
schema_classes as (
  select
    'driver-schema'::text as family,
    concat_ws(';',
      'owner=' || case when ds.organization_id is null then 'platform' else 'organization' end,
      'subject=' || case
        when ds.attribution_subject_id is null then 'missing'
        when asub.subject_kind = 'driver-registration' then 'driver-registration'
        when asub.subject_kind = 'node-type-definition' then 'node-type-definition'
        when asub.id is null then 'dangling'
        else 'other'
      end,
      'subject-owner=' || case
        when asub.id is null then 'not-applicable'
        when asub.organization_id is null then 'platform'
        when asub.organization_id = ds.organization_id then 'same-organization'
        else 'cross-organization'
      end,
      'root-spec-owner=' || case
        when root_spec.id is null then 'dangling'
        when root_spec.organization_id is null then 'platform'
        when root_spec.organization_id = ds.organization_id then 'same-organization'
        else 'cross-organization'
      end,
      'root-spec-subject=' || case
        when root_spec.id is null then 'dangling'
        when root_spec.attribution_subject_id is null then 'missing'
        when root_spec.attribution_subject_id = ds.attribution_subject_id then 'aligned'
        else 'misaligned'
      end,
      'versions=' || case when sc.version_count = 0 then 'zero' when sc.version_count = 1 then 'one' else 'many' end,
      'active-versions=' || case when sc.active_version_count = 0 then 'zero' when sc.active_version_count = 1 then 'one' else 'many' end,
      'properties=' || case when sc.property_count = 0 then 'zero' when sc.property_count = 1 then 'one' else 'many' end
    ) as class_key,
    count(*)::bigint as row_count
  from driver_schemas ds
  inner join schema_counts sc on sc.id = ds.id
  left join attribution_subjects asub on asub.id = ds.attribution_subject_id
  left join parameter_specs root_spec on root_spec.id = ds.parameter_spec_id
  group by class_key
),
module_classes as (
  select
    'parameter-module'::text as family,
    concat_ws(';',
      'kind=' || case when pm.kind in ('business', 'driver-group', 'node-type', 'unclassified') then pm.kind else 'other' end,
      'origin=' || case when pm.origin in ('curated', 'auto') then pm.origin else 'other' end,
      'subject=' || case
        when pm.attribution_subject_id is null then 'missing'
        when asub.subject_kind = 'driver-registration' then 'driver-registration'
        when asub.subject_kind = 'node-type-definition' then 'node-type-definition'
        when asub.id is null then 'dangling'
        else 'other'
      end,
      'subject-owner=' || case
        when asub.id is null then 'not-applicable'
        when asub.organization_id is null then 'platform'
        when asub.organization_id = pm.organization_id then 'same-organization'
        else 'cross-organization'
      end,
      'parent=' || case
        when pm.parent_id is null then 'root'
        when parent.id is null then 'dangling'
        when parent.kind in ('business', 'driver-group', 'node-type', 'unclassified') then parent.kind
        else 'other'
      end,
      'mappings=' || case
        when not exists (select 1 from parameter_module_mappings pmm where pmm.parameter_module_id = pm.id) then 'zero'
        when (select count(*) from parameter_module_mappings pmm where pmm.parameter_module_id = pm.id) = 1 then 'one'
        else 'many'
      end,
      'bindings=' || case
        when not exists (select 1 from project_parameter_bindings ppb where ppb.module_id = pm.id) then 'zero'
        when (select count(*) from project_parameter_bindings ppb where ppb.module_id = pm.id) = 1 then 'one'
        else 'many'
      end
    ) as class_key,
    count(*)::bigint as row_count
  from parameter_modules pm
  left join parameter_modules parent on parent.id = pm.parent_id
  left join attribution_subjects asub on asub.id = pm.attribution_subject_id
  group by class_key
),
binding_classes as (
  select
    'project-parameter-binding'::text as family,
    concat_ws(';',
      'spec-owner=' || case
        when ps.id is null then 'dangling'
        when ps.organization_id is null then 'platform'
        when ps.organization_id = ppb.organization_id then 'same-organization'
        else 'cross-organization'
      end,
      'spec-lifecycle=' || case
        when ps.definition_lifecycle in ('draft', 'active', 'deprecated') then ps.definition_lifecycle
        when ps.id is null then 'dangling'
        else 'other'
      end,
      'subject=' || case
        when ps.attribution_subject_id is null then 'missing'
        when asub.subject_kind = 'driver-registration' then 'driver-registration'
        when asub.subject_kind = 'node-type-definition' then 'node-type-definition'
        when asub.id is null then 'dangling'
        else 'other'
      end,
      'module=' || case
        when pm.id is null then 'dangling'
        when pm.kind in ('business', 'driver-group', 'node-type', 'unclassified') then pm.kind
        else 'other'
      end,
      'module-subject=' || case
        when pm.id is null then 'dangling'
        when ps.attribution_subject_id is null or pm.attribution_subject_id is null then 'missing'
        when ps.attribution_subject_id = pm.attribution_subject_id then 'aligned'
        else 'misaligned'
      end,
      'logical-node=' || case when ppb.logical_node_id is null then 'absent' else 'present' end,
      'revisions=' || case
        when not exists (select 1 from project_parameter_binding_revisions ppbr where ppbr.binding_id = ppb.id) then 'zero'
        when (select count(*) from project_parameter_binding_revisions ppbr where ppbr.binding_id = ppb.id) = 1 then 'one'
        else 'many'
      end
    ) as class_key,
    count(*)::bigint as row_count
  from project_parameter_bindings ppb
  left join parameter_specs ps on ps.id = ppb.parameter_spec_id
  left join attribution_subjects asub on asub.id = ps.attribution_subject_id
  left join parameter_modules pm on pm.id = ppb.module_id
  group by class_key
),
workflow_classes as (
  select
    'parameter-draft'::text as family,
    concat_ws(';',
      'origin=' || case when origin in ('manual', 'file-sync', 'agent', 'debug-promotion') then origin else 'other' end,
      'action=' || case when action in ('set', 'delete') then action else 'other' end,
      'subject=' || case when edit_subject_kind in ('parameter-binding', 'node-enablement') then edit_subject_kind else 'other' end,
      'binding=' || case when project_parameter_binding_id is null then 'absent' else 'present' end,
      'candidate-revision=' || case when candidate_config_revision_id is null then 'absent' else 'present' end,
      'initiator=' || case
        when not (to_jsonb(pd) ? 'initiator_type') then 'column-absent'
        when to_jsonb(pd)->>'initiator_type' in ('user', 'agent', 'system', 'legacy')
          then to_jsonb(pd)->>'initiator_type'
        else 'other'
      end
    ) as class_key,
    count(*)::bigint as row_count
  from parameter_drafts pd
  group by class_key

  union all

  select
    'parameter-change-request'::text as family,
    concat_ws(';',
      'status=' || case
        when status in ('merged', 'rejected', 'withdrawn') then 'terminal'
        else 'open-or-other'
      end,
      'action=' || case when action in ('set', 'delete') then action else 'other' end,
      'subject=' || case when edit_subject_kind in ('parameter-binding', 'node-enablement') then edit_subject_kind else 'other' end,
      'spec=' || case when parameter_spec_id is null then 'absent' else 'present' end,
      'binding=' || case when project_parameter_binding_id is null then 'absent' else 'present' end,
      'candidate-revision=' || case when candidate_config_revision_id is null then 'absent' else 'present' end,
      'initiator=' || case
        when not (to_jsonb(pcr) ? 'initiator_type') then 'column-absent'
        when to_jsonb(pcr)->>'initiator_type' in ('user', 'agent', 'system', 'legacy')
          then to_jsonb(pcr)->>'initiator_type'
        else 'other'
      end
    ) as class_key,
    count(*)::bigint as row_count
  from parameter_change_requests pcr
  group by class_key

  union all

  select
    'parameter-history-entry'::text as family,
    concat_ws(';',
      'spec=' || case when parameter_spec_id is null then 'absent' else 'present' end,
      'binding=' || case when project_parameter_binding_id is null then 'absent' else 'present' end,
      'request=' || case when request_id is null then 'absent' else 'present' end,
      'logical-node=' || case when logical_node_id is null then 'absent' else 'present' end,
      'initiator=' || case
        when not (to_jsonb(phe) ? 'initiator_type') then 'column-absent'
        when to_jsonb(phe)->>'initiator_type' in ('user', 'agent', 'system', 'legacy')
          then to_jsonb(phe)->>'initiator_type'
        else 'other'
      end
    ) as class_key,
    count(*)::bigint as row_count
  from parameter_history_entries phe
  group by class_key
),
overlay_classes as (
  select
    'driver-schema-overlay'::text as family,
    concat_ws(';',
      'owner=' || case when dso.organization_id is null then 'platform' else 'organization' end,
      'lifecycle=' || case when dso.lifecycle in ('draft', 'active', 'deprecated', 'superseded') then dso.lifecycle else 'other' end,
      'superseded-by=' || case when dso.superseded_by_schema_id is null then 'absent' else 'present' end,
      'properties=' || case
        when not exists (select 1 from driver_schema_overlay_properties dsop where dsop.driver_schema_overlay_id = dso.id) then 'zero'
        when (select count(*) from driver_schema_overlay_properties dsop where dsop.driver_schema_overlay_id = dso.id) = 1 then 'one'
        else 'many'
      end
    ) as class_key,
    count(*)::bigint as row_count
  from driver_schema_overlays dso
  group by class_key
)
select family, class_key, sum(row_count)::bigint as row_count
from (
  select * from definition_classes
  union all select * from version_classes
  union all select * from subject_classes
  union all select * from schema_classes
  union all select * from module_classes
  union all select * from binding_classes
  union all select * from workflow_classes
  union all select * from overlay_classes
) classes
group by family, class_key
order by family, class_key;

commit;
