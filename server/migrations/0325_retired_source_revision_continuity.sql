-- A DTS edit may carry an existing JSON value into the successor configuration
-- without restoring its retired organization registration. This is an immutable
-- derived receipt predicate, not admission for a new Binding or a JSON edit.
create function parameter_catalog.retired_json_source_revision_matches(p_pin_id text)
returns boolean language sql stable security definer
set search_path=pg_catalog,parameter_catalog,public as $$
select exists (
  select 1
  from parameter_catalog.project_value_source_pins pin
  join parameter_catalog.project_parameter_bindings binding on binding.id=pin.binding_id
    and binding.organization_id=pin.organization_id and binding.project_id=pin.project_id
    and binding.source_occurrence_id=pin.source_occurrence_id and binding.definition_id=pin.definition_id
  join parameter_catalog.organization_subject_registrations registration on registration.id=binding.registration_id
    and registration.organization_id=binding.organization_id and registration.subject_id=binding.subject_id
    and registration.status='retired'
  join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=pin.source_occurrence_id
    and occurrence.organization_id=pin.organization_id and occurrence.project_id=pin.project_id
    and occurrence.file_id=pin.file_id and occurrence.occurrence_kind='json'
    and occurrence.configuration_schema_subject_id=binding.subject_id
  join parameter_catalog.project_parameter_values value on value.id=pin.project_value_id
    and value.binding_id=pin.binding_id and value.definition_id=pin.definition_id
    and value.config_revision_id=pin.config_revision_id and value.value_state='present'
  join parameter_catalog.binding_history_events history on history.binding_id=pin.binding_id
    and history.new_current_value_id=value.id and history.applied_request_id is null
    and history.reason='source-revision-propagation'
  join parameter_catalog.project_parameter_values old_value on old_value.id=history.old_current_value_id
    and old_value.binding_id=pin.binding_id and old_value.definition_id=pin.definition_id
    and old_value.definition_revision_id=value.definition_revision_id
    and old_value.source_ref=value.source_ref and old_value.value_state='present'
    and old_value.value_kind=value.value_kind and old_value.value=value.value and old_value.value_digest=value.value_digest
  join parameter_catalog.project_value_source_pins old_pin on old_pin.project_value_id=old_value.id
    and old_pin.binding_id=pin.binding_id and old_pin.definition_id=pin.definition_id
    and old_pin.organization_id=pin.organization_id and old_pin.project_id=pin.project_id
    and old_pin.source_occurrence_id=pin.source_occurrence_id and old_pin.file_id=pin.file_id
    and old_pin.file_version_id=pin.file_version_id and old_pin.format='json' and old_pin.value_state='present'
    and old_pin.locator=pin.locator and old_pin.locator_digest=pin.locator_digest
    and old_pin.config_revision_id=old_value.config_revision_id
  join public.project_parameter_value_change_requests request on request.applied_audit_ref=history.success_audit_ref
    and request.organization_id=pin.organization_id and request.project_id=pin.project_id
    and request.request_kind='source_revision' and request.status='approved' and request.apply_outcome='committed'
    and request.source_revision_config_set_id=occurrence.config_set_id
    and request.source_revision_context->>'baseConfigRevisionId'=old_pin.config_revision_id
    and request.applied_source_result->>'configRevisionId'=pin.config_revision_id
  join public.project_parameter_file_candidates candidate on candidate.id=request.candidate_id
    and candidate.organization_id=request.organization_id and candidate.project_id=request.project_id
    and candidate.file_id=request.source_revision_context->>'fileId' and candidate.file_id<>pin.file_id
    and candidate.format='dts' and candidate.status='active'
    and candidate.activated_version_id=request.applied_source_result->>'fileVersionId'
  join public.dts_config_revisions revision on revision.id=pin.config_revision_id
    and revision.organization_id=pin.organization_id and revision.project_id=pin.project_id
    and revision.config_set_id=occurrence.config_set_id and revision.status='resolved'
  join public.dts_config_revision_members before_member on before_member.config_revision_id=old_pin.config_revision_id
    and before_member.file_id=old_pin.file_id and before_member.file_version_id=old_pin.file_version_id
  join public.dts_config_revision_members after_member on after_member.config_revision_id=pin.config_revision_id
    and after_member.file_id=pin.file_id and after_member.file_version_id=pin.file_version_id
    and after_member.source_name=before_member.source_name and after_member.role=before_member.role
    and after_member.sort_order=before_member.sort_order
  join public.audit_events audit on audit.id=request.applied_audit_ref
    and audit.organization_id=pin.organization_id and audit.project_id=pin.project_id
    and audit.target_id=request.id and audit.action='value-change-applied'
    and audit.metadata->'result'=request.applied_source_result
  where pin.id=p_pin_id and pin.format='json' and pin.value_state='present'
    and pin.property_occurrence_id is null and pin.locator->>'kind'='json-pointer'
    and request.source_revision_context->'cohort' @> jsonb_build_array(jsonb_build_object(
      'bindingId',binding.id,'oldValueId',old_value.id,'sourcePinId',old_pin.id,
      'sourceOccurrenceId',occurrence.id,'definitionId',binding.definition_id,
      'effectiveRevisionId',value.definition_revision_id,'catalogReleaseId',binding.catalog_release_id,
      'fileId',pin.file_id,'fileVersionId',pin.file_version_id,'format','json','locator',pin.locator))
    and not exists(select 1 from jsonb_array_elements(request.source_revision_context->'targets') target
      where target->>'bindingId'=binding.id)
    and not exists(select 1 from public.project_parameter_value_change_targets target
      where target.request_id=request.id and target.binding_id=binding.id)
    and request.applied_source_result->'results' @> jsonb_build_array(jsonb_build_object(
      'bindingId',binding.id,'oldValueId',old_value.id,'newValueId',value.id,
      'sourcePinId',pin.id,'historyEventId',history.id,'kind','derived'))
)
$$;
alter function parameter_catalog.retired_json_source_revision_matches(text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.retired_json_source_revision_matches(text) from public;

-- Preserve every surrounding owner/member/locator check and every active case.
do $$
declare installed text; changed text;
  marker text := $old$and registration.status = 'active'
          )
          and pin.locator->>'kind' = 'json-pointer'$old$;
begin
  select pg_get_functiondef('parameter_catalog.assert_project_value_source_pin_owner()'::regprocedure) into strict installed;
  changed := replace(installed,marker,$new$and (registration.status = 'active'
                or (registration.id=binding.registration_id and registration.status='retired'
                  and parameter_catalog.retired_json_source_revision_matches(pin.id)))
          )
          and pin.locator->>'kind' = 'json-pointer'$new$);
  if changed=installed then raise exception 'JSON source pin registration proof guard is unavailable'; end if;
  execute changed;
end $$;
