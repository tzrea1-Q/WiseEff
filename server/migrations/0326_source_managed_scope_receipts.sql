-- Unmanaged source remains editable, while its last managed value/pin remains
-- historical. A historical present pin may re-enter a source cohort only after
-- an exact, approved exclusion; this is evidence, not a new mutation authority.
create function parameter_catalog.source_revision_exclusion_matches(
  p_request_id text,p_binding_id text,p_value_id text,p_pin_id text,p_base_revision_id text)
returns boolean language sql stable security definer
set search_path=pg_catalog,parameter_catalog,public as $$
select exists(
  select 1 from public.project_parameter_value_change_requests request
  cross join lateral jsonb_array_elements(request.source_revision_context->'excludedBindings') excluded
  join parameter_catalog.project_parameter_bindings binding on binding.id=p_binding_id
    and binding.organization_id=request.organization_id and binding.project_id=request.project_id
  join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
    and occurrence.organization_id=binding.organization_id and occurrence.project_id=binding.project_id
    and occurrence.config_set_id=request.source_revision_config_set_id
  join parameter_catalog.project_parameter_values value on value.id=p_value_id and value.binding_id=binding.id
    and value.definition_id=binding.definition_id and value.value_state='present'
  join parameter_catalog.project_value_source_pins pin on pin.id=p_pin_id and pin.project_value_id=value.id
    and pin.binding_id=binding.id and pin.definition_id=binding.definition_id
    and pin.organization_id=binding.organization_id and pin.project_id=binding.project_id
    and pin.source_occurrence_id=occurrence.id and pin.value_state='present'
    and pin.config_revision_id=value.config_revision_id
  join public.dts_config_revisions historical on historical.id=pin.config_revision_id
    and historical.organization_id=binding.organization_id and historical.project_id=binding.project_id
    and historical.config_set_id=occurrence.config_set_id
  join public.dts_config_revisions excluded_revision on excluded_revision.id=request.applied_source_result->>'configRevisionId'
    and excluded_revision.organization_id=binding.organization_id and excluded_revision.project_id=binding.project_id
    and excluded_revision.config_set_id=occurrence.config_set_id
    and excluded_revision.revision_number>historical.revision_number
  join public.dts_config_revisions base on base.id=p_base_revision_id
    and base.organization_id=binding.organization_id and base.project_id=binding.project_id
    and base.config_set_id=occurrence.config_set_id and base.revision_number>=excluded_revision.revision_number
  join public.audit_events audit on audit.id=request.applied_audit_ref
    and audit.organization_id=binding.organization_id and audit.project_id=binding.project_id
    and audit.target_id=request.id and audit.action='value-change-applied'
    and audit.metadata->'result'=request.applied_source_result
  where request.id=p_request_id and request.request_kind='source_revision'
    and request.status='approved' and request.apply_outcome='committed'
    and excluded @> jsonb_build_object('bindingId',binding.id,'oldValueId',value.id,'sourcePinId',pin.id,
      'sourceOccurrenceId',occurrence.id,'definitionId',binding.definition_id,
      'effectiveRevisionId',value.definition_revision_id,'catalogReleaseId',binding.catalog_release_id,
      'registrationId',binding.registration_id,'subjectId',binding.subject_id,'valueDigest',value.value_digest,
      'configRevisionId',pin.config_revision_id,'fileId',pin.file_id,'fileVersionId',pin.file_version_id,'format',pin.format)
    and excluded->>'reason' in ('registration-inactive','subject-inactive','definition-inactive','owner-inactive','source-absent')
    and not exists(select 1 from jsonb_array_elements(request.source_revision_context->'cohort') item
      where item->>'bindingId'=binding.id)
    and not exists(select 1 from jsonb_array_elements(request.applied_source_result->'results') item
      where item->>'bindingId'=binding.id)
)
$$;

create function parameter_catalog.assert_source_managed_scope_receipt()
returns trigger language plpgsql security definer
set search_path=pg_catalog,parameter_catalog,public as $$
declare r public.project_parameter_value_change_requests%rowtype; excluded jsonb; resumed jsonb;
  cohort jsonb; pin parameter_catalog.project_value_source_pins%rowtype; evidence_id text;
begin
  -- Lifecycle changes after approval cannot invalidate immutable history.
  if tg_op='UPDATE' and (old.status='approved' or new.status<>'approved') then return null; end if;
  select * into r from public.project_parameter_value_change_requests where id=new.id;
  if r.request_kind<>'source_revision' or r.status not in ('pending','approved') then return null; end if;
  if (r.source_revision_context ? 'excludedBindings' and jsonb_typeof(r.source_revision_context->'excludedBindings') is distinct from 'array')
    or (r.source_revision_context ? 'resumptions' and jsonb_typeof(r.source_revision_context->'resumptions') is distinct from 'array') then
    raise exception using errcode='23514',message='Source managed scope requires exact exclusion and resumption arrays';
  end if;
  if (jsonb_array_length(coalesce(r.source_revision_context->'excludedBindings','[]'))>0
      or jsonb_array_length(coalesce(r.source_revision_context->'resumptions','[]'))>0)
    and not exists(select 1 from parameter_catalog.catalog_state state
      join parameter_catalog.catalog_releases release on release.id=state.current_catalog_release_id
      where release.id=r.source_revision_context->'catalogRelease'->>'id'
        and release.release_digest=r.source_revision_context->'catalogRelease'->>'digest') then
    raise exception using errcode='23514',message='Source managed scope Catalog is no longer current';
  end if;
  if (select count(*) from jsonb_array_elements(coalesce(r.source_revision_context->'excludedBindings','[]')))
      <>(select count(distinct item->>'bindingId') from jsonb_array_elements(coalesce(r.source_revision_context->'excludedBindings','[]')) item)
    or (select count(*) from jsonb_array_elements(coalesce(r.source_revision_context->'resumptions','[]')))
      <>(select count(distinct item->>'bindingId') from jsonb_array_elements(coalesce(r.source_revision_context->'resumptions','[]')) item) then
    raise exception using errcode='23514',message='Source managed scope repeats a Binding';
  end if;
  for excluded in select value from jsonb_array_elements(coalesce(r.source_revision_context->'excludedBindings','[]')) loop
    if not exists(
      select 1 from parameter_catalog.project_parameter_bindings binding
      join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
        and occurrence.organization_id=binding.organization_id and occurrence.project_id=binding.project_id
        and occurrence.config_set_id=r.source_revision_config_set_id
      join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
        and value.binding_id=binding.id and value.definition_id=binding.definition_id and value.value_state='present'
      join parameter_catalog.project_value_source_pins owned_pin on owned_pin.project_value_id=value.id
        and owned_pin.binding_id=binding.id and owned_pin.source_occurrence_id=occurrence.id
        and owned_pin.organization_id=binding.organization_id and owned_pin.project_id=binding.project_id
        and owned_pin.definition_id=binding.definition_id and owned_pin.value_state='present'
      join parameter_catalog.organization_subject_registrations registration on registration.id=binding.registration_id
        and registration.organization_id=binding.organization_id and registration.subject_id=binding.subject_id
      left join parameter_catalog.catalog_release_subjects subject on subject.release_id=r.source_revision_context->'catalogRelease'->>'id'
        and subject.subject_id=binding.subject_id
      left join parameter_catalog.catalog_release_definition_heads head on head.release_id=r.source_revision_context->'catalogRelease'->>'id'
        and head.definition_id=binding.definition_id
      left join parameter_catalog.definition_revisions definition on definition.id=head.revision_id and definition.definition_id=binding.definition_id
      where binding.id=excluded->>'bindingId' and binding.organization_id=r.organization_id and binding.project_id=r.project_id
        and excluded @> jsonb_build_object('oldValueId',value.id,'sourcePinId',owned_pin.id,
          'sourceOccurrenceId',occurrence.id,'definitionId',binding.definition_id,'effectiveRevisionId',binding.effective_revision_id,
          'catalogReleaseId',binding.catalog_release_id,'registrationId',binding.registration_id,'subjectId',binding.subject_id,
          'valueDigest',value.value_digest,'configRevisionId',owned_pin.config_revision_id,
          'fileId',owned_pin.file_id,'fileVersionId',owned_pin.file_version_id,'format',owned_pin.format)
        and case excluded->>'reason'
          when 'registration-inactive' then registration.status<>'active'
          when 'subject-inactive' then subject.lifecycle is distinct from 'active'
          when 'definition-inactive' then definition.id is null or definition.content->>'lifecycle'='retired'
          when 'owner-inactive' then exists(select 1 from parameter_catalog.catalog_subjects identity
            where identity.id=binding.subject_id and identity.owner_subject_id is not null and (
              not exists(select 1 from parameter_catalog.catalog_release_subjects owner
                where owner.release_id=r.source_revision_context->'catalogRelease'->>'id'
                  and owner.subject_id=identity.owner_subject_id and owner.lifecycle='active')
              or not exists(select 1 from parameter_catalog.organization_subject_registrations owner_registration
                where owner_registration.organization_id=binding.organization_id
                  and owner_registration.subject_id=identity.owner_subject_id and owner_registration.status='active')))
          when 'source-absent' then owned_pin.format='dts' and exists(
            select 1 from public.project_parameter_value_change_requests prior
            where prior.id<>r.id and prior.organization_id=r.organization_id and prior.project_id=r.project_id
              and prior.source_revision_config_set_id=r.source_revision_config_set_id
              and parameter_catalog.source_revision_exclusion_matches(prior.id,binding.id,value.id,owned_pin.id,
                r.source_revision_context->>'baseConfigRevisionId'))
          else false end)
      or exists(select 1 from jsonb_array_elements(r.source_revision_context->'cohort') item where item->>'bindingId'=excluded->>'bindingId')
      or exists(select 1 from public.project_parameter_value_change_targets target where target.request_id=r.id and target.binding_id=excluded->>'bindingId')
      or (r.status='approved' and exists(select 1 from jsonb_array_elements(r.applied_source_result->'results') item
        where item->>'bindingId'=excluded->>'bindingId')) then
      raise exception using errcode='23514',message='Source exclusion has no exact unmanaged historical Binding';
    end if;
  end loop;
  -- Every explicitly claimed resumption must name an actually historical cohort
  -- member; every historical present member must in turn have that evidence.
  for resumed in select value from jsonb_array_elements(coalesce(r.source_revision_context->'resumptions','[]')) loop
    if not exists(select 1 from jsonb_array_elements(r.source_revision_context->'cohort') item
      join parameter_catalog.project_value_source_pins owned_pin on owned_pin.id=item->>'sourcePinId'
      join parameter_catalog.project_parameter_bindings binding on binding.id=owned_pin.binding_id
        and binding.organization_id=r.organization_id and binding.project_id=r.project_id
      join parameter_catalog.catalog_subjects identity on identity.id=binding.subject_id
      join parameter_catalog.organization_subject_registrations registration on registration.id=binding.registration_id
        and registration.organization_id=binding.organization_id and registration.subject_id=binding.subject_id and registration.status='active'
      join parameter_catalog.catalog_release_subjects subject on subject.release_id=r.source_revision_context->'catalogRelease'->>'id'
        and subject.subject_id=binding.subject_id and subject.lifecycle='active'
      join parameter_catalog.catalog_release_definition_heads head on head.release_id=subject.release_id and head.definition_id=binding.definition_id
      join parameter_catalog.definition_revisions definition on definition.id=head.revision_id and definition.definition_id=binding.definition_id
        and definition.content->>'lifecycle' in ('active','deprecated')
      where item->>'bindingId'=resumed->>'bindingId' and owned_pin.value_state='present'
        and (identity.owner_subject_id is null or (
          exists(select 1 from parameter_catalog.catalog_release_subjects owner
            where owner.release_id=subject.release_id and owner.subject_id=identity.owner_subject_id and owner.lifecycle='active')
          and exists(select 1 from parameter_catalog.organization_subject_registrations owner_registration
            where owner_registration.organization_id=binding.organization_id
              and owner_registration.subject_id=identity.owner_subject_id and owner_registration.status='active')))
        and owned_pin.config_revision_id<>r.source_revision_context->>'baseConfigRevisionId') then
      raise exception using errcode='23514',message='Source resumption is not an exact historical cohort member';
    end if;
  end loop;
  for cohort in select value from jsonb_array_elements(r.source_revision_context->'cohort') loop
    select * into pin from parameter_catalog.project_value_source_pins where id=cohort->>'sourcePinId';
    if not found or pin.value_state<>'present' or pin.config_revision_id=r.source_revision_context->>'baseConfigRevisionId' then continue; end if;
    select item->>'priorRequestId' into evidence_id from jsonb_array_elements(coalesce(r.source_revision_context->'resumptions','[]')) item
      where item->>'bindingId'=cohort->>'bindingId';
    if evidence_id is null or evidence_id=r.id
      or not parameter_catalog.source_revision_exclusion_matches(evidence_id,cohort->>'bindingId',cohort->>'oldValueId',pin.id,
        r.source_revision_context->>'baseConfigRevisionId') then
      raise exception using errcode='23514',message='Historical source resumption has no exact approved exclusion';
    end if;
    if pin.format='dts' then
      if not exists(select 1 from public.project_parameter_value_change_targets target
        where target.request_id=r.id and target.binding_id=pin.binding_id and target.source_pin_id=pin.id
          and target.base_current_value_id=pin.project_value_id and target.action='set') then
        raise exception using errcode='23514',message='Historical DTS source resumption requires a reviewed set target';
      end if;
    elsif pin.format='json' then
      if exists(select 1 from public.project_parameter_value_change_targets target where target.request_id=r.id and target.binding_id=pin.binding_id)
        or cohort->'locator' is distinct from pin.locator
        or not exists(select 1 from public.dts_config_revision_members member
          where member.config_revision_id=r.source_revision_context->>'baseConfigRevisionId'
            and member.file_id=pin.file_id and member.file_version_id=pin.file_version_id)
        or (r.status='approved' and not exists(
          select 1 from jsonb_array_elements(r.applied_source_result->'results') item
          join parameter_catalog.project_value_source_pins next_pin on next_pin.id=item->>'sourcePinId'
            and next_pin.binding_id=pin.binding_id and next_pin.project_value_id=item->>'newValueId'
            and next_pin.file_id=pin.file_id and next_pin.file_version_id=pin.file_version_id
            and next_pin.locator=pin.locator and next_pin.locator_digest=pin.locator_digest
            and next_pin.config_revision_id=r.applied_source_result->>'configRevisionId'
          join parameter_catalog.project_parameter_values old_value on old_value.id=pin.project_value_id and old_value.binding_id=pin.binding_id
          join parameter_catalog.project_parameter_values next_value on next_value.id=next_pin.project_value_id and next_value.binding_id=pin.binding_id
            and next_value.value_state='present' and next_value.value_kind=old_value.value_kind
            and next_value.value=old_value.value and next_value.value_digest=old_value.value_digest
          where item->>'bindingId'=pin.binding_id and item->>'oldValueId'=pin.project_value_id and item->>'kind'='derived')) then
        raise exception using errcode='23514',message='Historical JSON resumption requires exact unchanged source propagation';
      end if;
    else raise exception using errcode='23514',message='Unsupported historical source resumption';
    end if;
  end loop;
  return null;
end $$;

create constraint trigger project_parameter_source_managed_scope_receipt_ck
  after insert or update on public.project_parameter_value_change_requests
  deferrable initially deferred for each row when(new.request_kind='source_revision')
  execute function parameter_catalog.assert_source_managed_scope_receipt();
alter function parameter_catalog.source_revision_exclusion_matches(text,text,text,text,text) owner to catalog_migration_owner;
alter function parameter_catalog.assert_source_managed_scope_receipt() owner to catalog_migration_owner;
revoke all on function parameter_catalog.source_revision_exclusion_matches(text,text,text,text,text) from public;
revoke all on function parameter_catalog.assert_source_managed_scope_receipt() from public;

-- Adjacent source operations may leave an already suspended current tip alone.
-- They cannot create a suspension or silently admit an unexplained stale pin.
create function parameter_catalog.source_binding_is_suspended(p_binding_id text,p_base_revision_id text)
returns boolean language sql stable security definer
set search_path=pg_catalog,parameter_catalog,public as $$
select exists(select 1 from parameter_catalog.project_parameter_bindings binding
  join parameter_catalog.project_value_source_pins pin on pin.binding_id=binding.id
    and pin.project_value_id=binding.current_value_id and pin.source_occurrence_id=binding.source_occurrence_id
  join public.project_parameter_value_change_requests prior on prior.organization_id=binding.organization_id
    and prior.project_id=binding.project_id and prior.request_kind='source_revision' and prior.status='approved'
  where binding.id=p_binding_id and pin.config_revision_id<>p_base_revision_id
    and parameter_catalog.source_revision_exclusion_matches(prior.id,binding.id,pin.project_value_id,pin.id,p_base_revision_id))
$$;

-- Restore freezes its skipped identities so a later resumption cannot change
-- the meaning of its immutable baseline-count and historical receipt checks.
create function parameter_catalog.configuration_restore_suspension_matches(p_request_id text,p_item jsonb,p_require_current boolean)
returns boolean language sql stable security definer
set search_path=pg_catalog,parameter_catalog,public as $$
select exists(select 1 from public.project_parameter_value_change_requests request
  join parameter_catalog.project_parameter_bindings binding on binding.id=p_item->>'bindingId'
    and binding.organization_id=request.organization_id and binding.project_id=request.project_id
  join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
    and occurrence.organization_id=binding.organization_id and occurrence.project_id=binding.project_id
    and occurrence.config_set_id=request.source_revision_config_set_id
  join parameter_catalog.project_value_source_pins pin on pin.id=p_item->>'sourcePinId'
    and pin.binding_id=binding.id and pin.source_occurrence_id=occurrence.id
    and pin.project_value_id=p_item->>'oldValueId'
  where request.id=p_request_id and request.request_kind='configuration_restore'
    and (not p_require_current or binding.current_value_id=pin.project_value_id)
    and parameter_catalog.source_revision_exclusion_matches(p_item->>'priorRequestId',binding.id,pin.project_value_id,pin.id,
      request.source_revision_context->>'baseConfigRevisionId')
    and p_item ? 'snapshotValueId' and (
      (p_item->'snapshotValueId'='null'::jsonb and not exists(select 1 from parameter_catalog.project_value_source_pins historical
        where historical.binding_id=binding.id and historical.value_state='present'
          and historical.config_revision_id=request.source_revision_context->>'snapshotConfigRevisionId'))
      or exists(select 1 from parameter_catalog.project_value_source_pins historical
        where historical.binding_id=binding.id and historical.source_occurrence_id=occurrence.id
          and historical.organization_id=request.organization_id and historical.project_id=request.project_id
          and historical.project_value_id=p_item->>'snapshotValueId' and historical.value_state='present'
          and historical.config_revision_id=request.source_revision_context->>'snapshotConfigRevisionId')))
$$;

do $$
declare installed text; changed text; marker text; replacement text;
begin
  select pg_get_functiondef('parameter_catalog.assert_configuration_restore_receipt()'::regprocedure) into strict installed;
  marker := '  result:=r.applied_source_result;';
  replacement := marker || $guard$
  if jsonb_typeof(coalesce(r.source_revision_context->'suspendedBindings','[]')) is distinct from 'array'
    or (select count(*) from jsonb_array_elements(coalesce(r.source_revision_context->'suspendedBindings','[]')))
      <>(select count(distinct item->>'bindingId') from jsonb_array_elements(coalesce(r.source_revision_context->'suspendedBindings','[]')) item)
    or exists(select 1 from jsonb_array_elements(coalesce(r.source_revision_context->'suspendedBindings','[]')) suspended
      where not parameter_catalog.configuration_restore_suspension_matches(r.id,suspended,not historical_receipt)
        or exists(select 1 from jsonb_array_elements(r.source_revision_context->'cohort') frozen where frozen->>'bindingId'=suspended->>'bindingId')
        or exists(select 1 from public.project_parameter_value_change_targets target where target.request_id=r.id and target.binding_id=suspended->>'bindingId')
        or exists(select 1 from jsonb_array_elements(result->'results') receipt where receipt->>'bindingId'=suspended->>'bindingId')) then
    raise exception using errcode='23514',message='Configuration restore suspension has no exact historical exclusion';
  end if;$guard$;
  if (length(installed)-length(replace(installed,marker,'')))/length(marker)<>1 then
    raise exception 'Configuration restore scope admission marker changed'; end if;
  changed:=replace(installed,marker,replacement);
  marker := $old$(select count(*) from jsonb_array_elements(r.source_revision_context->'cohort') frozen
        where frozen->>'snapshotValueId' is not null)$old$;
  replacement := $new$((select count(*) from jsonb_array_elements(r.source_revision_context->'cohort') frozen
        where frozen->>'snapshotValueId' is not null)
        +(select count(*) from jsonb_array_elements(coalesce(r.source_revision_context->'suspendedBindings','[]')) suspended
          where suspended->>'snapshotValueId' is not null))$new$;
  if (length(changed)-length(replace(changed,marker,'')))/length(marker)<>1 then
    raise exception 'Configuration restore frozen snapshot cardinality marker changed'; end if;
  changed:=replace(changed,marker,replacement);
  marker := $old$where binding.organization_id=r.organization_id and binding.project_id=r.project_id and occurrence.config_set_id=r.source_revision_config_set_id)$old$;
  replacement := $new$where binding.organization_id=r.organization_id and binding.project_id=r.project_id and occurrence.config_set_id=r.source_revision_config_set_id
        and not exists(select 1 from jsonb_array_elements(coalesce(r.source_revision_context->'suspendedBindings','[]')) suspended
          where suspended->>'bindingId'=binding.id and suspended->>'oldValueId'=binding.current_value_id))$new$;
  if (length(changed)-length(replace(changed,marker,'')))/length(marker)<>1 then
    raise exception 'Configuration restore complete current cohort marker changed'; end if;
  changed:=replace(changed,marker,replacement);
  execute changed;

  select pg_get_functiondef('parameter_catalog.assert_member_exposed_properties()'::regprocedure) into strict installed;
  marker := $old$and occurrence.config_set_id=request_row.member_config_set_id
    and (not historical_receipt or exists$old$;
  replacement := $new$and occurrence.config_set_id=request_row.member_config_set_id
    and (historical_receipt or not parameter_catalog.source_binding_is_suspended(binding.id,request_row.member_frozen_proof->>'configRevisionId'))
    and (not historical_receipt or exists$new$;
  if (length(installed)-length(replace(installed,marker,'')))/length(marker)<>1 then
    raise exception 'Member removal complete exposed cohort marker changed'; end if;
  execute replace(installed,marker,replacement);

  select pg_get_functiondef('parameter_catalog.assert_member_removal_tombstone()'::regprocedure) into strict installed;
  marker := $old$         and not exists (
           select 1 from parameter_catalog.project_value_source_pins pin
           where pin.project_value_id=binding.current_value_id and pin.binding_id=binding.id$old$;
  replacement := $new$         and not parameter_catalog.source_binding_is_suspended(binding.id,new.config_revision_id)
         and not exists (
           select 1 from parameter_catalog.project_value_source_pins pin
           where pin.project_value_id=binding.current_value_id and pin.binding_id=binding.id$new$;
  if (length(installed)-length(replace(installed,marker,'')))/length(marker)<>1 then
    raise exception 'Member removal exact removed cohort marker changed'; end if;
  changed:=replace(installed,marker,replacement);
  marker := $old$  select count(*) into surviving_count
  from parameter_catalog.current_project_parameter_bindings binding
  join parameter_catalog.project_parameter_source_occurrences occurrence
    on occurrence.id=binding.source_occurrence_id$old$;
  replacement := marker || E'\n    and not parameter_catalog.source_binding_is_suspended(binding.id,new.config_revision_id)';
  if (length(changed)-length(replace(changed,marker,'')))/length(marker)<>1 then
    raise exception 'Member removal complete surviving cohort marker changed'; end if;
  changed:=replace(changed,marker,replacement);
  execute changed;
end $$;

alter function parameter_catalog.source_binding_is_suspended(text,text) owner to catalog_migration_owner;
alter function parameter_catalog.configuration_restore_suspension_matches(text,jsonb,boolean) owner to catalog_migration_owner;
revoke all on function parameter_catalog.source_binding_is_suspended(text,text) from public;
revoke all on function parameter_catalog.configuration_restore_suspension_matches(text,jsonb,boolean) from public;

-- Multi-parameter approvals are erased as a whole when any referenced
-- Definition is permanently deleted. Preserve each unaffected suspension as
-- its own trusted receipt and audit, without a FK or JSON link to the shared
-- request/audit. Definition, project and organization erasure still own it.
create table parameter_catalog.source_binding_suspension_receipts (
  id text primary key,
  request_id text not null,
  organization_id text not null references public.organizations(id) on delete restrict,
  project_id text not null references public.projects(id) on delete restrict,
  config_set_id text not null references public.dts_config_set(id) on delete restrict,
  binding_id text not null references parameter_catalog.project_parameter_bindings(id) on delete restrict,
  definition_id text not null references parameter_catalog.parameter_definitions(id) on delete restrict,
  old_value_id text not null references parameter_catalog.project_parameter_values(id) on delete restrict,
  source_pin_id text not null references parameter_catalog.project_value_source_pins(id) on delete restrict,
  applied_config_revision_id text not null references public.dts_config_revisions(id) on delete restrict,
  source_proof_digest text not null check(source_proof_digest ~ '^[0-9a-f]{64}$'),
  excluded_identity jsonb not null check(jsonb_typeof(excluded_identity)='object'),
  audit_event_id text not null references public.audit_events(id) on delete restrict,
  unique(request_id,binding_id)
);
alter table parameter_catalog.source_binding_suspension_receipts owner to catalog_migration_owner;
revoke all on parameter_catalog.source_binding_suspension_receipts from public;

create function parameter_catalog.protect_source_binding_suspension_receipt()
returns trigger language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
begin
  if tg_op='DELETE' and parameter_catalog.definition_purge_allows_change(TG_TABLE_SCHEMA,TG_TABLE_NAME,to_jsonb(old),'DELETE') then return old; end if;
  if tg_op<>'INSERT' then raise exception using errcode='55000',message='Source suspension receipts are immutable'; end if;
  if not exists(select 1 from public.project_parameter_value_change_requests request
    join public.audit_events original on original.id=request.applied_audit_ref
      and original.organization_id=request.organization_id and original.project_id=request.project_id
      and original.target_id=request.id and original.action='value-change-applied'
      and original.metadata->'result'=request.applied_source_result
    join public.audit_events retained on retained.id=new.audit_event_id
    where request.id=new.request_id and request.organization_id=new.organization_id and request.project_id=new.project_id
      and request.source_revision_config_set_id=new.config_set_id and request.request_kind='source_revision'
      and request.status='approved' and request.apply_outcome='committed'
      and request.source_revision_proof_digest=new.source_proof_digest
      and request.applied_source_result->>'configRevisionId'=new.applied_config_revision_id
      and request.source_revision_context->'excludedBindings' @> jsonb_build_array(new.excluded_identity)
      and new.excluded_identity->>'bindingId'=new.binding_id and new.excluded_identity->>'definitionId'=new.definition_id
      and new.excluded_identity->>'oldValueId'=new.old_value_id and new.excluded_identity->>'sourcePinId'=new.source_pin_id
      and parameter_catalog.source_revision_exclusion_matches(request.id,new.binding_id,new.old_value_id,new.source_pin_id,new.applied_config_revision_id)
      and to_jsonb(retained)=to_jsonb(original)||jsonb_build_object('id',new.audit_event_id,
        'action','source-binding-suspended','target_type','project-parameter-binding','target_id',new.binding_id,
        'metadata',jsonb_build_object('identity',new.excluded_identity,'configRevisionId',new.applied_config_revision_id,
          'proofDigest',new.source_proof_digest))) then
    raise exception using errcode='23514',message='Source suspension receipt requires an exact approved exclusion and independent audit';
  end if;
  return new;
end $$;
create trigger source_binding_suspension_receipt_immutable before insert or update or delete
  on parameter_catalog.source_binding_suspension_receipts for each row
  execute function parameter_catalog.protect_source_binding_suspension_receipt();

create function parameter_catalog.mint_source_binding_suspensions()
returns trigger language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
declare request public.project_parameter_value_change_requests%rowtype; excluded jsonb;
  original public.audit_events%rowtype; retained public.audit_events%rowtype; audit_id text; receipt_id text;
begin
  if tg_op='UPDATE' and old.status='approved' then return null; end if;
  select * into request from public.project_parameter_value_change_requests where id=new.id;
  if request.request_kind<>'source_revision' or request.status<>'approved' then return null; end if;
  select * into original from public.audit_events where id=request.applied_audit_ref;
  if not found then raise exception using errcode='23514',message='Source suspension has no original applied audit'; end if;
  for excluded in select value from jsonb_array_elements(coalesce(request.source_revision_context->'excludedBindings','[]')) loop
    receipt_id:='ssusp_'||md5(request.id||chr(31)||(excluded->>'bindingId'));
    audit_id:='audit_'||receipt_id;
    retained:=jsonb_populate_record(null::public.audit_events,to_jsonb(original)||jsonb_build_object('id',audit_id,
      'action','source-binding-suspended','target_type','project-parameter-binding','target_id',excluded->>'bindingId',
      'metadata',jsonb_build_object('identity',excluded,'configRevisionId',request.applied_source_result->>'configRevisionId',
        'proofDigest',request.source_revision_proof_digest)));
    insert into public.audit_events select retained.* on conflict(id) do nothing;
    if not exists(select 1 from public.audit_events actual where actual.id=audit_id and to_jsonb(actual)=to_jsonb(retained)) then
      raise exception using errcode='23514',message='Independent suspension audit identity was reused'; end if;
    insert into parameter_catalog.source_binding_suspension_receipts
      (id,request_id,organization_id,project_id,config_set_id,binding_id,definition_id,old_value_id,source_pin_id,
       applied_config_revision_id,source_proof_digest,excluded_identity,audit_event_id)
    values(receipt_id,request.id,request.organization_id,request.project_id,request.source_revision_config_set_id,
      excluded->>'bindingId',excluded->>'definitionId',excluded->>'oldValueId',excluded->>'sourcePinId',
      request.applied_source_result->>'configRevisionId',request.source_revision_proof_digest,excluded,audit_id)
    on conflict(request_id,binding_id) do nothing;
    if not exists(select 1 from parameter_catalog.source_binding_suspension_receipts receipt
      where receipt.id=receipt_id and receipt.request_id=request.id and receipt.binding_id=excluded->>'bindingId'
        and receipt.organization_id=request.organization_id and receipt.project_id=request.project_id
        and receipt.config_set_id=request.source_revision_config_set_id and receipt.definition_id=excluded->>'definitionId'
        and receipt.old_value_id=excluded->>'oldValueId' and receipt.source_pin_id=excluded->>'sourcePinId'
        and receipt.excluded_identity=excluded and receipt.audit_event_id=audit_id
        and receipt.applied_config_revision_id=request.applied_source_result->>'configRevisionId'
        and receipt.source_proof_digest=request.source_revision_proof_digest) then
      raise exception using errcode='23514',message='Source suspension receipt identity was reused'; end if;
  end loop;
  return null;
end $$;
create constraint trigger source_binding_suspensions_mint after insert or update
  on public.project_parameter_value_change_requests deferrable initially deferred
  for each row when(new.request_kind='source_revision') execute function parameter_catalog.mint_source_binding_suspensions();

-- The retained path requires its own immutable row and audit, together with the
-- exact surviving value/pin and the same organization/project/configuration.
do $$ declare installed text;
begin
  select prosrc into strict installed from pg_proc
    where oid='parameter_catalog.source_revision_exclusion_matches(text,text,text,text,text)'::regprocedure;
  execute format($definition$create or replace function parameter_catalog.source_revision_exclusion_matches(
    p_request_id text,p_binding_id text,p_value_id text,p_pin_id text,p_base_revision_id text)
    returns boolean language sql stable security definer set search_path=pg_catalog,parameter_catalog,public as %L$definition$,
    installed||$retained$
or exists(select 1 from parameter_catalog.source_binding_suspension_receipts receipt
  join parameter_catalog.project_parameter_bindings binding on binding.id=receipt.binding_id
    and binding.organization_id=receipt.organization_id and binding.project_id=receipt.project_id
    and binding.definition_id=receipt.definition_id
  join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
    and occurrence.config_set_id=receipt.config_set_id and occurrence.organization_id=binding.organization_id and occurrence.project_id=binding.project_id
  join parameter_catalog.project_parameter_values value on value.id=receipt.old_value_id and value.binding_id=binding.id
    and value.definition_id=binding.definition_id and value.value_state='present'
  join parameter_catalog.project_value_source_pins pin on pin.id=receipt.source_pin_id and pin.project_value_id=value.id
    and pin.binding_id=binding.id and pin.definition_id=binding.definition_id and pin.source_occurrence_id=occurrence.id
    and pin.organization_id=binding.organization_id and pin.project_id=binding.project_id and pin.value_state='present'
    and pin.config_revision_id=value.config_revision_id
  join public.dts_config_revisions historical on historical.id=pin.config_revision_id
    and historical.organization_id=binding.organization_id and historical.project_id=binding.project_id and historical.config_set_id=receipt.config_set_id
  join public.dts_config_revisions suspended on suspended.id=receipt.applied_config_revision_id
    and suspended.organization_id=binding.organization_id and suspended.project_id=binding.project_id and suspended.config_set_id=receipt.config_set_id
    and suspended.revision_number>historical.revision_number
  join public.dts_config_revisions base on base.id=p_base_revision_id
    and base.organization_id=binding.organization_id and base.project_id=binding.project_id and base.config_set_id=receipt.config_set_id
    and base.revision_number>=suspended.revision_number
  join public.audit_events audit on audit.id=receipt.audit_event_id
    and audit.organization_id=binding.organization_id and audit.project_id=binding.project_id
    and audit.target_id=binding.id and audit.target_type='project-parameter-binding' and audit.action='source-binding-suspended'
    and audit.metadata=jsonb_build_object('identity',receipt.excluded_identity,
      'configRevisionId',receipt.applied_config_revision_id,'proofDigest',receipt.source_proof_digest)
  where receipt.request_id=p_request_id and binding.id=p_binding_id and value.id=p_value_id and pin.id=p_pin_id
    and receipt.excluded_identity @> jsonb_build_object('bindingId',binding.id,'oldValueId',value.id,'sourcePinId',pin.id,
      'sourceOccurrenceId',occurrence.id,'definitionId',binding.definition_id,'effectiveRevisionId',value.definition_revision_id,
      'catalogReleaseId',binding.catalog_release_id,'registrationId',binding.registration_id,'subjectId',binding.subject_id,
      'valueDigest',value.value_digest,'configRevisionId',pin.config_revision_id,'fileId',pin.file_id,'fileVersionId',pin.file_version_id,'format',pin.format))
$retained$);
end $$;

create function parameter_catalog.find_source_binding_suspension(
  p_org text,p_project text,p_config_set text,p_base_revision text,p_identity jsonb)
returns text language sql stable security definer set search_path=pg_catalog,parameter_catalog,public as $$
select evidence.request_id from (
  select request.id as request_id,request.organization_id,request.project_id,request.source_revision_config_set_id as config_set_id,
    request.applied_source_result->>'configRevisionId' as applied_revision_id,excluded as identity
  from public.project_parameter_value_change_requests request
  cross join lateral jsonb_array_elements(request.source_revision_context->'excludedBindings') excluded
  where request.request_kind='source_revision' and request.status='approved' and request.apply_outcome='committed'
  union all select receipt.request_id,receipt.organization_id,receipt.project_id,receipt.config_set_id,
    receipt.applied_config_revision_id,receipt.excluded_identity from parameter_catalog.source_binding_suspension_receipts receipt
) evidence
join public.dts_config_revisions applied on applied.id=evidence.applied_revision_id
where evidence.organization_id=p_org and evidence.project_id=p_project and evidence.config_set_id=p_config_set
  and evidence.identity-'reason'=p_identity
  and parameter_catalog.source_revision_exclusion_matches(evidence.request_id,p_identity->>'bindingId',p_identity->>'oldValueId',
    p_identity->>'sourcePinId',p_base_revision)
order by applied.revision_number desc,evidence.request_id limit 1
$$;

-- All callers that enumerate possible evidence must include independent rows;
-- an erased parent request must not disappear before the predicate can run.
do $$ declare installed text; changed text; marker text; replacement text;
begin
  select pg_get_functiondef('parameter_catalog.source_binding_is_suspended(text,text)'::regprocedure) into strict installed;
  marker:=$old$join public.project_parameter_value_change_requests prior on prior.organization_id=binding.organization_id
    and prior.project_id=binding.project_id and prior.request_kind='source_revision' and prior.status='approved'$old$;
  replacement:=$new$join (select id,organization_id,project_id from public.project_parameter_value_change_requests
      where request_kind='source_revision' and status='approved'
    union select request_id,organization_id,project_id from parameter_catalog.source_binding_suspension_receipts) prior
    on prior.organization_id=binding.organization_id and prior.project_id=binding.project_id$new$;
  if (length(installed)-length(replace(installed,marker,'')))/length(marker)<>1 then raise exception 'Suspended binding evidence marker changed'; end if;
  execute replace(installed,marker,replacement);
  select pg_get_functiondef('parameter_catalog.assert_source_managed_scope_receipt()'::regprocedure) into strict installed;
  marker:=$old$from public.project_parameter_value_change_requests prior
            where prior.id<>r.id$old$;
  replacement:=$new$from (select id,organization_id,project_id,source_revision_config_set_id from public.project_parameter_value_change_requests
                where request_kind='source_revision' and status='approved'
              union select request_id,organization_id,project_id,config_set_id from parameter_catalog.source_binding_suspension_receipts) prior
            where prior.id<>r.id$new$;
  if (length(installed)-length(replace(installed,marker,'')))/length(marker)<>1 then raise exception 'Absent source suspension evidence marker changed'; end if;
  execute replace(installed,marker,replacement);
end $$;

-- Keep the existing exact erasure capabilities and fixed ownership inventories.
do $$ declare installed text; changed text; marker text;
begin
  select pg_get_functiondef('parameter_catalog.preview_project_deletion_catalog(text,text,text)'::regprocedure) into strict installed;
  marker:=$old$  return query select 'source-pins'::text$old$;
  if (length(installed)-length(replace(installed,marker,'')))/length(marker)<>1 then raise exception 'Project suspension inventory marker changed'; end if;
  execute replace(installed,marker,$new$  return query select 'source-suspensions'::text, count(*),
    encode(sha256(convert_to(coalesce(string_agg(fingerprint, '' order by fingerprint), ''), 'UTF8')), 'hex')
    from (select encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') as fingerprint
      from (select * from parameter_catalog.source_binding_suspension_receipts
        where organization_id=p_organization_id and project_id=p_project_id) r) scoped;

  return query select 'source-pins'::text$new$);
  select pg_get_functiondef('parameter_catalog.purge_project(text,text,text,text)'::regprocedure) into strict installed;
  marker:='for entry in select * from (values';
  if (length(installed)-length(replace(installed,marker,'')))/length(marker)<>1 then raise exception 'Project suspension purge marker changed'; end if;
  execute replace(installed,marker,marker||E'\n    (-7,''parameter_catalog.source_binding_suspension_receipts'',''organization_id=$1 and project_id=$2''),');
  select pg_get_functiondef('parameter_catalog.lock_project_erasure(text,text,text)'::regprocedure) into strict installed;
  marker:='lock table public.member_addition_intents,';
  if (length(installed)-length(replace(installed,marker,'')))/length(marker)<>1 then raise exception 'Project suspension lock marker changed'; end if;
  execute replace(installed,marker,'lock table parameter_catalog.source_binding_suspension_receipts,public.member_addition_intents,');
  select pg_get_functiondef('parameter_catalog.preview_organization_deletion_0276(text,text)'::regprocedure) into strict installed;
  marker:='for target in select * from (values';
  if (length(installed)-length(replace(installed,marker,'')))/length(marker)<>1 then raise exception 'Organization suspension inventory marker changed'; end if;
  execute replace(installed,marker,marker||E'\n    (''parameter_catalog.source_binding_suspension_receipts'',''catalog'',''r.organization_id=$1''),');
  select pg_get_functiondef('parameter_catalog.purge_organization_parameter_assets(text,text,text)'::regprocedure) into strict installed;
  marker:='  -- Fixed ownership closure, never recursive FK discovery or arbitrary tables.';
  if (length(installed)-length(replace(installed,marker,'')))/length(marker)<>1 then raise exception 'Organization suspension lock marker changed'; end if;
  changed:=replace(installed,marker,E'  lock table parameter_catalog.source_binding_suspension_receipts in share row exclusive mode;\n'||marker);
  marker:='for entry in select * from (values';
  if (length(changed)-length(replace(changed,marker,'')))/length(marker)<>1 then raise exception 'Organization suspension purge marker changed'; end if;
  execute replace(changed,marker,marker||E'\n    (''parameter_catalog.source_binding_suspension_receipts'',''organization_id=$1''),');
end $$;

alter function parameter_catalog.protect_source_binding_suspension_receipt() owner to catalog_migration_owner;
alter function parameter_catalog.mint_source_binding_suspensions() owner to catalog_migration_owner;
alter function parameter_catalog.find_source_binding_suspension(text,text,text,text,jsonb) owner to catalog_migration_owner;
revoke all on function parameter_catalog.protect_source_binding_suspension_receipt() from public;
revoke all on function parameter_catalog.mint_source_binding_suspensions() from public;
revoke all on function parameter_catalog.find_source_binding_suspension(text,text,text,text,jsonb) from public;
-- Existing provisioned NOINHERIT logins must be repaired during upgrade,
-- without reprovisioning or copying broad default SELECT onto this private
-- table. Ownership plus an existing direct source-write grant in THIS database
-- identifies the API; a role name or cluster-wide membership alone does not.
do $$
declare runtime record;
begin
  for runtime in
    with owned_runtime as (
      select role.oid,role.rolname,role.rolsuper,role.rolinherit,role.rolcreaterole,role.rolcreatedb,role.rolreplication,
        exists(select 1 from information_schema.role_table_grants authority
        where authority.grantee=role.rolname and authority.table_schema='parameter_catalog'
          and authority.table_name='project_value_source_pins' and authority.privilege_type='INSERT') as source_writer
      from pg_roles role where role.rolcanlogin
        and (shobj_description(role.oid,'pg_authid')='wiseeff-publication-runtime:official'
          or shobj_description(role.oid,'pg_authid') ~ '^wiseeff-publication-runtime:lab:[a-z0-9]{6,24}$'))
    select role.rolname,role.source_writer and not role.rolsuper and not role.rolinherit and not role.rolcreaterole
      and not role.rolcreatedb and not role.rolreplication
      and pg_has_role(role.oid,'parameter_governance_writer_role','SET') as source_api
    from owned_runtime role
    where role.source_writer
      or exists(select 1 from pg_class relation cross join lateral aclexplode(relation.relacl) acl
        where relation.oid='parameter_catalog.source_binding_suspension_receipts'::regclass and acl.grantee=role.oid)
      or exists(select 1 from pg_proc routine cross join lateral aclexplode(routine.proacl) acl
        where routine.oid='parameter_catalog.find_source_binding_suspension(text,text,text,text,jsonb)'::regprocedure
          and acl.grantee=role.oid)
  loop
    execute format('revoke all on parameter_catalog.source_binding_suspension_receipts from %I',runtime.rolname);
    execute format('revoke execute on function parameter_catalog.find_source_binding_suspension(text,text,text,text,jsonb) from %I',runtime.rolname);
    if runtime.source_api then
      execute format('grant execute on function parameter_catalog.find_source_binding_suspension(text,text,text,text,jsonb) to %I',runtime.rolname);
    end if;
  end loop;
end $$;

-- A member tombstone retires its managed manifest. An owner already suspended
-- before that removal was not deleted by it and must remain discoverable for a
-- later whole-source reconciliation, including a reviewed physical transfer.
-- Every approved exclusion created by this migration has an immutable,
-- per-Binding receipt. Use that exact receipt directly: inlining the generic
-- request-or-receipt resolver here duplicates a large correlated join tree in
-- every ordinary Binding read, even when no suspension or tombstone exists.
-- Keep owner-mediated reads, as 0236 does, without granting a new DEFINER RPC.
do $$
declare view_sql text; predicate_sql text; options text[];
  marker text := 'occurrence.id = binding.source_occurrence_id';
begin
  select pg_get_viewdef('parameter_catalog.current_project_parameter_bindings'::regclass,true),reloptions
    into strict view_sql,options from pg_class
    where oid='parameter_catalog.current_project_parameter_bindings'::regclass;
  predicate_sql:=$predicate$exists(select 1 from parameter_catalog.source_binding_suspension_receipts suspended_owner
    join parameter_catalog.project_value_source_pins retained_pin on retained_pin.id=suspended_owner.source_pin_id
      and retained_pin.binding_id=binding.id and retained_pin.project_value_id=binding.current_value_id
      and retained_pin.definition_id=binding.definition_id and retained_pin.source_occurrence_id=occurrence.id
      and retained_pin.organization_id=binding.organization_id and retained_pin.project_id=binding.project_id
      and retained_pin.file_id=tombstone.file_id and retained_pin.value_state='present'
    join parameter_catalog.project_parameter_values retained_value on retained_value.id=retained_pin.project_value_id
      and retained_value.binding_id=binding.id and retained_value.definition_id=binding.definition_id
      and retained_value.config_revision_id=retained_pin.config_revision_id and retained_value.value_state='present'
    join public.dts_config_revisions historical on historical.id=retained_pin.config_revision_id
      and historical.organization_id=binding.organization_id and historical.project_id=binding.project_id
      and historical.config_set_id=tombstone.config_set_id
    join public.dts_config_revisions suspended on suspended.id=suspended_owner.applied_config_revision_id
      and suspended.organization_id=binding.organization_id and suspended.project_id=binding.project_id
      and suspended.config_set_id=tombstone.config_set_id and suspended.revision_number>historical.revision_number
    join public.dts_config_revisions removed on removed.id=tombstone.config_revision_id
      and removed.organization_id=binding.organization_id and removed.project_id=binding.project_id
      and removed.config_set_id=tombstone.config_set_id and removed.revision_number>=suspended.revision_number
    join public.audit_events suspension_audit on suspension_audit.id=suspended_owner.audit_event_id
      and suspension_audit.organization_id=binding.organization_id and suspension_audit.project_id=binding.project_id
      and suspension_audit.target_id=binding.id and suspension_audit.target_type='project-parameter-binding'
      and suspension_audit.action='source-binding-suspended'
      and suspension_audit.metadata=jsonb_build_object('identity',suspended_owner.excluded_identity,
        'configRevisionId',suspended_owner.applied_config_revision_id,'proofDigest',suspended_owner.source_proof_digest)
    where suspended_owner.binding_id=binding.id and suspended_owner.old_value_id=binding.current_value_id
      and suspended_owner.definition_id=binding.definition_id and suspended_owner.config_set_id=tombstone.config_set_id
      and suspended_owner.organization_id=binding.organization_id and suspended_owner.project_id=binding.project_id
      and occurrence.organization_id=binding.organization_id and occurrence.project_id=binding.project_id
      and occurrence.config_set_id=suspended_owner.config_set_id
      and suspended_owner.excluded_identity @> jsonb_build_object('bindingId',binding.id,'oldValueId',retained_value.id,
        'sourcePinId',retained_pin.id,'sourceOccurrenceId',occurrence.id,'definitionId',binding.definition_id,
        'effectiveRevisionId',retained_value.definition_revision_id,'catalogReleaseId',binding.catalog_release_id,
        'registrationId',binding.registration_id,'subjectId',binding.subject_id,'valueDigest',retained_value.value_digest,
        'configRevisionId',retained_pin.config_revision_id,'fileId',retained_pin.file_id,
        'fileVersionId',retained_pin.file_version_id,'format',retained_pin.format)
      and not exists(select 1 from jsonb_array_elements(tombstone.binding_manifest) removed
        where removed->>'bindingId'=binding.id))$predicate$;
  if (length(view_sql)-length(replace(view_sql,marker,'')))/length(marker)<>1 then
    raise exception 'Retained source membership view marker changed'; end if;
  view_sql:=replace(view_sql,marker,'('||marker||' and not ('||predicate_sql||'))');
  execute 'create or replace view parameter_catalog.current_project_parameter_bindings'
    ||case when coalesce(array_length(options,1),0)>0 then ' with ('||array_to_string(options,',')||')' else '' end
    ||' as '||view_sql;
end $$;
