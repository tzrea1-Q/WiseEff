-- Reviewed DTS V2 member-removal invariants. Existing JSON V1 behavior,
-- deferred trigger, owner, search path and EXECUTE policy are retained.
-- Revision-specific DTS IDs are paired by exact native geometry, not reused.
create or replace function parameter_catalog.assert_member_removal_tombstone()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog, public as $$
declare
  removed_bindings jsonb;
  surviving_bindings jsonb;
  surviving_count integer;
  review_request public.project_parameter_value_change_requests%rowtype;
  version_two boolean := false;
  graph_ok boolean;
  pair_ok boolean;
  survivor record;
  next_node_id text;
  next_property_id text;
  next_logical_revision_id text;
  next_effect_id text;
begin
  if not exists (
    select 1 from public.project_parameter_files file
    join public.dts_config_revisions revision
      on revision.id=new.config_revision_id
     and revision.organization_id=new.organization_id
     and revision.project_id=new.project_id
     and revision.config_set_id=new.config_set_id
    where file.id=new.file_id and file.organization_id=new.organization_id
      and file.project_id=new.project_id and file.config_set_id is null
      and file.current_version_id=new.file_version_id
  ) then
    raise exception using errcode='23514', message='Removed member must retain its exact historical revision and file version';
  end if;
  if not exists (
    select 1 from public.audit_events audit
    where audit.id=new.audit_event_id and audit.organization_id=new.organization_id
      and audit.project_id=new.project_id and audit.actor_type='user'
      and audit.kind='parameter-topology-governance'
      and audit.action='source-member-removed'
      and audit.target_type='project-parameter-file' and audit.target_id=new.file_id
      and audit.metadata->>'tombstoneId'=new.id
      and audit.metadata->>'configSetId'=new.config_set_id
      and audit.metadata->>'configRevisionId'=new.config_revision_id
      and audit.metadata->>'fileVersionId'=new.file_version_id
      and audit.metadata->'bindings'=new.binding_manifest
      and (new.successor_config_revision_id is null or
        (audit.metadata->>'successorConfigRevisionId'=new.successor_config_revision_id
         and audit.metadata->'successorBindings'=new.successor_binding_manifest))
  ) then
    raise exception using errcode='23514', message='Member removal has no exact user audit receipt';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'bindingId',binding.id,'valueId',value.id,'sourcePinId',pin.id
  ) order by binding.id),'[]'::jsonb) into removed_bindings
  from parameter_catalog.project_parameter_bindings binding
  join parameter_catalog.project_parameter_source_occurrences occurrence
    on occurrence.id=binding.source_occurrence_id
  join parameter_catalog.project_parameter_values value
    on value.id=binding.current_value_id and value.binding_id=binding.id
  join parameter_catalog.project_value_source_pins pin
    on pin.project_value_id=value.id and pin.binding_id=binding.id
   and pin.source_occurrence_id=occurrence.id
  where binding.organization_id=new.organization_id and binding.project_id=new.project_id
    and occurrence.config_set_id=new.config_set_id and occurrence.file_id=new.file_id
    and value.value_state='present'
    and pin.locator->>'kind' not in ('dts-delete','json-delete')
    and not exists (
      select 1 from parameter_catalog.definition_replacement_projects replacement
      where replacement.status='completed' and replacement.old_binding_id=binding.id
    )
    and pin.config_revision_id=new.config_revision_id and pin.file_version_id=new.file_version_id;
  if not exists (
       select 1 from parameter_catalog.project_parameter_source_occurrences occurrence
       where occurrence.organization_id=new.organization_id and occurrence.project_id=new.project_id
         and occurrence.config_set_id=new.config_set_id and occurrence.file_id=new.file_id
     ) or removed_bindings is distinct from new.binding_manifest
     or exists (
       select 1 from parameter_catalog.project_parameter_bindings binding
       join parameter_catalog.project_parameter_source_occurrences occurrence
         on occurrence.id=binding.source_occurrence_id
       join parameter_catalog.project_parameter_values value
         on value.id=binding.current_value_id and value.binding_id=binding.id
       where binding.organization_id=new.organization_id and binding.project_id=new.project_id
         and occurrence.config_set_id=new.config_set_id and occurrence.file_id=new.file_id
         and value.value_state='present'
         and not exists (
           select 1 from parameter_catalog.definition_replacement_projects replacement
           where replacement.status='completed' and replacement.old_binding_id=binding.id
         )
         and not exists (
           select 1 from parameter_catalog.project_value_source_pins pin
           where pin.project_value_id=binding.current_value_id and pin.binding_id=binding.id
             and pin.config_revision_id=new.config_revision_id and pin.file_version_id=new.file_version_id
             and pin.locator->>'kind' not in ('dts-delete','json-delete')
         )
     ) then
    raise exception using errcode='23514', message='Member removal must cover the exact source cohort';
  end if;

  select count(*) into surviving_count
  from parameter_catalog.current_project_parameter_bindings binding
  join parameter_catalog.project_parameter_source_occurrences occurrence
    on occurrence.id=binding.source_occurrence_id
  where binding.organization_id=new.organization_id and binding.project_id=new.project_id
    and occurrence.config_set_id=new.config_set_id and occurrence.file_id<>new.file_id;
  -- V2 authority is read at deferred COMMIT, after the pending CAS and
  -- audited insertion have completed. Legacy JSON V1 remains its original body.
  select request.* into review_request
  from public.project_parameter_value_change_requests request
  join public.audit_events audit on audit.metadata->>'reviewRequestId'=request.id
  where audit.id=new.audit_event_id;
  if review_request.member_frozen_proof ? 'proofVersion'
     or review_request.member_frozen_proof ? 'format' then
    if review_request.member_frozen_proof->'proofVersion' is distinct from '2'::jsonb
       or review_request.member_frozen_proof->>'format' is distinct from 'dts'
       or review_request.member_frozen_proof->>'kind' is distinct from 'canonical-member-removal'
       or review_request.member_frozen_proof->>'proofDigest' is distinct from review_request.member_proof_digest
       or review_request.request_kind is distinct from 'member-removal'
       or review_request.status is distinct from 'approved'
       or review_request.organization_id is distinct from new.organization_id
       or review_request.project_id is distinct from new.project_id
       or review_request.member_config_set_id is distinct from new.config_set_id
       or review_request.member_file_id is distinct from new.file_id
       or review_request.member_file_version_id is distinct from new.file_version_id
       or review_request.member_frozen_proof->>'configRevisionId' is distinct from new.config_revision_id
       or review_request.reviewer_user_id is distinct from review_request.assigned_to_user_id
       or review_request.submitter_user_id is null
       or review_request.reviewer_user_id is null
       or review_request.submitter_user_id=review_request.reviewer_user_id
       or review_request.applied_audit_ref is distinct from new.audit_event_id
       or review_request.applied_source_result is distinct from jsonb_build_object(
         'tombstoneId',new.id,'successorConfigRevisionId',new.successor_config_revision_id)
       or not exists (select 1 from public.audit_events audit
         where audit.id=new.audit_event_id and audit.actor_user_id=review_request.reviewer_user_id
           and audit.metadata->>'proofDigest'=review_request.member_proof_digest)
       or not exists (select 1 from public.project_parameter_files file
         where file.id=new.file_id and file.format='dts')
       or jsonb_typeof(review_request.member_frozen_proof->'cohort') is distinct from 'array'
       or new.successor_config_revision_id is null or surviving_count=0 then
      raise exception using errcode='23514', message='DTS member removal requires the exact approved V2 authority';
    end if;
    version_two := true;
  end if;

  if new.successor_config_revision_id is null then
    if surviving_count <> 0 then
      raise exception using errcode='23514', message='Member removal must cover the exact source cohort';
    end if;
    return null;
  end if;

  if not exists (
    select 1 from public.dts_config_revisions revision
    where revision.id=new.successor_config_revision_id
      and revision.organization_id=new.organization_id and revision.project_id=new.project_id
      and revision.config_set_id=new.config_set_id and revision.status='resolved'
  ) or exists (
    select 1 from public.dts_config_revision_members old_member
    where old_member.config_revision_id=new.config_revision_id and old_member.file_id<>new.file_id
      and not exists (
        select 1 from public.dts_config_revision_members successor
        where successor.config_revision_id=new.successor_config_revision_id
          and successor.file_id=old_member.file_id
          and successor.file_version_id=old_member.file_version_id
          and successor.source_name=old_member.source_name
          and successor.role=old_member.role and successor.sort_order=old_member.sort_order
      )
  ) or exists (
    select 1 from public.dts_config_revision_members successor
    where successor.config_revision_id=new.successor_config_revision_id
      and not exists (
        select 1 from public.dts_config_revision_members old_member
        where old_member.config_revision_id=new.config_revision_id
          and old_member.file_id<>new.file_id
          and old_member.file_id=successor.file_id
          and old_member.file_version_id=successor.file_version_id
          and old_member.source_name=successor.source_name
          and old_member.role=successor.role and old_member.sort_order=successor.sort_order
      )
  ) or exists (
    select 1 from public.project_parameter_files file
    where file.organization_id=new.organization_id and file.project_id=new.project_id
      and file.config_set_id=new.config_set_id
      and not exists (
        select 1 from public.dts_config_revision_members member
        where member.config_revision_id=new.successor_config_revision_id
          and member.file_id=file.id and member.file_version_id=file.current_version_id
          and member.role=file.config_set_role and member.sort_order=file.config_set_sort_order
      )
  ) then
    raise exception using errcode='23514', message='Member removal successor differs from the exact surviving files';
  end if;

  if version_two then
    WITH input AS (
     SELECT request.*, request.member_frozen_proof->>'configRevisionId' old_revision_id,
            new.successor_config_revision_id::text new_revision_id
     FROM public.project_parameter_value_change_requests request WHERE request.id=review_request.id
    ), revisions AS (
     SELECT 'old' phase,old_revision_id id FROM input UNION ALL
     SELECT 'new',new_revision_id FROM input
    ), effective AS (
     SELECT revisions.phase, logical_revision.logical_node_id, member.file_id,
            property.file_version_id, property.property_name, property.id property_id, node.id node_id,
            jsonb_build_object(
          'property',jsonb_build_object('name',property.property_name,
            'fileVersionId',property.file_version_id,
            'span',jsonb_build_array(property.start_offset,property.end_offset,property.start_line,
              property.start_column,property.end_line,property.end_column),
            'rawText',property.raw_text,'ast',property.ast_json,'contentHash',property.content_hash),
          'node',jsonb_build_object('fileVersionId',node.file_version_id,'path',node.node_path,
            'name',node.name,'unitAddress',node.unit_address,'labels',node.labels,
            'refTarget',node.ref_target,'overlayRoot',node.is_overlay_root,
            'span',jsonb_build_array(node.start_offset,node.end_offset,node.start_line,
              node.start_column,node.end_line,node.end_column),
            'rawText',node.raw_text,'ast',node.ast_json,'contentHash',node.content_hash),
          'parent',CASE WHEN node.parent_occurrence_id IS NULL THEN 'null'::jsonb ELSE
            jsonb_build_object('fileVersionId',parent.file_version_id,'path',parent.node_path,
              'name',parent.name,'unitAddress',parent.unit_address,'labels',parent.labels,
              'refTarget',parent.ref_target,'overlayRoot',parent.is_overlay_root,
              'span',jsonb_build_array(parent.start_offset,parent.end_offset,parent.start_line,
                parent.start_column,parent.end_line,parent.end_column),
              'rawText',parent.raw_text,'ast',parent.ast_json,'contentHash',parent.content_hash) END,
          'logical',jsonb_build_object('logicalNodeId',logical_revision.logical_node_id,
            'locator',logical_revision.node_locator,'name',logical_revision.name,
            'unitAddress',logical_revision.unit_address,'compatible',logical_revision.compatible,
            'driverSchemaVersionId',logical_revision.driver_schema_version_id,
            'parentLogicalNodeId',logical_revision.parent_logical_node_id)
        ) AS geometry
     FROM revisions
     JOIN public.dts_occurrence_effects effect ON effect.config_revision_id=revisions.id
     JOIN public.dts_logical_node_revisions logical_revision
       ON logical_revision.id=effect.logical_node_revision_id AND logical_revision.config_revision_id=revisions.id
     JOIN public.dts_property_occurrences property ON property.id=effect.property_occurrence_id
       AND property.config_revision_id=revisions.id AND property.property_name=effect.property_name
     JOIN public.dts_node_occurrences node ON node.id=property.node_occurrence_id
       AND node.id=effect.node_occurrence_id AND node.config_revision_id=revisions.id
       AND node.file_version_id=property.file_version_id
     LEFT JOIN public.dts_node_occurrences parent ON parent.id=node.parent_occurrence_id
       AND parent.config_revision_id=revisions.id AND parent.file_version_id=node.file_version_id
     JOIN public.dts_config_revision_members member ON member.config_revision_id=revisions.id
       AND member.file_version_id=property.file_version_id
     JOIN public.project_parameter_file_versions version ON version.id=property.file_version_id AND version.file_id=member.file_id
     JOIN input ON TRUE
     JOIN public.project_parameter_files file ON file.id=member.file_id AND file.organization_id=input.organization_id AND file.project_id=input.project_id
     JOIN public.dts_logical_nodes logical_node ON logical_node.id=logical_revision.logical_node_id
       AND logical_node.organization_id=input.organization_id AND logical_node.project_id=input.project_id
       AND logical_node.config_set_id=input.member_config_set_id
     WHERE effect.effect_kind IN ('set','override')
       AND (node.parent_occurrence_id IS NULL OR parent.id IS NOT NULL)
       AND NOT EXISTS(SELECT 1 FROM public.dts_occurrence_effects later
         WHERE later.config_revision_id=revisions.id
           AND later.logical_node_revision_id=effect.logical_node_revision_id
           AND later.property_name=effect.property_name AND later.source_order>effect.source_order)
    ), removed_keys AS (
     SELECT DISTINCT old_effective.logical_node_id,old_effective.file_id,
            old_effective.file_version_id,old_effective.property_name,old_effective.geometry
     FROM input
     CROSS JOIN LATERAL jsonb_array_elements(input.member_frozen_proof->'cohort') frozen(entry)
     JOIN parameter_catalog.project_parameter_bindings binding ON binding.id=frozen.entry->>'bindingId'
       AND binding.organization_id=input.organization_id AND binding.project_id=input.project_id
     JOIN parameter_catalog.project_parameter_source_occurrences occurrence
       ON occurrence.id=binding.source_occurrence_id AND occurrence.file_id=input.member_file_id
       AND occurrence.config_set_id=input.member_config_set_id AND occurrence.occurrence_kind='dts'
     JOIN parameter_catalog.project_parameter_values value ON value.id=frozen.entry->>'oldValueId'
       AND value.id=binding.current_value_id AND value.binding_id=binding.id AND value.value_state='present'
     JOIN parameter_catalog.project_value_source_pins pin ON pin.id=frozen.entry->>'sourcePinId'
       AND pin.project_value_id=value.id AND pin.binding_id=binding.id
       AND pin.config_revision_id=input.old_revision_id AND pin.file_id=input.member_file_id
       AND pin.file_version_id=input.member_file_version_id AND pin.source_occurrence_id=occurrence.id
     JOIN effective old_effective ON old_effective.phase='old'
       AND old_effective.property_id=pin.property_occurrence_id
       AND old_effective.logical_node_id=occurrence.logical_node_id
       AND old_effective.file_id=pin.file_id AND old_effective.file_version_id=pin.file_version_id
       AND old_effective.geometry=frozen.entry->'dtsGeometry'
    ), old_kept AS (
     SELECT logical_node_id,file_id,file_version_id,property_name,geometry
     FROM effective WHERE phase='old'
     EXCEPT ALL SELECT * FROM removed_keys
    ), new_set AS (
     SELECT logical_node_id,file_id,file_version_id,property_name,geometry FROM effective WHERE phase='new'
    ), node_sets AS (
     SELECT revisions.phase,logical_revision.logical_node_id,logical_revision.node_locator,
       logical_revision.name,logical_revision.unit_address,logical_revision.compatible,
       logical_revision.driver_schema_version_id,logical_revision.parent_logical_node_id
     FROM revisions JOIN public.dts_logical_node_revisions logical_revision ON logical_revision.config_revision_id=revisions.id
    ), old_nodes AS (SELECT logical_node_id,node_locator,name,unit_address,compatible,
     driver_schema_version_id,parent_logical_node_id FROM node_sets WHERE phase='old'),
    new_nodes AS (SELECT logical_node_id,node_locator,name,unit_address,compatible,
     driver_schema_version_id,parent_logical_node_id FROM node_sets WHERE phase='new') , frozen_native AS (
     SELECT binding.id binding_id, jsonb_build_object(
       'bindingId',binding.id,'oldValueId',value.id,'sourcePinId',pin.id,
       'sourceOccurrenceId',occurrence.id,'definitionId',binding.definition_id,
       'effectiveRevisionId',binding.effective_revision_id,'catalogReleaseId',binding.catalog_release_id,
       'registrationId',binding.registration_id,'subjectId',binding.subject_id,
       'fileId',pin.file_id,'fileVersionId',pin.file_version_id,'format',pin.format,
       'locator',pin.locator,'locatorDigest',pin.locator_digest,
       'valueKind',value.value_kind,'value',value.value,'valueDigest',value.value_digest
     ) || case when pin.format='dts' then jsonb_build_object('dtsGeometry',old_effective.geometry)
       else jsonb_build_object('jsonIdentity',jsonb_build_object(
         'configurationInstanceId',occurrence.configuration_instance_id,
         'configurationSchemaSubjectId',occurrence.configuration_schema_subject_id,
         'rootPointer',occurrence.root_pointer,'rootPointerDigest',occurrence.root_pointer_digest)) end expected
     FROM input
     JOIN parameter_catalog.current_project_parameter_bindings binding
       ON binding.organization_id=input.organization_id AND binding.project_id=input.project_id
     JOIN parameter_catalog.project_parameter_source_occurrences occurrence
       ON occurrence.id=binding.source_occurrence_id AND occurrence.config_set_id=input.member_config_set_id
     JOIN parameter_catalog.binding_history_events history
       ON history.binding_id=binding.id AND history.new_current_value_id=binding.current_value_id
       AND history.success_audit_ref=new.audit_event_id
     JOIN parameter_catalog.project_parameter_values value ON value.id=history.old_current_value_id AND value.binding_id=binding.id
     JOIN parameter_catalog.project_value_source_pins pin ON pin.project_value_id=value.id AND pin.binding_id=binding.id
       AND pin.source_occurrence_id=occurrence.id AND pin.config_revision_id=input.old_revision_id
     JOIN parameter_catalog.organization_subject_registrations registration ON registration.id=binding.registration_id
       AND registration.organization_id=binding.organization_id AND registration.subject_id=binding.subject_id AND registration.status='active'
     LEFT JOIN effective old_effective ON old_effective.phase='old' AND old_effective.property_id=pin.property_occurrence_id
       AND old_effective.logical_node_id=occurrence.logical_node_id AND old_effective.file_id=pin.file_id AND old_effective.file_version_id=pin.file_version_id
     WHERE occurrence.file_id<>input.member_file_id AND value.value_state='present'
       AND value.definition_id=binding.definition_id AND value.definition_revision_id=binding.effective_revision_id
       AND pin.organization_id=binding.organization_id AND pin.project_id=binding.project_id AND pin.definition_id=binding.definition_id
       AND pin.file_id=occurrence.file_id AND pin.value_state='present' AND pin.format=occurrence.occurrence_kind
     UNION ALL
     SELECT binding.id, jsonb_build_object(
       'bindingId',binding.id,'oldValueId',value.id,'sourcePinId',pin.id,
       'sourceOccurrenceId',occurrence.id,'definitionId',binding.definition_id,
       'effectiveRevisionId',binding.effective_revision_id,'catalogReleaseId',binding.catalog_release_id,
       'registrationId',binding.registration_id,'subjectId',binding.subject_id,
       'fileId',pin.file_id,'fileVersionId',pin.file_version_id,'format',pin.format,
       'locator',pin.locator,'locatorDigest',pin.locator_digest,
       'valueKind',value.value_kind,'value',value.value,'valueDigest',value.value_digest,
       'dtsGeometry',old_effective.geometry
     )
     FROM input
     JOIN parameter_catalog.project_parameter_bindings binding ON binding.organization_id=input.organization_id AND binding.project_id=input.project_id
     JOIN parameter_catalog.project_parameter_source_occurrences occurrence ON occurrence.id=binding.source_occurrence_id
       AND occurrence.config_set_id=input.member_config_set_id AND occurrence.file_id=input.member_file_id AND occurrence.occurrence_kind='dts'
     JOIN parameter_catalog.project_parameter_values value ON value.id=binding.current_value_id AND value.binding_id=binding.id
       AND value.definition_id=binding.definition_id AND value.definition_revision_id=binding.effective_revision_id AND value.value_state='present'
     JOIN parameter_catalog.project_value_source_pins pin ON pin.project_value_id=value.id AND pin.binding_id=binding.id
       AND pin.organization_id=binding.organization_id AND pin.project_id=binding.project_id AND pin.definition_id=binding.definition_id
       AND pin.source_occurrence_id=occurrence.id AND pin.config_revision_id=input.old_revision_id
       AND pin.file_id=input.member_file_id AND pin.file_version_id=input.member_file_version_id AND pin.format='dts' AND pin.value_state='present'
     JOIN parameter_catalog.organization_subject_registrations registration ON registration.id=binding.registration_id
       AND registration.organization_id=binding.organization_id AND registration.subject_id=binding.subject_id AND registration.status='active'
     JOIN effective old_effective ON old_effective.phase='old' AND old_effective.property_id=pin.property_occurrence_id
       AND old_effective.logical_node_id=occurrence.logical_node_id AND old_effective.file_id=pin.file_id AND old_effective.file_version_id=pin.file_version_id
     WHERE pin.locator=jsonb_build_object('kind','dts-property','fileVersionId',pin.file_version_id,
       'propertyName',old_effective.property_name,'propertyOccurrenceId',old_effective.property_id,
       'nodeOccurrenceId',old_effective.node_id)
       AND pin.locator_digest=parameter_catalog.canonical_dts_parameter_locator_digest(pin.locator)
       AND NOT EXISTS (select 1 from parameter_catalog.definition_replacement_projects replacement
       where replacement.status='completed' and replacement.old_binding_id=binding.id)
     )
    SELECT
     (SELECT coalesce(jsonb_agg(expected order by binding_id),'[]'::jsonb) FROM frozen_native)
       = review_request.member_frozen_proof->'cohort'
     AND (SELECT count(*)=count(distinct binding_id) FROM frozen_native)
     AND (SELECT count(*) FROM frozen_native)=jsonb_array_length(removed_bindings)+surviving_count
     AND EXISTS(SELECT 1 FROM removed_keys)
     AND EXISTS(SELECT 1 FROM old_nodes)
     AND NOT EXISTS(SELECT * FROM old_kept EXCEPT ALL SELECT * FROM new_set)
     AND NOT EXISTS(SELECT * FROM new_set EXCEPT ALL SELECT * FROM old_kept)
     AND NOT EXISTS(SELECT * FROM old_nodes EXCEPT ALL SELECT * FROM new_nodes)
     AND NOT EXISTS(SELECT * FROM new_nodes EXCEPT ALL SELECT * FROM old_nodes)
     AND NOT EXISTS(
       SELECT 1 FROM public.dts_occurrence_effects effect JOIN revisions ON revisions.id=effect.config_revision_id
       WHERE EXISTS(SELECT 1 FROM public.dts_occurrence_effects tied
         WHERE tied.config_revision_id=effect.config_revision_id
           AND tied.logical_node_revision_id=effect.logical_node_revision_id
           AND tied.property_name=effect.property_name AND tied.source_order=effect.source_order AND tied.id<>effect.id)
     )
     AND NOT EXISTS(
       SELECT 1 FROM public.dts_occurrence_effects effect JOIN revisions ON revisions.id=effect.config_revision_id
       JOIN input ON TRUE
       LEFT JOIN public.dts_logical_node_revisions logical_revision ON logical_revision.id=effect.logical_node_revision_id AND logical_revision.config_revision_id=revisions.id
       LEFT JOIN public.dts_logical_nodes logical_node ON logical_node.id=logical_revision.logical_node_id
         AND logical_node.organization_id=input.organization_id AND logical_node.project_id=input.project_id AND logical_node.config_set_id=input.member_config_set_id
       LEFT JOIN public.dts_property_occurrences property ON property.id=effect.property_occurrence_id AND property.config_revision_id=revisions.id AND property.property_name=effect.property_name
       LEFT JOIN public.dts_node_occurrences node ON node.id=effect.node_occurrence_id AND node.id=property.node_occurrence_id AND node.config_revision_id=revisions.id AND node.file_version_id=property.file_version_id
       LEFT JOIN public.dts_node_occurrences parent ON parent.id=node.parent_occurrence_id AND parent.config_revision_id=node.config_revision_id AND parent.file_version_id=node.file_version_id
       LEFT JOIN public.project_parameter_file_versions version ON version.id=property.file_version_id
       LEFT JOIN public.project_parameter_files file ON file.id=version.file_id AND file.organization_id=input.organization_id AND file.project_id=input.project_id
       LEFT JOIN public.dts_config_revision_members member ON member.config_revision_id=revisions.id AND member.file_id=file.id AND member.file_version_id=version.id
       WHERE effect.effect_kind IN ('set','override')
         AND NOT EXISTS(SELECT 1 FROM public.dts_occurrence_effects later WHERE later.config_revision_id=revisions.id AND later.logical_node_revision_id=effect.logical_node_revision_id AND later.property_name=effect.property_name AND later.source_order>effect.source_order)
         AND (logical_revision.id IS NULL OR logical_node.id IS NULL OR property.id IS NULL OR node.id IS NULL OR version.id IS NULL OR file.id IS NULL OR member.id IS NULL
           OR (node.parent_occurrence_id IS NOT NULL AND parent.id IS NULL))
     ) INTO graph_ok;
    if graph_ok is distinct from true then
      raise exception using errcode='23514', message='DTS member removal differs from the complete frozen effective graph';
    end if;
    surviving_bindings := '[]'::jsonb;
    for survivor in
      select binding.id binding_id,history.old_current_value_id old_value_id,
        binding.current_value_id new_value_id,new_pin.id pin_id,
        history.id history_id,occurrence.file_id,new_pin.file_version_id,new_pin.format
  from parameter_catalog.current_project_parameter_bindings binding
  join parameter_catalog.project_parameter_source_occurrences occurrence
    on occurrence.id=binding.source_occurrence_id
  join parameter_catalog.binding_history_events history
    on history.binding_id=binding.id and history.new_current_value_id=binding.current_value_id
   and history.success_audit_ref=new.audit_event_id
  join parameter_catalog.project_parameter_values old_value
    on old_value.id=history.old_current_value_id and old_value.binding_id=binding.id
  join parameter_catalog.project_parameter_values new_value
    on new_value.id=binding.current_value_id and new_value.binding_id=binding.id
   and new_value.value_digest=old_value.value_digest
   and new_value.value_kind=old_value.value_kind
  join parameter_catalog.project_value_source_pins old_pin
    on old_pin.project_value_id=old_value.id and old_pin.binding_id=binding.id
   and old_pin.config_revision_id=new.config_revision_id
  join parameter_catalog.project_value_source_pins new_pin
    on new_pin.project_value_id=new_value.id and new_pin.binding_id=binding.id
   and new_pin.config_revision_id=new.successor_config_revision_id
   and new_pin.file_id=old_pin.file_id and new_pin.file_version_id=old_pin.file_version_id
   and new_pin.source_occurrence_id=old_pin.source_occurrence_id
   and new_pin.value_state='present'
  where binding.organization_id=new.organization_id and binding.project_id=new.project_id
    and occurrence.config_set_id=new.config_set_id and occurrence.file_id<>new.file_id
    and occurrence.file_id=new_pin.file_id order by binding.id
    loop
      if survivor.format='dts' then
        WITH pair AS MATERIALIZED (
          SELECT request.id AS request_id, binding.id AS binding_id,
            request.member_frozen_proof AS proof,
            binding.organization_id, binding.project_id, occurrence.config_set_id,
            occurrence.id AS source_occurrence_id, occurrence.logical_node_id,
            binding.definition_id, binding.effective_revision_id,
            binding.catalog_release_id, binding.registration_id, binding.subject_id,
            old_value.id AS old_value_id, next_value.id AS new_value_id,
            base_pin.id AS old_pin_id, next_pin.id AS new_pin_id,
            base_pin.config_revision_id AS old_revision_id,
            next_pin.config_revision_id AS new_revision_id,
            base_pin.file_id, base_pin.file_version_id,
            old_value.value_kind, old_value.value_digest, old_value.value,
            base_pin.locator AS old_locator, base_pin.locator_digest AS old_locator_digest,
            next_pin.locator AS new_locator, next_pin.locator_digest AS new_locator_digest,
            base_pin.property_occurrence_id AS old_property_id,
            next_pin.property_occurrence_id AS new_property_id,
            definition.property_key
          FROM public.project_parameter_value_change_requests request
          JOIN parameter_catalog.project_parameter_bindings binding ON binding.id=survivor.binding_id
          JOIN parameter_catalog.project_parameter_source_occurrences occurrence
            ON occurrence.id=binding.source_occurrence_id
           AND occurrence.organization_id=binding.organization_id
           AND occurrence.project_id=binding.project_id AND occurrence.occurrence_kind='dts'
          JOIN parameter_catalog.parameter_definitions definition ON definition.id=binding.definition_id
          JOIN parameter_catalog.organization_subject_registrations registration
            ON registration.id=binding.registration_id
           AND registration.organization_id=binding.organization_id
           AND registration.subject_id=binding.subject_id AND registration.status='active'
          JOIN parameter_catalog.project_parameter_values old_value
            ON old_value.id=survivor.old_value_id AND old_value.binding_id=binding.id
           AND old_value.definition_id=binding.definition_id
           AND old_value.definition_revision_id=binding.effective_revision_id
           AND old_value.value_state='present'
          JOIN parameter_catalog.project_parameter_values next_value
            ON next_value.id=survivor.new_value_id AND next_value.binding_id=binding.id
           AND next_value.definition_id=binding.definition_id
           AND next_value.definition_revision_id=binding.effective_revision_id
           AND next_value.value_state='present'
           AND next_value.value_kind=old_value.value_kind
           AND next_value.value_digest=old_value.value_digest
           AND next_value.value=old_value.value AND next_value.source_ref=old_value.source_ref
          JOIN parameter_catalog.project_value_source_pins base_pin
            ON base_pin.project_value_id=old_value.id AND base_pin.binding_id=binding.id
           AND base_pin.organization_id=binding.organization_id AND base_pin.project_id=binding.project_id
           AND base_pin.source_occurrence_id=occurrence.id AND base_pin.definition_id=binding.definition_id
           AND base_pin.config_revision_id=old_value.config_revision_id
           AND base_pin.file_id=occurrence.file_id AND base_pin.format='dts' AND base_pin.value_state='present'
          JOIN parameter_catalog.project_value_source_pins next_pin
            ON next_pin.project_value_id=next_value.id AND next_pin.binding_id=binding.id
           AND next_pin.organization_id=binding.organization_id AND next_pin.project_id=binding.project_id
           AND next_pin.source_occurrence_id=occurrence.id AND next_pin.definition_id=binding.definition_id
           AND next_pin.config_revision_id=next_value.config_revision_id
           AND next_pin.file_id=base_pin.file_id AND next_pin.file_version_id=base_pin.file_version_id
           AND next_pin.format='dts' AND next_pin.value_state='present'
          JOIN public.dts_config_revisions predecessor ON predecessor.id=base_pin.config_revision_id
           AND predecessor.organization_id=binding.organization_id AND predecessor.project_id=binding.project_id
           AND predecessor.config_set_id=occurrence.config_set_id
          JOIN public.dts_config_revisions successor ON successor.id=next_pin.config_revision_id
           AND successor.organization_id=binding.organization_id AND successor.project_id=binding.project_id
           AND successor.config_set_id=occurrence.config_set_id AND successor.status='resolved'
          WHERE request.id=review_request.id AND request.request_kind='member-removal' AND request.status='approved'
            AND request.organization_id=binding.organization_id AND request.project_id=binding.project_id
            AND request.member_config_set_id=occurrence.config_set_id
            AND request.member_file_id<>base_pin.file_id
            AND request.member_frozen_proof->>'kind'='canonical-member-removal'
            AND request.member_frozen_proof->'proofVersion'='2'::jsonb
            AND request.member_frozen_proof->>'format'='dts'
            AND request.member_frozen_proof->>'proofDigest'=request.member_proof_digest
            AND base_pin.config_revision_id=request.member_frozen_proof->>'configRevisionId'
            AND next_pin.config_revision_id<>base_pin.config_revision_id
        ), endpoints AS MATERIALIZED (
          SELECT pair.*, endpoint.phase, property.id AS property_id, node.id AS node_id,
            logical_revision.id AS logical_revision_id, effect.id AS effect_id,
            jsonb_build_object(
              'property',jsonb_build_object('name',property.property_name,
                'fileVersionId',property.file_version_id,
                'span',jsonb_build_array(property.start_offset,property.end_offset,property.start_line,
                  property.start_column,property.end_line,property.end_column),
                'rawText',property.raw_text,'ast',property.ast_json,'contentHash',property.content_hash),
              'node',jsonb_build_object('fileVersionId',node.file_version_id,'path',node.node_path,
                'name',node.name,'unitAddress',node.unit_address,'labels',node.labels,
                'refTarget',node.ref_target,'overlayRoot',node.is_overlay_root,
                'span',jsonb_build_array(node.start_offset,node.end_offset,node.start_line,
                  node.start_column,node.end_line,node.end_column),
                'rawText',node.raw_text,'ast',node.ast_json,'contentHash',node.content_hash),
              'parent',CASE WHEN node.parent_occurrence_id IS NULL THEN 'null'::jsonb ELSE
                jsonb_build_object('fileVersionId',parent.file_version_id,'path',parent.node_path,
                  'name',parent.name,'unitAddress',parent.unit_address,'labels',parent.labels,
                  'refTarget',parent.ref_target,'overlayRoot',parent.is_overlay_root,
                  'span',jsonb_build_array(parent.start_offset,parent.end_offset,parent.start_line,
                    parent.start_column,parent.end_line,parent.end_column),
                  'rawText',parent.raw_text,'ast',parent.ast_json,'contentHash',parent.content_hash) END,
              'logical',jsonb_build_object('logicalNodeId',logical_revision.logical_node_id,
                'locator',logical_revision.node_locator,'name',logical_revision.name,
                'unitAddress',logical_revision.unit_address,'compatible',logical_revision.compatible,
                'driverSchemaVersionId',logical_revision.driver_schema_version_id,
                'parentLogicalNodeId',logical_revision.parent_logical_node_id)
            ) AS geometry
          FROM pair
          CROSS JOIN LATERAL (VALUES
            ('old',pair.old_revision_id,pair.old_property_id,pair.old_locator,pair.old_locator_digest),
            ('new',pair.new_revision_id,pair.new_property_id,pair.new_locator,pair.new_locator_digest)
          ) AS endpoint(phase,revision_id,property_id,locator,locator_digest)
          JOIN public.dts_property_occurrences property ON property.id=endpoint.property_id
           AND property.config_revision_id=endpoint.revision_id
           AND property.file_version_id=pair.file_version_id AND property.property_name=pair.property_key
          JOIN public.dts_node_occurrences node ON node.id=property.node_occurrence_id
           AND node.config_revision_id=property.config_revision_id AND node.file_version_id=property.file_version_id
          LEFT JOIN public.dts_node_occurrences parent ON parent.id=node.parent_occurrence_id
           AND parent.config_revision_id=node.config_revision_id AND parent.file_version_id=node.file_version_id
          JOIN public.dts_occurrence_effects effect ON effect.config_revision_id=property.config_revision_id
           AND effect.property_occurrence_id=property.id AND effect.node_occurrence_id=node.id
           AND effect.property_name=property.property_name AND effect.effect_kind IN ('set','override')
          JOIN public.dts_logical_node_revisions logical_revision ON logical_revision.id=effect.logical_node_revision_id
           AND logical_revision.config_revision_id=property.config_revision_id
           AND logical_revision.logical_node_id=pair.logical_node_id
          JOIN public.dts_logical_nodes logical_node ON logical_node.id=logical_revision.logical_node_id
           AND logical_node.organization_id=pair.organization_id AND logical_node.project_id=pair.project_id
           AND logical_node.config_set_id=pair.config_set_id
          JOIN public.dts_config_revision_members member ON member.config_revision_id=property.config_revision_id
           AND member.file_id=pair.file_id AND member.file_version_id=property.file_version_id
          WHERE (node.parent_occurrence_id IS NULL OR parent.id IS NOT NULL)
            AND endpoint.locator=jsonb_build_object('kind','dts-property','fileVersionId',property.file_version_id,
              'propertyName',property.property_name,'propertyOccurrenceId',property.id,'nodeOccurrenceId',node.id)
            AND endpoint.locator_digest='sha256:' || pg_catalog.encode(
            pg_catalog.sha256(pg_catalog.convert_to(
              pg_catalog.concat(
                '{', pg_catalog.chr(10),
                '  "fileVersionId": ', pg_catalog.to_json(endpoint.locator ->> 'fileVersionId')::text, ',', pg_catalog.chr(10),
                '  "kind": ', pg_catalog.to_json(endpoint.locator ->> 'kind')::text, ',', pg_catalog.chr(10),
                '  "nodeOccurrenceId": ', pg_catalog.to_json(endpoint.locator ->> 'nodeOccurrenceId')::text, ',', pg_catalog.chr(10),
                '  "propertyName": ', pg_catalog.to_json(endpoint.locator ->> 'propertyName')::text, ',', pg_catalog.chr(10),
                '  "propertyOccurrenceId": ', pg_catalog.to_json(endpoint.locator ->> 'propertyOccurrenceId')::text, pg_catalog.chr(10),
                '}', pg_catalog.chr(10)
              ),
              'UTF8'
            )),
            'hex'
          )
            AND NOT EXISTS (SELECT 1 FROM public.dts_occurrence_effects competing
              WHERE competing.config_revision_id=effect.config_revision_id
                AND competing.logical_node_revision_id=effect.logical_node_revision_id
                AND competing.property_name=effect.property_name AND competing.id<>effect.id
                AND competing.source_order>=effect.source_order)
        ), matching_pair AS MATERIALIZED (
          SELECT old_endpoint.*, next_endpoint.node_id AS next_node_id,
            next_endpoint.property_id AS next_property_id,
            next_endpoint.logical_revision_id AS next_logical_revision_id,
            next_endpoint.effect_id AS next_effect_id
          FROM endpoints old_endpoint
          JOIN endpoints next_endpoint ON next_endpoint.binding_id=old_endpoint.binding_id
           AND next_endpoint.request_id=old_endpoint.request_id
           AND next_endpoint.phase='new' AND next_endpoint.geometry=old_endpoint.geometry
          WHERE old_endpoint.phase='old'
            AND (SELECT count(*) FROM endpoints WHERE phase='old')=1
            AND (SELECT count(*) FROM endpoints WHERE phase='new')=1
        ), frozen_match AS MATERIALIZED (
          SELECT matching_pair.* FROM matching_pair
          CROSS JOIN LATERAL jsonb_array_elements(matching_pair.proof->'cohort') WITH ORDINALITY frozen(entry,ordinal)
          WHERE frozen.entry->>'format'='dts'
            AND frozen.entry->>'bindingId'=matching_pair.binding_id
            AND frozen.entry->>'oldValueId'=matching_pair.old_value_id
            AND frozen.entry->>'sourcePinId'=matching_pair.old_pin_id
            AND frozen.entry->>'sourceOccurrenceId'=matching_pair.source_occurrence_id
            AND frozen.entry->>'definitionId'=matching_pair.definition_id
            AND frozen.entry->>'effectiveRevisionId'=matching_pair.effective_revision_id
            AND frozen.entry->>'catalogReleaseId'=matching_pair.catalog_release_id
            AND frozen.entry->>'registrationId'=matching_pair.registration_id
            AND frozen.entry->>'subjectId'=matching_pair.subject_id
            AND frozen.entry->>'fileId'=matching_pair.file_id
            AND frozen.entry->>'fileVersionId'=matching_pair.file_version_id
            AND frozen.entry->'locator'=matching_pair.old_locator
            AND frozen.entry->>'locatorDigest'=matching_pair.old_locator_digest
            AND frozen.entry->>'valueKind'=matching_pair.value_kind
            AND frozen.entry->>'valueDigest'=matching_pair.value_digest
            AND frozen.entry->'value'=matching_pair.value
            AND frozen.entry->'dtsGeometry'=matching_pair.geometry
        )
        SELECT count(*)=1, max(frozen_match.next_node_id), max(frozen_match.next_property_id),
              max(frozen_match.next_logical_revision_id), max(frozen_match.next_effect_id)
              into pair_ok,next_node_id,next_property_id,next_logical_revision_id,next_effect_id
            FROM frozen_match;
      elsif survivor.format='json' then
        WITH json_pair AS MATERIALIZED (
         SELECT request.member_frozen_proof proof,binding.id binding_id,
           binding.subject_id,binding.registration_id,binding.definition_id,
           binding.effective_revision_id,binding.catalog_release_id,
           occurrence.id source_occurrence_id,occurrence.configuration_instance_id,
           occurrence.configuration_schema_subject_id,occurrence.root_pointer,occurrence.root_pointer_digest,
           old_value.id old_value_id,old_value.value_kind,old_value.value_digest,old_value.value,
           base_pin.id old_pin_id,base_pin.file_id,base_pin.file_version_id,
           base_pin.locator,base_pin.locator_digest
         FROM public.project_parameter_value_change_requests request
         JOIN parameter_catalog.project_parameter_bindings binding ON binding.id=survivor.binding_id
         JOIN parameter_catalog.project_parameter_source_occurrences occurrence
           ON occurrence.id=binding.source_occurrence_id AND occurrence.occurrence_kind='json'
           AND occurrence.organization_id=binding.organization_id AND occurrence.project_id=binding.project_id
           AND occurrence.configuration_schema_subject_id=binding.subject_id
         JOIN parameter_catalog.organization_subject_registrations registration
           ON registration.id=binding.registration_id AND registration.organization_id=binding.organization_id
           AND registration.subject_id=binding.subject_id AND registration.status='active'
         JOIN parameter_catalog.project_parameter_values old_value
           ON old_value.id=survivor.old_value_id AND old_value.binding_id=binding.id AND old_value.definition_id=binding.definition_id
           AND old_value.definition_revision_id=binding.effective_revision_id AND old_value.value_state='present'
         JOIN parameter_catalog.project_parameter_values next_value
           ON next_value.id=survivor.new_value_id AND next_value.binding_id=binding.id AND next_value.definition_id=binding.definition_id
           AND next_value.definition_revision_id=binding.effective_revision_id AND next_value.value_state='present'
           AND next_value.value_kind=old_value.value_kind AND next_value.value_digest=old_value.value_digest
           AND next_value.value=old_value.value AND next_value.source_ref=old_value.source_ref
         JOIN parameter_catalog.project_value_source_pins base_pin
           ON base_pin.project_value_id=old_value.id AND base_pin.binding_id=binding.id
           AND base_pin.organization_id=binding.organization_id AND base_pin.project_id=binding.project_id
           AND base_pin.definition_id=binding.definition_id AND base_pin.source_occurrence_id=occurrence.id
           AND base_pin.config_revision_id=old_value.config_revision_id AND base_pin.file_id=occurrence.file_id
           AND base_pin.format='json' AND base_pin.property_occurrence_id IS NULL AND base_pin.value_state='present'
         JOIN parameter_catalog.project_value_source_pins next_pin
           ON next_pin.project_value_id=next_value.id AND next_pin.binding_id=binding.id
           AND next_pin.organization_id=binding.organization_id AND next_pin.project_id=binding.project_id
           AND next_pin.definition_id=binding.definition_id AND next_pin.source_occurrence_id=occurrence.id
           AND next_pin.config_revision_id=next_value.config_revision_id
           AND next_pin.file_id=base_pin.file_id AND next_pin.file_version_id=base_pin.file_version_id
           AND next_pin.format='json' AND next_pin.property_occurrence_id IS NULL AND next_pin.value_state='present'
           AND next_pin.locator=base_pin.locator AND next_pin.locator_digest=base_pin.locator_digest
         JOIN public.dts_config_revisions predecessor ON predecessor.id=base_pin.config_revision_id
           AND predecessor.organization_id=binding.organization_id AND predecessor.project_id=binding.project_id
           AND predecessor.config_set_id=occurrence.config_set_id
         JOIN public.dts_config_revisions successor ON successor.id=next_pin.config_revision_id
           AND successor.organization_id=binding.organization_id AND successor.project_id=binding.project_id
           AND successor.config_set_id=occurrence.config_set_id AND successor.status='resolved'
         JOIN public.dts_config_revision_members old_member ON old_member.config_revision_id=predecessor.id
           AND old_member.file_id=base_pin.file_id AND old_member.file_version_id=base_pin.file_version_id
         JOIN public.dts_config_revision_members new_member ON new_member.config_revision_id=successor.id
           AND new_member.file_id=old_member.file_id AND new_member.file_version_id=old_member.file_version_id
           AND new_member.source_name=old_member.source_name AND new_member.role=old_member.role
           AND new_member.sort_order=old_member.sort_order
         WHERE request.id=review_request.id AND request.request_kind='member-removal' AND request.status='approved'
           AND request.organization_id=binding.organization_id AND request.project_id=binding.project_id
           AND request.member_config_set_id=occurrence.config_set_id AND request.member_file_id<>base_pin.file_id
           AND request.member_frozen_proof->>'kind'='canonical-member-removal'
           AND request.member_frozen_proof->'proofVersion'='2'::jsonb
           AND request.member_frozen_proof->>'format'='dts'
           AND request.member_frozen_proof->>'proofDigest'=request.member_proof_digest
           AND base_pin.config_revision_id=request.member_frozen_proof->>'configRevisionId'
           AND next_pin.config_revision_id<>base_pin.config_revision_id
           AND base_pin.locator=jsonb_build_object('kind','json-pointer','pointer',base_pin.locator->>'pointer')
           AND base_pin.locator->>'pointer' IS NOT NULL
        ), frozen_match AS MATERIALIZED (
         SELECT json_pair.* FROM json_pair
         CROSS JOIN LATERAL jsonb_array_elements(json_pair.proof->'cohort') frozen(entry)
         WHERE frozen.entry->>'format'='json'
           AND frozen.entry->>'bindingId'=json_pair.binding_id
           AND frozen.entry->>'oldValueId'=json_pair.old_value_id
           AND frozen.entry->>'sourcePinId'=json_pair.old_pin_id
           AND frozen.entry->>'sourceOccurrenceId'=json_pair.source_occurrence_id
           AND frozen.entry->>'definitionId'=json_pair.definition_id
           AND frozen.entry->>'effectiveRevisionId'=json_pair.effective_revision_id
           AND frozen.entry->>'catalogReleaseId'=json_pair.catalog_release_id
           AND frozen.entry->>'registrationId'=json_pair.registration_id
           AND frozen.entry->>'subjectId'=json_pair.subject_id
           AND frozen.entry->>'fileId'=json_pair.file_id
           AND frozen.entry->>'fileVersionId'=json_pair.file_version_id
           AND frozen.entry->'locator'=json_pair.locator
           AND frozen.entry->>'locatorDigest'=json_pair.locator_digest
           AND frozen.entry->>'valueKind'=json_pair.value_kind
           AND frozen.entry->>'valueDigest'=json_pair.value_digest
           AND frozen.entry->'value'=json_pair.value
           AND frozen.entry->'jsonIdentity'=jsonb_build_object(
             'configurationInstanceId',json_pair.configuration_instance_id,
             'configurationSchemaSubjectId',json_pair.configuration_schema_subject_id,
             'rootPointer',json_pair.root_pointer,'rootPointerDigest',json_pair.root_pointer_digest)
           AND NOT(frozen.entry ? 'dtsGeometry')
        )
        SELECT count(*)=1 into pair_ok FROM frozen_match;
      else
        pair_ok := false;
      end if;
      if pair_ok is distinct from true then
        raise exception using errcode='23514', message='Member removal has no exact typed survivor pair';
      end if;
      surviving_bindings := surviving_bindings || jsonb_build_array(jsonb_build_object(
        'bindingId',survivor.binding_id,'oldValueId',survivor.old_value_id,
        'newValueId',survivor.new_value_id,'sourcePinId',survivor.pin_id,
        'historyEventId',survivor.history_id,'fileId',survivor.file_id,
        'fileVersionId',survivor.file_version_id,'format',survivor.format
      ) || case when survivor.format='dts' then jsonb_build_object(
        'nodeOccurrenceId',next_node_id,'propertyOccurrenceId',next_property_id,
        'logicalNodeRevisionId',next_logical_revision_id,'effectId',next_effect_id
      ) else '{}'::jsonb end);
    end loop;
  else
  select coalesce(jsonb_agg(jsonb_build_object(
    'bindingId',binding.id,'oldValueId',history.old_current_value_id,
    'newValueId',binding.current_value_id,'sourcePinId',new_pin.id,
    'historyEventId',history.id,'fileId',occurrence.file_id,
    'fileVersionId',new_pin.file_version_id
  ) order by binding.id),'[]'::jsonb) into surviving_bindings
  from parameter_catalog.current_project_parameter_bindings binding
  join parameter_catalog.project_parameter_source_occurrences occurrence
    on occurrence.id=binding.source_occurrence_id
  join parameter_catalog.binding_history_events history
    on history.binding_id=binding.id and history.new_current_value_id=binding.current_value_id
   and history.success_audit_ref=new.audit_event_id
  join parameter_catalog.project_parameter_values old_value
    on old_value.id=history.old_current_value_id and old_value.binding_id=binding.id
  join parameter_catalog.project_parameter_values new_value
    on new_value.id=binding.current_value_id and new_value.binding_id=binding.id
   and new_value.value_digest=old_value.value_digest
   and new_value.value_kind=old_value.value_kind
  join parameter_catalog.project_value_source_pins old_pin
    on old_pin.project_value_id=old_value.id and old_pin.binding_id=binding.id
   and old_pin.config_revision_id=new.config_revision_id
  join parameter_catalog.project_value_source_pins new_pin
    on new_pin.project_value_id=new_value.id and new_pin.binding_id=binding.id
   and new_pin.config_revision_id=new.successor_config_revision_id
   and new_pin.file_id=old_pin.file_id and new_pin.file_version_id=old_pin.file_version_id
   and new_pin.locator=old_pin.locator and new_pin.source_occurrence_id=old_pin.source_occurrence_id
   and new_pin.value_state='present'
  where binding.organization_id=new.organization_id and binding.project_id=new.project_id
    and occurrence.config_set_id=new.config_set_id and occurrence.file_id<>new.file_id
    and occurrence.file_id=new_pin.file_id;
  end if;
  if surviving_count <> jsonb_array_length(surviving_bindings)
     or surviving_bindings is distinct from new.successor_binding_manifest then
    raise exception using errcode='23514', message='Member removal must advance the complete surviving Binding cohort';
  end if;
  return null;
end;
$$;
alter function parameter_catalog.assert_member_removal_tombstone() owner to catalog_migration_owner;
revoke all on function parameter_catalog.assert_member_removal_tombstone()
  from public, catalog_synchronizer_role, parameter_governance_writer_role;
