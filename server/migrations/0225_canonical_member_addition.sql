-- A human-confirmed composition change uses the existing frozen source request,
-- target, value and audit transaction; upload remains a separate candidate.
do $$
declare installed text;
begin
  select pg_get_expr(conbin,conrelid) into strict installed from pg_constraint
    where conrelid='public.project_parameter_value_change_requests'::regclass and conname='project_parameter_value_change_requests_kind_ck';
  alter table public.project_parameter_value_change_requests drop constraint project_parameter_value_change_requests_kind_ck;
  execute format($sql$alter table public.project_parameter_value_change_requests add constraint project_parameter_value_change_requests_kind_ck check (
    (%s) or (request_kind='member_addition' and draft_id is null and binding_id is null and definition_id is null
      and definition_revision_id is null and catalog_release_id is null and base_current_value_id is null and config_revision_id is null
      and source_ref is null and action is null and target_value is null and source_pin_id is null
      and batch_proof_digest is null and batch_target_count is null and batch_cohort_count is null
      and batch_source_proof_token is null and batch_cohort_proof_token is null and batch_file_id is null
      and batch_base_version_id is null and batch_config_set_id is null and member_file_id is null
      and member_config_set_id is null and member_file_version_id is null and member_frozen_proof is null and member_proof_digest is null
      and source_revision_context->>'kind'='member_addition'
      and source_revision_context->>'organizationId'=organization_id and source_revision_context->>'projectId'=project_id
      and source_revision_context->>'configSetId'=source_revision_config_set_id
      and source_revision_context->>'proofDigest'=source_revision_proof_digest
      and source_revision_context->'members'=candidate_member_manifest and source_revision_context->'cohort'=candidate_binding_manifest
      and source_revision_context->>'baseDigest'=candidate_base_digest and source_revision_context->>'proposedDigest'=candidate_proposed_digest
      and source_revision_proof_digest=candidate_diff_digest and source_revision_proof_digest ~ '^[0-9a-f]{64}$'
      and nullif(source_revision_mutation_id,'') is not null and source_revision_mutation_digest ~ '^[0-9a-f]{64}$'
      and source_revision_application_mode='administrator_direct' and assigned_to_user_id is null and reviewer_user_id is null) is true)$sql$,installed);
  select pg_get_expr(conbin,conrelid) into strict installed from pg_constraint
    where conrelid='public.project_parameter_value_change_requests'::regclass and conname='project_parameter_value_change_requests_outcome_ck';
  alter table public.project_parameter_value_change_requests drop constraint project_parameter_value_change_requests_outcome_ck;
  execute format($sql$alter table public.project_parameter_value_change_requests add constraint project_parameter_value_change_requests_outcome_ck check (
    (%s) or (request_kind='member_addition' and applied_value_id is null and applied_history_event_id is null
      and ((status='approved' and apply_outcome='committed' and applied_at is not null and applied_audit_ref is not null
        and jsonb_typeof(applied_source_result)='object' and jsonb_typeof(applied_file_version_ids)='array' and jsonb_array_length(applied_file_version_ids)=1)
      or (status='pending' and applied_at is null and applied_audit_ref is null and applied_source_result is null and applied_file_version_ids is null))) is true)$sql$,installed);
  select pg_get_expr(conbin,conrelid) into strict installed from pg_constraint
    where conrelid='public.project_parameter_value_change_requests'::regclass and conname='project_parameter_source_application_mode_ck';
  alter table public.project_parameter_value_change_requests drop constraint project_parameter_source_application_mode_ck;
  execute format($sql$alter table public.project_parameter_value_change_requests add constraint project_parameter_source_application_mode_ck check (
    (%s) or (source_revision_application_mode='administrator_direct' and request_kind='member_addition' and assigned_to_user_id is null and reviewer_user_id is null))$sql$,installed);
end $$;

-- The occurrence remains the immutable logical-node anchor. An effective
-- property's physical origin can move to another member of the same compiled
-- graph, with a frozen administrator transaction and exact old/new receipts.
create function parameter_catalog.source_origin_matches(binding_id text, occurrence_id text, physical_file_id text)
returns boolean language sql stable security definer set search_path=pg_catalog,parameter_catalog,public as $$
select exists (
  select 1 from public.project_parameter_value_change_requests request
  cross join lateral jsonb_array_elements(case when request.request_kind='member_addition'
    then request.source_revision_context->'originTransfers' else request.member_frozen_proof->'originTransfers' end) transfer
  cross join lateral jsonb_array_elements(case when request.request_kind='member_addition'
    then request.applied_source_result->'results' else request.applied_source_result->'successorBindings' end) receipt
  join parameter_catalog.project_parameter_bindings binding on binding.id=$1 and binding.id=transfer->>'bindingId'
    and binding.source_occurrence_id=$2 and binding.organization_id=request.organization_id and binding.project_id=request.project_id
  join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
    and occurrence.organization_id=binding.organization_id and occurrence.project_id=binding.project_id and occurrence.occurrence_kind='dts'
  join parameter_catalog.project_value_source_pins base_pin on base_pin.id=transfer->>'sourcePinId'
    and base_pin.binding_id=binding.id and base_pin.project_value_id=transfer->>'oldValueId'
    and base_pin.source_occurrence_id=occurrence.id and base_pin.file_id=transfer->>'fromFileId' and base_pin.value_state='present'
  join parameter_catalog.project_value_source_pins next_pin on next_pin.id=receipt->>'sourcePinId'
    and next_pin.binding_id=binding.id and next_pin.source_occurrence_id=occurrence.id
    and next_pin.organization_id=binding.organization_id and next_pin.project_id=binding.project_id
    and next_pin.definition_id=binding.definition_id and next_pin.project_value_id=receipt->>'newValueId'
    and next_pin.file_id=$3 and next_pin.file_id=transfer->>'toFileId' and next_pin.value_state='present' and next_pin.format='dts'
  join public.dts_config_revisions revision on revision.id=next_pin.config_revision_id and revision.organization_id=binding.organization_id
    and revision.project_id=binding.project_id and revision.config_set_id=occurrence.config_set_id and revision.status='resolved'
  join public.dts_config_revision_members member on member.config_revision_id=revision.id and member.file_id=next_pin.file_id
    and member.file_version_id=next_pin.file_version_id
  join public.dts_property_occurrences property on property.id=next_pin.property_occurrence_id
    and property.config_revision_id=revision.id and property.file_version_id=member.file_version_id
    and next_pin.locator->>'propertyOccurrenceId'=property.id and next_pin.locator->>'nodeOccurrenceId'=property.node_occurrence_id
    and next_pin.locator->>'fileVersionId'=member.file_version_id and next_pin.locator->>'propertyName'=property.property_name
  join parameter_catalog.parameter_definitions definition on definition.id=binding.definition_id and definition.property_key=property.property_name
  join public.dts_occurrence_effects effect on effect.config_revision_id=revision.id and effect.property_occurrence_id=property.id
    and effect.node_occurrence_id=property.node_occurrence_id and effect.effect_kind in ('set','override')
  join public.dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
    and logical.config_revision_id=revision.id and logical.logical_node_id=occurrence.logical_node_id
  join parameter_catalog.binding_history_events history on history.id=receipt->>'historyEventId' and history.binding_id=binding.id
    and history.old_current_value_id=base_pin.project_value_id and history.new_current_value_id=next_pin.project_value_id
    and history.success_audit_ref=request.applied_audit_ref
  join public.audit_events audit on audit.id=request.applied_audit_ref and audit.organization_id=request.organization_id and audit.project_id=request.project_id
  where request.request_kind in ('member_addition','member-removal') and request.status='approved'
    and receipt->>'bindingId'=binding.id and receipt->>'oldValueId'=base_pin.project_value_id
    and next_pin.config_revision_id=case when request.request_kind='member_addition' then request.applied_source_result->>'configRevisionId'
      else request.applied_source_result->>'successorConfigRevisionId' end
    and ((request.request_kind='member_addition' and audit.target_id=request.id and audit.action='value-change-applied'
      and audit.metadata->'result'=request.applied_source_result)
      or (request.request_kind='member-removal' and audit.action='source-member-removed'
        and audit.metadata->>'reviewRequestId'=request.id and audit.metadata->'successorBindings'=request.applied_source_result->'successorBindings'))
    and not exists(select 1 from public.dts_occurrence_effects later where later.config_revision_id=effect.config_revision_id
      and later.logical_node_revision_id=effect.logical_node_revision_id and later.property_name=effect.property_name and later.source_order>effect.source_order)
)
$$;
alter function parameter_catalog.source_origin_matches(text,text,text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.source_origin_matches(text,text,text) from public;
do $$
declare installed text; changed text;
begin
  select pg_get_functiondef('parameter_catalog.assert_project_value_source_pin_owner()'::regprocedure) into strict installed;
  changed := replace(installed, 'and file.id = occurrence.file_id',
    'and (file.id = occurrence.file_id or parameter_catalog.source_origin_matches(pin.binding_id,pin.source_occurrence_id,pin.file_id))');
  if changed=installed then raise exception 'Source physical-origin proof marker is unavailable'; end if;
  execute changed;
  if exists(select 1 from pg_roles where rolname='wiseeff_api') then
    grant execute on function parameter_catalog.source_origin_matches(text,text,text) to wiseeff_api;
  end if;
end $$;

-- Reuse the exact source-absence proof for a newly added overlay replacing an
-- old effective origin. Do not alter the provenance conditions themselves.
do $$
declare installed text; changed text;
begin
  select pg_get_functiondef('parameter_catalog.valid_source_revision_absence_pin(text)'::regprocedure) into strict installed;
  changed := replace(installed, 'request.request_kind=''source_revision''', 'request.request_kind in (''source_revision'',''member_addition'')');
  if changed=installed then raise exception 'Source absence proof marker is unavailable'; end if;
  execute changed;
  select pg_get_functiondef('parameter_catalog.assert_batch_value_request()'::regprocedure) into strict installed;
  changed := replace(installed, 'request_row.request_kind=''source_revision''', 'request_row.request_kind in (''source_revision'',''member_addition'')');
  if changed=installed then raise exception 'Source target proof marker is unavailable'; end if;
  execute changed;
  select pg_get_functiondef('parameter_catalog.assert_source_candidate_snapshot()'::regprocedure) into strict installed;
  changed := replace(installed, '-- The member manifest is a frozen parser/export input.', $branch$
  if tg_table_name='project_parameter_value_change_requests' and exists(
    select 1 from public.project_parameter_value_change_requests request where request.id=new.id
      and request.organization_id=new.organization_id and request.project_id=new.project_id and request.request_kind='member_addition') then
    -- Its complete AFTER composition is checked by assert_member_addition_receipt.
    return null;
  end if;
  -- The member manifest is a frozen parser/export input.$branch$);
  if changed=installed then raise exception 'Source candidate manifest proof marker is unavailable'; end if;
  execute changed;
end $$;

create function parameter_catalog.assert_member_addition_receipt()
returns trigger language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
declare r public.project_parameter_value_change_requests%rowtype; result jsonb;
begin
  if tg_table_name='project_parameter_value_change_targets' then
    select * into r from public.project_parameter_value_change_requests where id=new.request_id;
  else
    select * into r from public.project_parameter_value_change_requests where id=new.id;
  end if;
  if r.request_kind<>'member_addition' then return null; end if;
  result := r.applied_source_result;
  if r.status<>'approved' or result->>'requestId' is distinct from r.id
    or result->>'sourceRevisionProofDigest' is distinct from r.source_revision_proof_digest
    or result->>'fileId' is distinct from r.source_revision_context->>'fileId'
    or not exists(select 1 from public.dts_config_revisions revision
      join public.dts_config_revision_members member on member.config_revision_id=revision.id and member.file_id=result->>'fileId'
        and member.file_version_id=result->>'fileVersionId'
      join public.project_parameter_files file on file.id=member.file_id and file.organization_id=r.organization_id
        and file.project_id=r.project_id and file.config_set_id=revision.config_set_id and file.current_version_id=member.file_version_id
        and file.config_set_role=member.role and file.config_set_sort_order=member.sort_order
      join public.project_parameter_file_versions version on version.id=member.file_version_id and version.file_id=file.id
      join public.audit_events audit on audit.id=r.applied_audit_ref and audit.organization_id=r.organization_id
        and audit.project_id=r.project_id and audit.target_id=r.id and audit.action='value-change-applied'
        and audit.metadata->'result'=result and audit.metadata->>'requestKind'='member_addition'
      where revision.id=result->>'configRevisionId' and revision.organization_id=r.organization_id and revision.project_id=r.project_id
        and revision.config_set_id=r.source_revision_config_set_id and revision.status='resolved'
        and regexp_replace(version.checksum,'^sha256:','')=r.candidate_proposed_digest)
    or (r.candidate_id is not null and not exists(select 1 from public.project_parameter_file_candidates candidate
      where candidate.id=r.candidate_id and candidate.organization_id=r.organization_id and candidate.project_id=r.project_id
        and candidate.status='active' and candidate.file_id=result->>'fileId' and candidate.activated_version_id=result->>'fileVersionId')) then
    raise exception using errcode='23514',message='Member addition has no complete owned composition receipt';
  end if;
  if (select count(*) from public.dts_config_revision_members where config_revision_id=result->>'configRevisionId')
      <> jsonb_array_length(r.source_revision_context->'members')
    or exists(select 1 from jsonb_array_elements(r.source_revision_context->'members') frozen
      where not exists(select 1 from public.dts_config_revision_members member join public.project_parameter_files file on file.id=member.file_id
        where member.config_revision_id=result->>'configRevisionId' and member.file_id=frozen->>'fileId'
          and member.file_version_id=case when member.file_id=result->>'fileId' then result->>'fileVersionId' else frozen->>'fileVersionId' end
          and member.source_name=frozen->>'sourceName' and member.role=frozen->>'role' and member.sort_order=(frozen->>'sortOrder')::integer
          and file.format=frozen->>'format' and file.config_set_id=r.source_revision_config_set_id
          and file.current_version_id=member.file_version_id)) then
    raise exception using errcode='23514',message='Member addition lost its frozen complete composition';
  end if;
  if jsonb_array_length(result->'results')<>jsonb_array_length(r.source_revision_context->'cohort')
    or exists(select 1 from jsonb_array_elements(r.source_revision_context->'cohort') frozen
      where not exists(select 1 from jsonb_array_elements(result->'results') receipt
        join parameter_catalog.project_parameter_values value on value.id=receipt->>'newValueId' and value.binding_id=receipt->>'bindingId'
          and value.config_revision_id=result->>'configRevisionId'
        join parameter_catalog.project_value_source_pins pin on pin.id=receipt->>'sourcePinId' and pin.project_value_id=value.id
          and pin.binding_id=value.binding_id and pin.organization_id=r.organization_id and pin.project_id=r.project_id
          and pin.config_revision_id=value.config_revision_id
        join parameter_catalog.binding_history_events history on history.id=receipt->>'historyEventId' and history.binding_id=value.binding_id
          and history.old_current_value_id=frozen->>'oldValueId' and history.new_current_value_id=value.id and history.success_audit_ref=r.applied_audit_ref
        where receipt->>'bindingId'=frozen->>'bindingId' and receipt->>'oldValueId'=frozen->>'oldValueId'))
    or (select count(*) from public.project_parameter_value_change_targets where request_id=r.id)<>jsonb_array_length(r.source_revision_context->'targets')
    or exists(select 1 from public.project_parameter_value_change_targets target where target.request_id=r.id
      and (target.applied_value_id is null or target.applied_source_pin_id is null or target.applied_history_event_id is null
        or not exists(select 1 from jsonb_array_elements(r.source_revision_context->'targets') frozen
          where frozen->>'bindingId'=target.binding_id and frozen->>'action'=target.action and frozen->'payload'=target.target_value))) then
    raise exception using errcode='23514',message='Member addition has an incomplete parameter cohort receipt';
  end if;
  if exists(select 1 from jsonb_array_elements(r.source_revision_context->'newProperties') planned
    where not exists(select 1 from parameter_catalog.project_parameter_bindings binding
      join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
      join parameter_catalog.project_value_source_pins pin on pin.binding_id=binding.id and pin.project_value_id=binding.current_value_id
      where binding.organization_id=r.organization_id and binding.project_id=r.project_id and binding.definition_id=planned->>'definitionId'
        and occurrence.config_set_id=r.source_revision_config_set_id and occurrence.file_id=planned->>'fileId'
        and occurrence.logical_node_id=planned->>'logicalNodeId' and pin.config_revision_id=result->>'configRevisionId')) then
    raise exception using errcode='23514',message='Member addition did not materialize every new source parameter';
  end if;
  return null;
end $$;
create constraint trigger project_parameter_member_addition_receipt_ck after insert or update on public.project_parameter_value_change_requests
  deferrable initially deferred for each row when(new.request_kind='member_addition') execute function parameter_catalog.assert_member_addition_receipt();
create constraint trigger project_parameter_member_addition_target_ck after insert or update on public.project_parameter_value_change_targets
  deferrable initially deferred for each row execute function parameter_catalog.assert_member_addition_receipt();
alter function parameter_catalog.assert_member_addition_receipt() owner to catalog_migration_owner;
revoke all on function parameter_catalog.assert_member_addition_receipt() from public;
