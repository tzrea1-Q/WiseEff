-- Definition erasure revokes a multi-parameter approval as one proof. Keep a
-- surviving, already verified physical origin through the existing immutable
-- erasure receipt, without retaining the erased parameter's request payload.
alter table parameter_catalog.project_value_source_pins
  drop constraint project_value_source_pin_delete_state_ck,
  add constraint project_value_source_pin_delete_state_ck check (
    (value_state='present' and base_source_pin_id is null and delete_request_id is null and delete_proof is null) or
    (value_state='deleted' and base_source_pin_id is not null and delete_proof is not null and
      ((delete_request_id is not null and erased_request_audit_id is null) or
       (delete_request_id is null and erased_request_audit_id is not null))));

do $$
declare installed text;
begin
  select pg_get_expr(conbin,conrelid) into strict installed from pg_constraint
    where conrelid='parameter_catalog.project_value_source_pins'::regclass and conname='project_value_source_pin_delete_proof_ck';
  alter table parameter_catalog.project_value_source_pins drop constraint project_value_source_pin_delete_proof_ck;
  execute format($proof$alter table parameter_catalog.project_value_source_pins add constraint project_value_source_pin_delete_proof_ck check (
    (%s) or (value_state='present' and base_source_pin_id is null and delete_request_id is null and delete_proof is null
      and erased_request_audit_id is not null))$proof$,installed);
  select prosrc into strict installed from pg_proc
    where oid='parameter_catalog.source_origin_matches(text,text,text)'::regprocedure;
  execute format($definition$create or replace function parameter_catalog.source_origin_matches(
    binding_id text, occurrence_id text, physical_file_id text)
    returns boolean language sql stable security definer set search_path=pg_catalog,parameter_catalog,public as %L$definition$,
    installed || $erased$
or exists (
  select 1 from parameter_catalog.project_parameter_bindings binding
  join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
    and occurrence.organization_id=binding.organization_id and occurrence.project_id=binding.project_id and occurrence.occurrence_kind='dts'
  join parameter_catalog.project_value_source_pins pin on pin.binding_id=binding.id and pin.source_occurrence_id=occurrence.id
    and pin.organization_id=binding.organization_id and pin.project_id=binding.project_id and pin.definition_id=binding.definition_id
    and pin.file_id=$3 and pin.value_state='present' and pin.format='dts'
  join parameter_catalog.definition_erasures erasure on erasure.audit_event_id=pin.erased_request_audit_id
  join public.dts_config_revisions revision on revision.id=pin.config_revision_id and revision.organization_id=binding.organization_id
    and revision.project_id=binding.project_id and revision.config_set_id=occurrence.config_set_id and revision.status='resolved'
  join public.dts_config_revision_members member on member.config_revision_id=revision.id and member.file_id=pin.file_id
    and member.file_version_id=pin.file_version_id
  join public.dts_property_occurrences property on property.id=pin.property_occurrence_id
    and property.config_revision_id=revision.id and property.file_version_id=member.file_version_id
    and pin.locator->>'propertyOccurrenceId'=property.id and pin.locator->>'nodeOccurrenceId'=property.node_occurrence_id
    and pin.locator->>'fileVersionId'=member.file_version_id and pin.locator->>'propertyName'=property.property_name
  join parameter_catalog.parameter_definitions definition on definition.id=binding.definition_id and definition.property_key=property.property_name
  join public.dts_occurrence_effects effect on effect.config_revision_id=revision.id and effect.property_occurrence_id=property.id
    and effect.node_occurrence_id=property.node_occurrence_id and effect.effect_kind in ('set','override')
  join public.dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
    and logical.config_revision_id=revision.id and logical.logical_node_id=occurrence.logical_node_id
  where binding.id=$1 and binding.source_occurrence_id=$2
    and not exists(select 1 from public.dts_occurrence_effects later where later.config_revision_id=effect.config_revision_id
      and later.logical_node_revision_id=effect.logical_node_revision_id and later.property_name=effect.property_name and later.source_order>effect.source_order)
)
$erased$);
end $$;

do $$
declare installed text; changed text;
begin
  -- Frozen contexts contain parameter payloads that do not necessarily have a
  -- target FK (new parameter admission, JSON mappings and origin transfers).
  -- Delete affected approvals whole; never relabel a sanitized frozen proof.
  select pg_get_functiondef('parameter_catalog.definition_purge_closure(text)'::regprocedure) into strict installed;
  changed:=replace(installed,'    exit when targets=previous;', $closure$
    select coalesce(jsonb_agg(jsonb_build_object('id',request.id)),'[]') into keys
      from public.project_parameter_value_change_requests request
      where parameter_catalog.definition_purge_json(request.source_revision_context,all_ids) is distinct from request.source_revision_context
        or parameter_catalog.definition_purge_json(request.member_frozen_proof,all_ids) is distinct from request.member_frozen_proof;
    targets:=parameter_catalog.definition_purge_add(targets,'public.project_parameter_value_change_requests',keys);
    exit when targets=previous;$closure$);
  if changed=installed then raise exception 'Definition erasure closure marker is unavailable'; end if;
  execute changed;

  select pg_get_functiondef('parameter_catalog.purge_parameter_definition(text,jsonb,text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,'  -- Only provenance is removed from surviving, carried-forward values.', $pins$
  -- Validate before deleting the approval. Only its exact surviving transfer
  -- pin receives this erasure's immutable receipt; ordinary writes cannot stamp it.
  select coalesce(jsonb_agg(parameter_catalog.definition_purge_key('parameter_catalog.project_value_source_pins',to_jsonb(pin))),'[]') into keys
    from parameter_catalog.project_value_source_pins pin
    join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=pin.source_occurrence_id
    where pin.definition_id<>p_id and pin.value_state='present' and pin.format='dts' and pin.file_id<>occurrence.file_id
      and parameter_catalog.source_origin_matches(pin.binding_id,pin.source_occurrence_id,pin.file_id)
      and exists(select 1 from public.project_parameter_value_change_requests request
        cross join lateral jsonb_array_elements(case when request.request_kind='member_addition'
          then request.applied_source_result->'results' else request.applied_source_result->'successorBindings' end) receipt
        where request.id=any(parameter_catalog.definition_purge_ids(targets,'public.project_parameter_value_change_requests'))
          and request.request_kind in ('member_addition','member-removal')
          and receipt->>'sourcePinId'=pin.id and receipt->>'bindingId'=pin.binding_id
          and receipt->>'newValueId'=pin.project_value_id);
  perform parameter_catalog.definition_purge_mark('parameter_catalog.project_value_source_pins',keys,'UPDATE');
  update parameter_catalog.project_value_source_pins pin set erased_request_audit_id=p_audit_id
    where keys @> jsonb_build_array(parameter_catalog.definition_purge_key('parameter_catalog.project_value_source_pins',to_jsonb(pin)));

  -- Only provenance is removed from surviving, carried-forward values.$pins$);
  if changed=installed then raise exception 'Definition erasure provenance marker is unavailable'; end if;
  execute changed;
end $$;
