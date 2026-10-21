-- Extend the existing audited member tombstone transaction. Separate-review
-- requests retain their original proof; direct applications honestly name one actor.
alter table parameter_catalog.project_source_member_tombstones drop constraint project_source_member_tombstone_successor_ck;
alter table parameter_catalog.project_source_member_tombstones add constraint project_source_member_tombstone_successor_ck check (
  (successor_config_revision_id is null and successor_binding_manifest is null)
  or (successor_config_revision_id is not null and jsonb_typeof(successor_binding_manifest)='array'));
alter table public.project_parameter_value_change_requests
  add column member_application_mode text not null default 'separate_review',
  add column member_mutation_id text,
  add column member_mutation_digest text,
  add constraint project_parameter_member_application_mode_ck check (
    member_application_mode='separate_review' or (member_application_mode='administrator_direct'
      and request_kind='member-removal' and assigned_to_user_id is null and reviewer_user_id is null
      and nullif(member_mutation_id,'') is not null and member_mutation_digest ~ '^[a-f0-9]{64}$'));
create unique index project_parameter_member_mutation_uk on public.project_parameter_value_change_requests
  (organization_id,project_id,submitter_user_id,member_mutation_id) where member_mutation_id is not null;

create function parameter_catalog.protect_member_application_mode() returns trigger language plpgsql
set search_path=pg_catalog,parameter_catalog,public as $$
begin
  if new.member_application_mode is distinct from old.member_application_mode
    or new.member_mutation_id is distinct from old.member_mutation_id
    or new.member_mutation_digest is distinct from old.member_mutation_digest then
    raise exception using errcode='23514',message='Member application intent is immutable';
  end if;
  return new;
end $$;
create trigger project_parameter_member_application_immutable before update on public.project_parameter_value_change_requests
  for each row execute function parameter_catalog.protect_member_application_mode();
alter function parameter_catalog.protect_member_application_mode() owner to catalog_migration_owner;
revoke all on function parameter_catalog.protect_member_application_mode() from public;

-- Retirement follows the current physical source pin. The immutable occurrence
-- remains the same when removing an overlay exposes a verified fallback source.
create or replace view parameter_catalog.current_project_parameter_bindings as
select binding.* from parameter_catalog.project_parameter_bindings binding
where not exists(select 1 from parameter_catalog.definition_replacement_projects replacement
  where replacement.status='completed' and replacement.old_binding_id=binding.id)
and not exists(select 1 from parameter_catalog.project_parameter_values value
  where value.id=binding.current_value_id and value.value_state='deleted')
and not exists(select 1 from parameter_catalog.project_parameter_values value
  join parameter_catalog.project_value_source_pins pin on pin.project_value_id=value.id and pin.binding_id=value.binding_id
  where value.id=binding.current_value_id and pin.locator->>'kind' in ('dts-delete','json-delete'))
and not exists(select 1 from parameter_catalog.project_parameter_source_occurrences occurrence
  join parameter_catalog.project_source_member_tombstones tombstone on tombstone.organization_id=occurrence.organization_id
    and tombstone.project_id=occurrence.project_id and tombstone.config_set_id=occurrence.config_set_id
    and tombstone.file_id=coalesce((select pin.file_id from parameter_catalog.project_value_source_pins pin
      where pin.binding_id=binding.id and pin.project_value_id=binding.current_value_id),occurrence.file_id)
  where occurrence.id=binding.source_occurrence_id);

-- Keep populated installations' disposal wrappers and all unrelated receipt clauses.
do $migration$
declare original text; rewritten text; marker text; transfer_clause text; frozen_cohort_clause text;
begin
  select pg_get_functiondef('parameter_catalog.assert_member_removal_request()'::regprocedure) into original;
  marker := 'if request_row.request_kind <> ''member-removal'' then return null; end if;';
  if position(marker in original)=0 then raise exception 'member request guard changed'; end if;
  rewritten := replace(original,marker,marker || $direct$
  if request_row.member_application_mode='administrator_direct' then
    if request_row.status<>'approved' or request_row.assigned_to_user_id is not null or request_row.reviewer_user_id is not null
      or exists(select 1 from public.project_parameter_value_change_targets where request_id=request_row.id)
      or not exists(select 1 from parameter_catalog.project_source_member_tombstones tombstone
        join public.audit_events audit on audit.id=tombstone.audit_event_id
        where tombstone.id=request_row.applied_source_result->>'tombstoneId'
          and tombstone.organization_id=request_row.organization_id and tombstone.project_id=request_row.project_id
          and tombstone.config_set_id=request_row.member_config_set_id and tombstone.file_id=request_row.member_file_id
          and tombstone.file_version_id=request_row.member_file_version_id
          and tombstone.config_revision_id=request_row.member_frozen_proof->>'configRevisionId'
          and tombstone.successor_config_revision_id=request_row.applied_source_result->>'successorConfigRevisionId'
          and audit.id=request_row.applied_audit_ref and audit.actor_type='user'
          and audit.metadata->>'applicationMode'='administrator_direct'
          and nullif(audit.metadata->>'appliedByUserId','') is not null
          and (request_row.submitter_user_id is null or audit.metadata->>'appliedByUserId'=request_row.submitter_user_id)
          and audit.metadata->>'reviewRequestId'=request_row.id and audit.metadata->>'proofDigest'=request_row.member_proof_digest) then
      raise exception using errcode='23514',message='Direct member removal requires its exact committed administrator receipt';
    end if;
    return null;
  end if;
$direct$);
  execute rewritten;

  select pg_get_functiondef('parameter_catalog.insert_reviewed_member_tombstone(text,text,text,text,text,text,text,jsonb,text,jsonb,text)'::regprocedure) into original;
  rewritten := replace(original, 'and audit.actor_user_id is distinct from audit.metadata->>''submitterUserId''',
    'and (request.member_application_mode=''administrator_direct'' or audit.actor_user_id is distinct from audit.metadata->>''submitterUserId'')');
  rewritten := replace(rewritten, 'and request.assigned_to_user_id=audit.actor_user_id
      and request.submitter_user_id is distinct from request.assigned_to_user_id', $authority$and (
        (request.member_application_mode='separate_review' and request.assigned_to_user_id=audit.actor_user_id
          and request.submitter_user_id is distinct from request.assigned_to_user_id)
        or (request.member_application_mode='administrator_direct' and request.assigned_to_user_id is null
          and request.submitter_user_id=audit.actor_user_id and audit.metadata->>'appliedByUserId'=audit.actor_user_id
          and audit.metadata->>'applicationMode'='administrator_direct'))$authority$);
  if rewritten=original or position('request.member_application_mode=''separate_review''' in rewritten)=0 then raise exception 'member insert guard changed'; end if;
  execute rewritten;

  select pg_get_functiondef('parameter_catalog.assert_member_removal_tombstone()'::regprocedure) into original;
  marker := $zero$if not exists (
       select 1 from parameter_catalog.project_parameter_source_occurrences occurrence
       where occurrence.organization_id=new.organization_id and occurrence.project_id=new.project_id
         and occurrence.config_set_id=new.config_set_id and occurrence.file_id=new.file_id
     ) or removed_bindings is distinct from new.binding_manifest$zero$;
  if position(marker in original)=0 then raise exception 'member cohort guard changed'; end if;
  rewritten := replace(original,marker,'if removed_bindings is distinct from new.binding_manifest');
  rewritten := replace(rewritten,'occurrence.file_id=new.file_id', $physical$exists(select 1 from parameter_catalog.project_value_source_pins physical_pin
    where physical_pin.binding_id=binding.id and physical_pin.project_value_id=binding.current_value_id and physical_pin.file_id=new.file_id)$physical$);
  -- The successor count covers propagation of the frozen cohort. Newly exposed
  -- identities have a separate complete materialization proof below.
  frozen_cohort_clause := $cohort$exists(select 1 from public.project_parameter_value_change_requests removal_request
    join public.audit_events removal_audit on removal_audit.metadata->>'reviewRequestId'=removal_request.id
    where removal_audit.id=new.audit_event_id and removal_request.member_frozen_proof->'cohort' @>
      jsonb_build_array(jsonb_build_object('bindingId',binding.id)))$cohort$;
  rewritten := replace(rewritten,'occurrence.file_id<>new.file_id', frozen_cohort_clause || ' and not exists(select 1 from parameter_catalog.project_value_source_pins removed_pin where removed_pin.binding_id=binding.id and removed_pin.project_value_id=binding.current_value_id and removed_pin.file_id=new.file_id)');
  rewritten := replace(rewritten,'''fileId'',occurrence.file_id', '''fileId'',new_pin.file_id');
  rewritten := replace(rewritten,'and occurrence.file_id=new_pin.file_id','and new_pin.source_occurrence_id=occurrence.id');
  transfer_clause := $transfer$exists(select 1 from public.project_parameter_value_change_requests transfer_request
    join public.audit_events transfer_audit on transfer_audit.metadata->>'reviewRequestId'=transfer_request.id
    where transfer_audit.id=new.audit_event_id and transfer_request.member_application_mode='administrator_direct'
      and transfer_request.member_frozen_proof->'originTransfers' @> jsonb_build_array(jsonb_build_object(
        'bindingId',binding.id,'oldValueId',old_value.id,'sourcePinId',old_pin.id,
        'fromFileId',old_pin.file_id,'toFileId',new_pin.file_id))
      and parameter_catalog.source_origin_matches(binding.id,occurrence.id,new_pin.file_id))$transfer$;
  rewritten := replace(rewritten,'and new_value.value_digest=old_value.value_digest','');
  rewritten := replace(rewritten,'and new_pin.source_occurrence_id=occurrence.id;',
    'and new_pin.source_occurrence_id=occurrence.id and (new_value.value_digest=old_value.value_digest or ' || transfer_clause || ');');
  rewritten := replace(rewritten,'and new_pin.file_id=old_pin.file_id and new_pin.file_version_id=old_pin.file_version_id',
    'and ((new_pin.file_id=old_pin.file_id and new_pin.file_version_id=old_pin.file_version_id) or ' || transfer_clause || ')');
  rewritten := replace(rewritten,'member.role=file.config_set_role', '(case when member.role=''include'' then ''misc'' else member.role end)=file.config_set_role');
  marker := 'and new_pin.locator=old_pin.locator and new_pin.source_occurrence_id=old_pin.source_occurrence_id';
  if position(marker in rewritten)=0 then raise exception 'member successor guard changed'; end if;
  rewritten := replace(rewritten,marker,'and new_pin.source_occurrence_id=old_pin.source_occurrence_id and (' || transfer_clause || $geometry$ or
     (new_pin.format='json' and old_pin.format='json' and new_pin.locator=old_pin.locator)
     or (new_pin.format='dts' and old_pin.format='dts'
       and new_pin.locator->>'kind'='dts-property' and old_pin.locator->>'kind'='dts-property'
       and new_pin.locator->>'propertyName'=old_pin.locator->>'propertyName'
       and exists(select 1 from public.dts_property_occurrences old_property
         join public.dts_property_occurrences new_property on new_property.id=new_pin.property_occurrence_id
         join public.dts_node_occurrences old_node on old_node.id=old_property.node_occurrence_id
         join public.dts_node_occurrences new_node on new_node.id=new_property.node_occurrence_id
         where old_property.id=old_pin.property_occurrence_id
           and old_property.file_version_id=new_property.file_version_id
           and old_property.property_name=new_property.property_name and old_property.raw_text=new_property.raw_text
           and old_property.start_offset=new_property.start_offset and old_property.end_offset=new_property.end_offset
           and old_node.node_path=new_node.node_path
           and new_property.config_revision_id=new.successor_config_revision_id
           and old_property.config_revision_id=new.config_revision_id)))$geometry$);
  execute rewritten;
end $migration$;

-- Independently verify every newly exposed identity and its actual effective
-- property. It cannot be used to revive a deleted Binding or choose a new owner.
create function parameter_catalog.assert_member_exposed_properties() returns trigger language plpgsql security definer
set search_path=pg_catalog,parameter_catalog,public as $$
declare request_row public.project_parameter_value_change_requests%rowtype; planned jsonb; matched integer; total integer;
begin
  select * into request_row from public.project_parameter_value_change_requests where id=new.id;
  if not found then return null; end if;
  if request_row.member_application_mode<>'administrator_direct' or request_row.status<>'approved' then return null; end if;
  for planned in select value from jsonb_array_elements(coalesce(request_row.member_frozen_proof->'newProperties','[]')) loop
    select count(*) into matched from parameter_catalog.current_project_parameter_bindings binding
    join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
    join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id and value.binding_id=binding.id
    join parameter_catalog.project_value_source_pins pin on pin.project_value_id=value.id and pin.binding_id=binding.id
    join public.dts_property_occurrences property on property.id=pin.property_occurrence_id
    join public.dts_occurrence_effects effect on effect.property_occurrence_id=property.id and effect.config_revision_id=pin.config_revision_id
    join public.dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
    where binding.organization_id=request_row.organization_id and binding.project_id=request_row.project_id
      and occurrence.config_set_id=request_row.member_config_set_id and occurrence.file_id=planned->>'fileId'
      and binding.logical_node_id=planned->>'logicalNodeId' and binding.definition_id=planned->>'definitionId'
      and binding.effective_revision_id=planned->>'definitionRevisionId' and binding.registration_id=planned->>'registrationId'
      and value.value_state='present' and value.value_kind=planned->'payload'->>'kind' and value.value=planned->'payload'->'value'
      and pin.config_revision_id=request_row.applied_source_result->>'successorConfigRevisionId'
      and logical.logical_node_id=binding.logical_node_id and effect.effect_kind in ('set','override')
      and effect.property_name=planned->>'propertyName'
      and not exists(select 1 from public.dts_occurrence_effects later where later.config_revision_id=effect.config_revision_id
        and later.logical_node_revision_id=effect.logical_node_revision_id and later.property_name=effect.property_name and later.source_order>effect.source_order)
      and not exists(select 1 from parameter_catalog.binding_history_events older
        join parameter_catalog.project_parameter_values old_value on old_value.id=older.old_current_value_id
        where older.binding_id=binding.id and old_value.source_ref<>'canonical-binding-identity');
    if matched<>1 then raise exception using errcode='23514',message='Exposed member property has no exact current materialization'; end if;
  end loop;
  select count(*) into total from parameter_catalog.current_project_parameter_bindings binding
  join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
  where binding.organization_id=request_row.organization_id and binding.project_id=request_row.project_id and occurrence.config_set_id=request_row.member_config_set_id;
  if total<>jsonb_array_length(request_row.applied_source_result->'successorBindings')
    +jsonb_array_length(coalesce(request_row.member_frozen_proof->'newProperties','[]')) then
    raise exception using errcode='23514',message='Member removal does not cover the complete current Binding cohort';
  end if;
  return null;
end $$;
create constraint trigger project_parameter_member_exposed_properties_ck after insert or update on public.project_parameter_value_change_requests
  deferrable initially deferred for each row when(new.member_application_mode='administrator_direct')
  execute function parameter_catalog.assert_member_exposed_properties();
alter function parameter_catalog.assert_member_exposed_properties() owner to catalog_migration_owner;
revoke all on function parameter_catalog.assert_member_exposed_properties() from public;
