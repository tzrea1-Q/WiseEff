-- A root swap updates two roles before publishing one complete revision. Permit
-- only the frozen administrator transition through the pinned-file guard; the
-- deferred receipt below requires one DTS base and an entry_file naming it at
-- commit. Ordinary role changes remain forbidden, including half-finished swaps.
do $$
declare installed text; changed text; marker text := '      if old.config_set_id is not null and new.config_set_id is null';
begin
  select pg_get_functiondef('parameter_catalog.protect_pinned_source_file()'::regprocedure) into strict installed;
  changed := replace(installed,marker,$allow$
      if old.config_set_id=new.config_set_id and old.current_version_id=new.current_version_id
        and (to_jsonb(new)-array['config_set_role','config_set_sort_order','updated_at'])
          is not distinct from (to_jsonb(old)-array['config_set_role','config_set_sort_order','updated_at'])
        and exists(select 1 from public.project_parameter_value_change_requests request
          cross join lateral jsonb_array_elements(request.source_revision_context->'members') planned
          join public.dts_config_revision_members before_member
            on before_member.config_revision_id=request.source_revision_context->>'baseConfigRevisionId'
            and before_member.file_id=old.id and before_member.file_version_id=old.current_version_id
            and (case when before_member.role='include' then 'misc' else before_member.role end)=old.config_set_role
            and before_member.sort_order=old.config_set_sort_order
          where request.organization_id=old.organization_id and request.project_id=old.project_id
            and request.source_revision_config_set_id=old.config_set_id
            and request.request_kind='member_addition' and request.status='pending'
            and request.source_revision_application_mode='administrator_direct'
            and request.source_revision_context->'setAsRoot'='true'::jsonb
            and planned->>'fileId'=old.id and planned->>'fileVersionId'=old.current_version_id
            and new.config_set_role=case when planned->>'role'='include' then 'misc' else planned->>'role' end
            and new.config_set_sort_order=(planned->>'sortOrder')::integer
            and old.format='dts' and (
              (old.id=request.source_revision_context->>'fileId' and old.config_set_role<>'base'
                and new.config_set_role='base' and new.config_set_sort_order=0)
              or (before_member.role='base' and new.config_set_role='overlay' and new.config_set_sort_order=1)
              or (old.config_set_role='overlay' and new.config_set_role='overlay' and new.config_set_sort_order>=2))) then return new;
      end if;
$allow$ || marker);
  if changed=installed then raise exception 'Pinned file member transition guard is unavailable'; end if;
  execute changed;
end $$;

-- This is a proof predicate, not a write API. Activation callers additionally
-- require a pending request and the exact current tip. Approved receipts can use
-- the same predicate to verify immutable history and physical-source ownership.
create function parameter_catalog.source_anchor_restoration_matches(p_request_id text,p_binding_id text,p_old_value_id text,p_revision_id text)
returns boolean language sql stable security definer set search_path=pg_catalog,parameter_catalog,public as $$
select exists(
  select 1 from public.project_parameter_value_change_requests request
  cross join lateral (select case when request.request_kind='member-removal' then request.member_frozen_proof
    else request.source_revision_context end as proof) context
  cross join lateral jsonb_array_elements(context.proof->'restorations') planned
  join parameter_catalog.project_parameter_bindings binding on binding.id=p_binding_id
    and binding.organization_id=request.organization_id and binding.project_id=request.project_id
  join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
    and occurrence.organization_id=binding.organization_id and occurrence.project_id=binding.project_id
    and occurrence.config_set_id=coalesce(request.source_revision_config_set_id,request.member_config_set_id)
  join parameter_catalog.project_parameter_values old_value on old_value.id=p_old_value_id
    and old_value.binding_id=binding.id and old_value.value_state='deleted'
  join parameter_catalog.project_value_source_pins old_pin on old_pin.id=planned->>'sourcePinId'
    and old_pin.project_value_id=old_value.id and old_pin.binding_id=binding.id
    and old_pin.source_occurrence_id=occurrence.id and old_pin.value_state='deleted' and old_pin.format='dts'
    and old_pin.organization_id=request.organization_id and old_pin.project_id=request.project_id
    and old_pin.file_id=planned->>'fileId' and old_pin.locator->>'propertyName'=planned->>'propertyName'
  join parameter_catalog.project_value_source_pins base_pin on base_pin.id=old_pin.base_source_pin_id
    and base_pin.binding_id=binding.id and base_pin.source_occurrence_id=occurrence.id and base_pin.value_state='present'
  join public.dts_logical_node_revisions base_node on base_node.config_revision_id=base_pin.config_revision_id
    and base_node.logical_node_id=binding.logical_node_id and base_node.node_locator=planned->>'nodeLocator'
  join parameter_catalog.parameter_definitions definition on definition.id=binding.definition_id
    and definition.property_key=planned->>'propertyName'
  where request.id=p_request_id and request.status in ('pending','approved')
    and request.request_kind in ('source_revision','member_addition','member-removal')
    and (request.request_kind<>'member-removal' or request.member_application_mode='administrator_direct')
    and planned->>'bindingId'=binding.id and planned->>'oldValueId'=old_value.id
    and planned->>'sourceOccurrenceId'=occurrence.id and planned->>'definitionId'=binding.definition_id
    and planned->>'effectiveRevisionId'=binding.effective_revision_id and planned->>'catalogReleaseId'=binding.catalog_release_id
    and planned->>'registrationId'=binding.registration_id and planned->>'subjectId'=binding.subject_id
    and planned->>'logicalNodeId'=binding.logical_node_id
    and context.proof->'cohort' @> jsonb_build_array(jsonb_build_object('bindingId',binding.id,'oldValueId',old_value.id,'sourcePinId',old_pin.id))
    and not parameter_catalog.is_replaced_current_binding(binding.id)
    and (p_revision_id is null or exists(select 1 from public.dts_config_revisions revision
      join public.dts_config_revision_members member on member.config_revision_id=revision.id and member.file_id=old_pin.file_id
      join public.dts_logical_node_revisions logical on logical.config_revision_id=revision.id
        and logical.logical_node_id=binding.logical_node_id and logical.node_locator=planned->>'nodeLocator'
      join public.dts_occurrence_effects effect on effect.logical_node_revision_id=logical.id and effect.config_revision_id=revision.id
        and effect.property_name=planned->>'propertyName' and effect.effect_kind in ('set','override')
      join public.dts_property_occurrences property on property.id=effect.property_occurrence_id and property.file_version_id=member.file_version_id
      where revision.id=p_revision_id and revision.organization_id=request.organization_id and revision.project_id=request.project_id
        and revision.config_set_id=occurrence.config_set_id and revision.status='resolved'
        and not exists(select 1 from public.dts_occurrence_effects later where later.config_revision_id=revision.id
          and later.logical_node_revision_id=logical.id and later.property_name=effect.property_name and later.source_order>effect.source_order)))
)
$$;
alter function parameter_catalog.source_anchor_restoration_matches(text,text,text,text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.source_anchor_restoration_matches(text,text,text,text) from public;
grant execute on function parameter_catalog.source_anchor_restoration_matches(text,text,text,text) to parameter_governance_writer_role;
do $$ begin
  if exists(select 1 from pg_roles where rolname='wiseeff_api') then
    grant execute on function parameter_catalog.source_anchor_restoration_matches(text,text,text,text) to wiseeff_api;
  end if;
end $$;

-- A restored survivor has a deleted absence pin, rather than an unchanged
-- present-property locator. Admit that geometry only with the matched anchor
-- predicate; retain every ordinary survivor/transfer/tombstone check.
do $$
declare installed text; changed text; restoration text;
begin
  restoration := $proof$exists(select 1 from public.project_parameter_value_change_requests restoration_request
    join public.audit_events restoration_audit on restoration_audit.metadata->>'reviewRequestId'=restoration_request.id
    where restoration_audit.id=new.audit_event_id and restoration_request.request_kind='member-removal'
      and restoration_request.member_application_mode='administrator_direct'
      and parameter_catalog.source_anchor_restoration_matches(restoration_request.id,binding.id,old_value.id,new.successor_config_revision_id))$proof$;
  select pg_get_functiondef('parameter_catalog.assert_member_removal_tombstone()'::regprocedure) into strict installed;
  changed := replace(installed,'and old_pin.config_revision_id=new.config_revision_id',
    'and (old_pin.config_revision_id=new.config_revision_id or '||restoration||')');
  changed := replace(changed,'and new_pin.source_occurrence_id=old_pin.source_occurrence_id and (',
    'and new_pin.source_occurrence_id=old_pin.source_occurrence_id and ('||restoration||' or ');
  changed := replace(changed,'and ((new_pin.file_id=old_pin.file_id',
    'and ('||restoration||' or (new_pin.file_id=old_pin.file_id');
  changed := replace(changed,'and (new_value.value_digest=old_value.value_digest or ',
    'and (new_value.value_digest=old_value.value_digest or '||restoration||' or ');
  changed := replace(changed,'and new_value.value_kind=old_value.value_kind',
    'and (new_value.value_kind=old_value.value_kind or '||restoration||')');
  if changed=installed or position(restoration in changed)=0 then raise exception 'Member survivor restoration markers are unavailable'; end if;
  execute changed;

  -- An anchor can retain an immutable occurrence whose physical origin was
  -- transferred before deletion. Its restoration receipt proves that same
  -- physical file, without changing the occurrence or inventing a new owner.
  select pg_get_functiondef('parameter_catalog.assert_project_value_source_pin_owner()'::regprocedure) into strict installed;
  changed := replace(installed,'parameter_catalog.source_origin_matches(pin.binding_id,pin.source_occurrence_id,pin.file_id)',
    $origin$(parameter_catalog.source_origin_matches(pin.binding_id,pin.source_occurrence_id,pin.file_id)
      or exists(select 1 from public.project_parameter_value_change_requests restoration_request
        cross join lateral jsonb_array_elements(case when restoration_request.request_kind='member-removal'
          then restoration_request.member_frozen_proof->'restorations' else restoration_request.source_revision_context->'restorations' end) restored
        where restored->>'bindingId'=pin.binding_id and restored->>'fileId'=pin.file_id
          and parameter_catalog.source_anchor_restoration_matches(restoration_request.id,pin.binding_id,restored->>'oldValueId',pin.config_revision_id)))$origin$);
  if changed=installed then raise exception 'Source pin physical-origin marker is unavailable'; end if;
  execute changed;
end $$;

create function parameter_catalog.assert_administrator_source_transitions() returns trigger language plpgsql security definer
set search_path=pg_catalog,parameter_catalog,public as $$
declare r public.project_parameter_value_change_requests%rowtype; proof jsonb; result jsonb; planned jsonb; revision_id text; old_root text;
begin
  if tg_op='UPDATE' and old.status='approved' then return null; end if;
  select * into r from public.project_parameter_value_change_requests where id=new.id;
  proof := case when r.request_kind='member-removal' then r.member_frozen_proof else r.source_revision_context end;
  if proof->'setAsRoot' is distinct from 'true'::jsonb and jsonb_array_length(coalesce(proof->'restorations','[]'))=0 then return null; end if;
  -- Separate review deliberately commits a frozen, unapplied request before a
  -- second person approves it. Only approval requires restoration receipts;
  -- administrator-direct operations must still finish in this transaction.
  if r.request_kind='source_revision' and r.source_revision_application_mode='separate_review' and r.status in ('pending','rejected','withdrawn')
    and proof->'setAsRoot' is distinct from 'true'::jsonb
    and r.applied_source_result is null and r.applied_audit_ref is null then return null; end if;
  if r.status<>'approved' then raise exception using errcode='23514',message='Source transition requires its committed receipt'; end if;
  result := r.applied_source_result;
  revision_id := coalesce(result->>'configRevisionId',result->>'successorConfigRevisionId');
  if proof->'setAsRoot'='true'::jsonb then
    select member.source_name into old_root from public.dts_config_revision_members member
      join public.project_parameter_files file on file.id=member.file_id and file.format='dts'
      where member.config_revision_id=proof->>'baseConfigRevisionId' and member.role='base';
    if r.request_kind<>'member_addition' or r.source_revision_application_mode<>'administrator_direct'
      or old_root is null or proof->'overlayOrder'->>0 is distinct from old_root
      or (select count(*) from public.dts_config_revision_members member join public.project_parameter_files file on file.id=member.file_id
        where member.config_revision_id=revision_id and file.format='dts' and member.role='base')<>1
      or not exists(select 1 from public.dts_config_revisions revision
        join public.dts_config_revision_members member on member.config_revision_id=revision.id
          and member.file_id=proof->>'fileId' and member.role='base' and member.source_name=revision.entry_file
        join public.project_parameter_files selected_file on selected_file.id=member.file_id and selected_file.format='dts'
        where revision.id=revision_id and revision.entry_file=proof->>'entryFile' and revision.entry_file<>old_root
          and revision.overlay_order=proof->'overlayOrder' and revision.include_search_paths=proof->'includeSearchPaths')
      or not exists(select 1 from public.dts_config_revision_members member where member.config_revision_id=revision_id
        and member.source_name=old_root and member.role='overlay')
      or exists(select 1 from public.dts_config_revision_members member join public.project_parameter_files file on file.id=member.file_id
        where member.config_revision_id=revision_id and (file.config_set_id is distinct from r.source_revision_config_set_id
          or file.config_set_role is distinct from case when member.role='include' then 'misc' else member.role end
          or file.config_set_sort_order<>member.sort_order)) then
      raise exception using errcode='23514',message='Root swap requires one base, its entry file, and the former root as first overlay';
    end if;
  end if;
  for planned in select value from jsonb_array_elements(coalesce(proof->'restorations','[]')) loop
    if not parameter_catalog.source_anchor_restoration_matches(r.id,planned->>'bindingId',planned->>'oldValueId',revision_id)
      or not exists(select 1 from jsonb_array_elements(coalesce(result->'results',result->'successorBindings')) receipt
        join parameter_catalog.project_parameter_values value on value.id=receipt->>'newValueId' and value.binding_id=planned->>'bindingId' and value.value_state='present'
        join parameter_catalog.project_value_source_pins pin on pin.id=receipt->>'sourcePinId' and pin.project_value_id=value.id
          and pin.binding_id=value.binding_id and pin.config_revision_id=revision_id and pin.file_id=planned->>'fileId'
        join parameter_catalog.binding_history_events history on history.id=receipt->>'historyEventId'
          and history.binding_id=value.binding_id and history.old_current_value_id=planned->>'oldValueId'
          and history.new_current_value_id=value.id and history.success_audit_ref=r.applied_audit_ref
        join public.audit_events audit on audit.id=history.success_audit_ref and audit.organization_id=r.organization_id and audit.project_id=r.project_id
        where receipt->>'bindingId'=planned->>'bindingId' and receipt->>'oldValueId'=planned->>'oldValueId'
          and value.value_kind=planned->'payload'->>'kind' and value.value=planned->'payload'->'value') then
      raise exception using errcode='23514',message='Restored source anchor requires its exact value, pin, history and transaction audit';
    end if;
  end loop;
  return null;
end $$;
create constraint trigger project_parameter_administrator_source_transitions_ck after insert or update on public.project_parameter_value_change_requests
  deferrable initially deferred for each row execute function parameter_catalog.assert_administrator_source_transitions();
alter function parameter_catalog.assert_administrator_source_transitions() owner to catalog_migration_owner;
revoke all on function parameter_catalog.assert_administrator_source_transitions() from public;
