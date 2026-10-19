-- Whole-source removal anchors the genuine BEFORE occurrence; an absent AFTER
-- node must never be represented by a fabricated dts_node_occurrences row.
do $$
declare old_locator text; old_proof text;
begin
  select pg_get_expr(conbin,conrelid) into strict old_locator from pg_constraint
    where conrelid='parameter_catalog.project_value_source_pins'::regclass and conname='project_value_source_pin_locator_ck';
  select pg_get_expr(conbin,conrelid) into strict old_proof from pg_constraint
    where conrelid='parameter_catalog.project_value_source_pins'::regclass and conname='project_value_source_pin_delete_proof_ck';
  alter table parameter_catalog.project_value_source_pins drop constraint project_value_source_pin_locator_ck,
    drop constraint project_value_source_pin_delete_proof_ck;
  execute format($sql$alter table parameter_catalog.project_value_source_pins
    add constraint project_value_source_pin_locator_ck check ((%s) or
      (format='dts' and value_state='deleted' and property_occurrence_id is null
       and locator->>'kind'='dts-source-absence'
       and locator=jsonb_build_object('kind','dts-source-absence',
         'basePropertyOccurrenceId',locator->>'basePropertyOccurrenceId',
         'baseNodeOccurrenceId',locator->>'baseNodeOccurrenceId',
         'baseFileVersionId',locator->>'baseFileVersionId','fileVersionId',locator->>'fileVersionId',
         'propertyName',locator->>'propertyName','logicalNodeId',locator->>'logicalNodeId')
       and nullif(locator->>'basePropertyOccurrenceId','') is not null
       and nullif(locator->>'baseNodeOccurrenceId','') is not null
       and nullif(locator->>'baseFileVersionId','') is not null
       and locator->>'fileVersionId'=file_version_id
       and nullif(locator->>'propertyName','') is not null and nullif(locator->>'logicalNodeId','') is not null) is true)$sql$,old_locator);
  execute format($sql$alter table parameter_catalog.project_value_source_pins
    add constraint project_value_source_pin_delete_proof_ck check ((%s) or
      (format='dts' and value_state='deleted' and locator->>'kind'='dts-source-absence'
       and delete_proof=jsonb_build_object('kind','dts-source-absence-v1','scannerVersion','dts-config-v1',
         'beforeValueDigest',delete_proof->>'beforeValueDigest',
         'beforeSourceDigest',delete_proof->>'beforeSourceDigest','afterSourceDigest',delete_proof->>'afterSourceDigest')
       and delete_proof->>'beforeValueDigest' ~ '^sha256:[0-9a-f]{64}$'
       and delete_proof->>'beforeSourceDigest' ~ '^sha256:[0-9a-f]{64}$'
       and delete_proof->>'afterSourceDigest' ~ '^sha256:[0-9a-f]{64}$') is true)$sql$,old_proof);
end $$;

create function parameter_catalog.canonical_source_absence_locator_digest(locator jsonb)
returns text language sql immutable strict set search_path=pg_catalog,parameter_catalog as $$
select 'sha256:' || encode(pg_catalog.sha256(convert_to(concat(
  '{',chr(10),
  '  "baseFileVersionId": ',to_json(locator->>'baseFileVersionId')::text,',',chr(10),
  '  "baseNodeOccurrenceId": ',to_json(locator->>'baseNodeOccurrenceId')::text,',',chr(10),
  '  "basePropertyOccurrenceId": ',to_json(locator->>'basePropertyOccurrenceId')::text,',',chr(10),
  '  "fileVersionId": ',to_json(locator->>'fileVersionId')::text,',',chr(10),
  '  "kind": ',to_json(locator->>'kind')::text,',',chr(10),
  '  "logicalNodeId": ',to_json(locator->>'logicalNodeId')::text,',',chr(10),
  '  "propertyName": ',to_json(locator->>'propertyName')::text,chr(10),'}',chr(10)), 'UTF8')),'hex')
$$;

create function parameter_catalog.valid_source_revision_absence_pin(pin_id text)
returns boolean language sql stable security definer set search_path=pg_catalog,parameter_catalog,public as $$
select exists (
  select 1 from parameter_catalog.project_value_source_pins pin
  join parameter_catalog.project_parameter_bindings binding on binding.id=pin.binding_id
    and binding.organization_id=pin.organization_id and binding.project_id=pin.project_id
    and binding.source_occurrence_id=pin.source_occurrence_id and binding.definition_id=pin.definition_id
  join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=pin.source_occurrence_id
    and occurrence.file_id=pin.file_id and occurrence.logical_node_id=pin.locator->>'logicalNodeId'
    and occurrence.organization_id=pin.organization_id and occurrence.project_id=pin.project_id
  join parameter_catalog.parameter_definitions definition on definition.id=pin.definition_id
    and definition.property_key=pin.locator->>'propertyName'
  join parameter_catalog.project_parameter_values value on value.id=pin.project_value_id
    and value.binding_id=pin.binding_id and value.definition_id=pin.definition_id
    and value.config_revision_id=pin.config_revision_id and value.value_state='deleted'
  join parameter_catalog.project_value_source_pins base_pin on base_pin.id=pin.base_source_pin_id
    and base_pin.binding_id=pin.binding_id and base_pin.definition_id=pin.definition_id
    and base_pin.organization_id=pin.organization_id and base_pin.project_id=pin.project_id
    and base_pin.source_occurrence_id=pin.source_occurrence_id and base_pin.file_id=pin.file_id
    and base_pin.value_state='present' and base_pin.property_occurrence_id=pin.locator->>'basePropertyOccurrenceId'
    and base_pin.locator->>'nodeOccurrenceId'=pin.locator->>'baseNodeOccurrenceId'
    and base_pin.file_version_id=pin.locator->>'baseFileVersionId'
  join parameter_catalog.project_parameter_values old_value on old_value.id=base_pin.project_value_id
    and old_value.binding_id=pin.binding_id and old_value.value_state='present'
    and old_value.value_kind=value.value_kind and old_value.value=value.value and old_value.value_digest=value.value_digest
  join public.dts_property_occurrences base_property on base_property.id=base_pin.property_occurrence_id
    and base_property.config_revision_id=base_pin.config_revision_id and base_property.file_version_id=base_pin.file_version_id
    and base_property.node_occurrence_id=pin.locator->>'baseNodeOccurrenceId'
    and base_property.property_name=definition.property_key
  join public.project_parameter_file_versions before_version on before_version.id=base_pin.file_version_id and before_version.file_id=pin.file_id
  join public.project_parameter_file_versions after_version on after_version.id=pin.file_version_id and after_version.file_id=pin.file_id
  join public.dts_config_revision_members member on member.config_revision_id=pin.config_revision_id
    and member.file_id=pin.file_id and member.file_version_id=pin.file_version_id and member.source_name is not null
  join public.dts_config_revisions revision on revision.id=pin.config_revision_id
    and revision.organization_id=pin.organization_id and revision.project_id=pin.project_id
    and revision.config_set_id=occurrence.config_set_id and revision.status='resolved'
  join public.project_parameter_value_change_requests request on request.id=pin.delete_request_id
    and request.organization_id=pin.organization_id and request.project_id=pin.project_id
    and request.request_kind='source_revision' and request.status='approved'
    and request.source_revision_config_set_id=occurrence.config_set_id
    and request.source_revision_context->>'baseConfigRevisionId'=base_pin.config_revision_id
    and request.applied_source_result->>'configRevisionId'=pin.config_revision_id
  join public.project_parameter_value_change_targets target on target.request_id=request.id and target.binding_id=pin.binding_id
    and target.organization_id=pin.organization_id and target.project_id=pin.project_id and target.action='delete'
    and target.source_pin_id=base_pin.id and target.base_current_value_id=old_value.id
    and target.applied_value_id=value.id and target.applied_source_pin_id=pin.id and target.applied_file_version_id=pin.file_version_id
  join parameter_catalog.binding_history_events history on history.binding_id=pin.binding_id
    and history.old_current_value_id=old_value.id and history.new_current_value_id=value.id
    and history.success_audit_ref=request.applied_audit_ref and history.applied_request_id=request.id
    and history.id=target.applied_history_event_id
  join public.audit_events audit on audit.id=request.applied_audit_ref
    and audit.organization_id=pin.organization_id and audit.project_id=pin.project_id
    and audit.target_id=request.id and audit.action='value-change-applied'
    and audit.metadata->'result'=request.applied_source_result
  where pin.id=pin_id and pin.format='dts' and pin.value_state='deleted'
    and pin.locator->>'kind'='dts-source-absence'
    and pin.locator_digest=parameter_catalog.canonical_source_absence_locator_digest(pin.locator)
    and pin.delete_proof->>'beforeValueDigest'=old_value.value_digest
    and pin.delete_proof->>'beforeSourceDigest'='sha256:' || regexp_replace(before_version.checksum,'^sha256:','')
    and pin.delete_proof->>'afterSourceDigest'='sha256:' || regexp_replace(after_version.checksum,'^sha256:','')
    and request.source_revision_context->'cohort' @> jsonb_build_array(jsonb_build_object(
      'bindingId',pin.binding_id,'oldValueId',old_value.id,'sourcePinId',base_pin.id,
      'logicalNodeId',occurrence.logical_node_id,'propertyName',definition.property_key,'fileId',pin.file_id))
    and request.source_revision_context->'targets' @> jsonb_build_array(jsonb_build_object(
      'bindingId',pin.binding_id,'action','delete','propertyName',definition.property_key))
    and request.applied_source_result->'results' @> jsonb_build_array(jsonb_build_object(
      'bindingId',pin.binding_id,'oldValueId',old_value.id,'newValueId',value.id,
      'sourcePinId',pin.id,'historyEventId',history.id,'kind','deleted'))
    and not exists (
      select 1 from public.dts_occurrence_effects effect
      join public.dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
        and logical.config_revision_id=effect.config_revision_id and logical.logical_node_id=occurrence.logical_node_id
      join public.dts_property_occurrences property on property.id=effect.property_occurrence_id
      where effect.config_revision_id=pin.config_revision_id and effect.property_name=definition.property_key
        and property.file_version_id=pin.file_version_id and effect.effect_kind in ('set','override')
        and not exists(select 1 from public.dts_occurrence_effects later
          where later.config_revision_id=effect.config_revision_id and later.logical_node_revision_id=effect.logical_node_revision_id
            and later.property_name=effect.property_name and later.source_order>effect.source_order)
    )
)
$$;

-- Preserve the complete installed single/batch pin proof. Only the new,
-- separately proven absence locator takes this explicit additional branch.
do $$
declare definition text;
begin
  select pg_get_functiondef('parameter_catalog.assert_project_value_source_pin_owner()'::regprocedure) into strict definition;
  definition := regexp_replace(definition, E'\\mBEGIN\\M', $branch$begin
  if new.locator->>'kind'='dts-source-absence' then
    if not parameter_catalog.valid_source_revision_absence_pin(new.id) then
      raise exception using errcode='23503',message='Reviewed whole-source absence pin has no exact provenance proof';
    end if;
    return null;
  end if;$branch$, 'i');
  execute definition;
end $$;

alter function parameter_catalog.canonical_source_absence_locator_digest(jsonb) owner to catalog_migration_owner;
alter function parameter_catalog.valid_source_revision_absence_pin(text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.canonical_source_absence_locator_digest(jsonb) from public;
revoke all on function parameter_catalog.valid_source_revision_absence_pin(text) from public;
