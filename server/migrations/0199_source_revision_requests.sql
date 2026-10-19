-- Whole-file edits have their own frozen review context. Existing single,
-- batch and member-removal proofs retain their installed constraints.
alter table public.project_parameter_file_candidates
  add column source_revision_context jsonb,
  add column client_mutation_id text,
  add column client_mutation_digest text,
  add constraint project_parameter_file_candidate_source_revision_ck check (
    (source_revision_context is null and client_mutation_id is null and client_mutation_digest is null)
    or (source_revision_context is not null and jsonb_typeof(source_revision_context)='object'
      and source_revision_context->>'kind'='source_revision'
      and nullif(source_revision_context->>'configSetId','') is not null
      and nullif(source_revision_context->>'baseConfigRevisionId','') is not null
      and source_revision_context->>'baseVersionId'=base_version_id
      and source_revision_context->>'clientMutationId'=client_mutation_id
      and nullif(client_mutation_id,'') is not null
      and client_mutation_digest ~ '^[0-9a-f]{64}$'
      and format='dts' and file_id is not null and base_version_id is not null) is true
  );
create unique index project_parameter_file_candidate_source_mutation_uk
  on public.project_parameter_file_candidates(organization_id,project_id,created_by_user_id,client_mutation_id)
  where client_mutation_id is not null;

alter table public.project_parameter_value_change_requests
  add column source_revision_context jsonb,
  add column source_revision_proof_digest text,
  add column source_revision_config_set_id text,
  add column source_revision_mutation_id text,
  add column source_revision_mutation_digest text,
  add constraint project_parameter_value_source_revision_set_fk
    foreign key(source_revision_config_set_id,organization_id,project_id)
    references public.dts_config_set(id,organization_id,project_id)
    on delete restrict deferrable initially deferred;

-- Read the installed legacy expressions instead of copying and potentially
-- changing the single/batch/member contracts in a later migration.
do $$
declare legacy_kind text; legacy_outcome text;
begin
  select pg_get_expr(conbin,conrelid) into strict legacy_kind from pg_constraint
    where conrelid='public.project_parameter_value_change_requests'::regclass
      and conname='project_parameter_value_change_requests_kind_ck';
  select pg_get_expr(conbin,conrelid) into strict legacy_outcome from pg_constraint
    where conrelid='public.project_parameter_value_change_requests'::regclass
      and conname='project_parameter_value_change_requests_outcome_ck';
  alter table public.project_parameter_value_change_requests
    drop constraint project_parameter_value_change_requests_kind_ck,
    drop constraint project_parameter_value_change_requests_outcome_ck;
  execute format($constraint$
    alter table public.project_parameter_value_change_requests
    add constraint project_parameter_value_change_requests_kind_ck check (
      (request_kind <> 'source_revision' and (%s)
       and source_revision_context is null and source_revision_proof_digest is null
       and source_revision_config_set_id is null and source_revision_mutation_id is null
       and source_revision_mutation_digest is null)
      or (request_kind='source_revision' and draft_id is null and binding_id is null
       and definition_id is null and definition_revision_id is null and catalog_release_id is null
       and base_current_value_id is null and config_revision_id is null and source_ref is null
       and action is null and target_value is null and source_pin_id is null
       and batch_proof_digest is null and batch_target_count is null and batch_cohort_count is null
       and batch_source_proof_token is null and batch_cohort_proof_token is null
       and batch_file_id is null and batch_base_version_id is null and batch_config_set_id is null
       and member_file_id is null and member_config_set_id is null and member_file_version_id is null
       and member_proof_digest is null and member_frozen_proof is null
       and candidate_id is not null and candidate_base_digest ~ '^[0-9a-f]{64}$'
       and candidate_proposed_digest ~ '^[0-9a-f]{64}$' and candidate_diff_digest=source_revision_proof_digest
       and candidate_member_manifest is not null and jsonb_typeof(candidate_member_manifest)='array'
       and candidate_binding_manifest is not null and jsonb_typeof(candidate_binding_manifest)='array'
       and source_revision_context is not null and jsonb_typeof(source_revision_context)='object'
       and source_revision_context->>'kind'='source_revision'
       and source_revision_context->>'configSetId'=source_revision_config_set_id
       and nullif(source_revision_config_set_id,'') is not null
       and source_revision_proof_digest ~ '^[0-9a-f]{64}$'
       and nullif(source_revision_mutation_id,'') is not null
       and source_revision_mutation_digest ~ '^[0-9a-f]{64}$') is true
    )$constraint$,legacy_kind);
  execute format($constraint$
    alter table public.project_parameter_value_change_requests
    add constraint project_parameter_value_change_requests_outcome_ck check (
      (request_kind <> 'source_revision' and (%s))
      or (request_kind='source_revision' and applied_value_id is null and applied_history_event_id is null
       and ((status='approved' and applied_at is not null and apply_outcome is not null
         and applied_audit_ref is not null and applied_file_version_ids is not null
         and jsonb_typeof(applied_file_version_ids)='array'
         and jsonb_array_length(applied_file_version_ids)=1
         and applied_source_result is not null and jsonb_typeof(applied_source_result)='object')
        or (status <> 'approved' and applied_at is null and apply_outcome is null
         and applied_audit_ref is null and applied_file_version_ids is null and applied_source_result is null)))
    )$constraint$,legacy_outcome);
end $$;

create unique index project_parameter_source_revision_pending_set_uk
  on public.project_parameter_value_change_requests(organization_id,project_id,source_revision_config_set_id)
  where request_kind='source_revision' and status='pending';
create unique index project_parameter_source_revision_mutation_uk
  on public.project_parameter_value_change_requests(organization_id,project_id,submitter_user_id,source_revision_mutation_id)
  where source_revision_mutation_id is not null;

create function parameter_catalog.protect_source_revision_context()
returns trigger language plpgsql set search_path=pg_catalog,parameter_catalog,public as $$
begin
  if new.source_revision_context is distinct from old.source_revision_context
    or new.client_mutation_id is distinct from old.client_mutation_id
    or new.client_mutation_digest is distinct from old.client_mutation_digest then
    raise exception using errcode='23514',message='Source revision candidate context is immutable';
  end if;
  return new;
end $$;
create trigger project_parameter_source_revision_candidate_immutable before update
  on public.project_parameter_file_candidates for each row
  execute function parameter_catalog.protect_source_revision_context();

create function parameter_catalog.protect_source_revision_request()
returns trigger language plpgsql set search_path=pg_catalog,parameter_catalog,public as $$
begin
  if new.source_revision_context is distinct from old.source_revision_context
    or new.source_revision_proof_digest is distinct from old.source_revision_proof_digest
    or new.source_revision_config_set_id is distinct from old.source_revision_config_set_id
    or new.source_revision_mutation_id is distinct from old.source_revision_mutation_id
    or new.source_revision_mutation_digest is distinct from old.source_revision_mutation_digest
    or (old.request_kind='source_revision' and
      ((new.submitter_user_id is distinct from old.submitter_user_id and new.submitter_user_id is not null)
       or (new.assigned_to_user_id is distinct from old.assigned_to_user_id and new.assigned_to_user_id is not null))) then
    raise exception using errcode='23514',message='Reviewed source revision context is immutable';
  end if;
  return new;
end $$;
create trigger project_parameter_source_revision_request_immutable before update
  on public.project_parameter_value_change_requests for each row
  execute function parameter_catalog.protect_source_revision_request();

create function parameter_catalog.assert_source_revision_request()
returns trigger language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
declare r public.project_parameter_value_change_requests%rowtype;
begin
  if tg_table_name='project_parameter_value_change_targets' then
    select * into r from public.project_parameter_value_change_requests where id=new.request_id;
  else
    select * into r from public.project_parameter_value_change_requests where id=new.id;
  end if;
  if r.request_kind <> 'source_revision' then return null; end if;
  if not exists(select 1 from public.project_parameter_file_candidates c
    where c.id=r.candidate_id and c.organization_id=r.organization_id and c.project_id=r.project_id
      and c.source_revision_context->>'configSetId'=r.source_revision_config_set_id
      and c.source_revision_context->>'baseVersionId'=c.base_version_id
      and r.source_revision_context->>'organizationId'=r.organization_id
      and r.source_revision_context->>'projectId'=r.project_id
      and r.source_revision_context->>'candidateId'=c.id
      and r.source_revision_context->>'fileId'=c.file_id
      and r.source_revision_context->>'baseVersionId'=c.base_version_id
      and r.source_revision_context->>'baseConfigRevisionId'=c.source_revision_context->>'baseConfigRevisionId'
      and r.source_revision_context->>'baseDigest'=r.candidate_base_digest
      and r.source_revision_context->>'proposedDigest'=r.candidate_proposed_digest
      and r.source_revision_context->>'proofDigest'=r.source_revision_proof_digest
      and r.candidate_member_manifest=r.source_revision_context->'members'
      and r.candidate_binding_manifest=r.source_revision_context->'cohort'
      and regexp_replace(c.checksum,'^sha256:','')=r.candidate_proposed_digest) then
    raise exception using errcode='23514',message='Source revision candidate ownership proof is invalid';
  end if;
  if jsonb_typeof(r.source_revision_context->'targets') is distinct from 'array'
    or (select count(*) from public.project_parameter_value_change_targets where request_id=r.id)
      <> jsonb_array_length(r.source_revision_context->'targets')
    or exists(select 1 from public.project_parameter_value_change_targets target
      where target.request_id=r.id and (target.organization_id<>r.organization_id or target.project_id<>r.project_id
        or not exists(select 1 from jsonb_array_elements(r.source_revision_context->'targets') frozen
          join jsonb_array_elements(r.source_revision_context->'cohort') cohort on cohort->>'bindingId'=frozen->>'bindingId'
          where frozen->>'bindingId'=target.binding_id and frozen->>'action'=target.action
            and cohort->>'oldValueId'=target.base_current_value_id
            and cohort->>'sourcePinId'=target.source_pin_id
            and cohort->>'definitionId'=target.definition_id
            and cohort->>'effectiveRevisionId'=target.definition_revision_id
            and cohort->>'catalogReleaseId'=target.catalog_release_id
            and target.config_revision_id=r.source_revision_context->>'baseConfigRevisionId'
            and target.base_digest=r.candidate_base_digest and target.proposed_digest=r.candidate_proposed_digest
            and (frozen->>'action'='delete' or target.target_value=frozen->'payload')))) then
    raise exception using errcode='23514',message='Whole-source request targets do not match the frozen cohort';
  end if;
  if r.status='approved' and not exists(
    select 1 from public.project_parameter_file_candidates c
      join public.project_parameter_file_versions v on v.id=r.applied_source_result->>'fileVersionId' and v.file_id=c.file_id
      join public.dts_config_revisions revision on revision.id=r.applied_source_result->>'configRevisionId'
        and revision.organization_id=r.organization_id and revision.project_id=r.project_id
        and revision.config_set_id=r.source_revision_config_set_id and revision.status='resolved'
      join public.audit_events audit on audit.id=r.applied_audit_ref
        and audit.organization_id=r.organization_id and audit.project_id=r.project_id and audit.target_id=r.id
    where c.id=r.candidate_id and c.status='active' and regexp_replace(v.checksum,'^sha256:','')=r.candidate_proposed_digest
      and r.applied_source_result->>'requestId'=r.id
      and r.applied_source_result->>'sourceRevisionProofDigest'=r.source_revision_proof_digest
      and r.applied_file_version_ids @> jsonb_build_array(v.id)
      and audit.action='value-change-applied' and audit.metadata->'result'=r.applied_source_result
  ) then
    raise exception using errcode='23514',message='Approved source revision has no complete owned receipt';
  end if;
  if r.status='approved' and exists(select 1 from public.project_parameter_value_change_targets target
    left join parameter_catalog.binding_history_events history on history.id=target.applied_history_event_id
    left join parameter_catalog.project_value_source_pins pin on pin.id=target.applied_source_pin_id
    left join parameter_catalog.project_parameter_values value on value.id=target.applied_value_id
    where target.request_id=r.id and (target.applied_value_id is null or target.applied_history_event_id is null
      or target.applied_source_pin_id is null or target.applied_file_version_id is null
      or history.binding_id is distinct from target.binding_id
      or history.applied_request_id is distinct from r.id
      or history.old_current_value_id is distinct from target.base_current_value_id
      or history.new_current_value_id is distinct from target.applied_value_id
      or history.success_audit_ref is distinct from r.applied_audit_ref
      or value.binding_id is distinct from target.binding_id or value.definition_id is distinct from target.definition_id
      or value.config_revision_id is distinct from r.applied_source_result->>'configRevisionId'
      or pin.organization_id is distinct from r.organization_id or pin.project_id is distinct from r.project_id
      or pin.project_value_id is distinct from value.id or pin.binding_id is distinct from target.binding_id
      or pin.config_revision_id is distinct from value.config_revision_id
      or pin.file_version_id is distinct from target.applied_file_version_id
      or pin.value_state is distinct from (case when target.action='delete' then 'deleted' else 'present' end)
      or (target.action='delete' and (pin.base_source_pin_id is distinct from target.source_pin_id or pin.delete_request_id is distinct from r.id)))) then
    raise exception using errcode='23514',message='Whole-source targets have incomplete applied receipts';
  end if;
  if r.status='approved' and (
    jsonb_typeof(r.applied_source_result->'results') is distinct from 'array'
    or jsonb_array_length(r.applied_source_result->'results')
      <> jsonb_array_length(r.source_revision_context->'cohort')+jsonb_array_length(r.source_revision_context->'newProperties')
    or (select count(distinct item->>'bindingId') from jsonb_array_elements(r.applied_source_result->'results') item)
      <> jsonb_array_length(r.applied_source_result->'results')
    or exists(select 1 from jsonb_array_elements(r.applied_source_result->'results') item
      left join parameter_catalog.project_parameter_bindings binding on binding.id=item->>'bindingId'
        and binding.organization_id=r.organization_id and binding.project_id=r.project_id
      left join parameter_catalog.project_parameter_values value on value.id=item->>'newValueId' and value.binding_id=binding.id
      left join parameter_catalog.project_value_source_pins pin on pin.id=item->>'sourcePinId'
        and pin.project_value_id=value.id and pin.binding_id=binding.id
        and pin.organization_id=r.organization_id and pin.project_id=r.project_id
      left join parameter_catalog.binding_history_events history on history.id=item->>'historyEventId'
        and history.binding_id=binding.id and history.new_current_value_id=value.id
      left join public.audit_events value_audit on value_audit.id=history.success_audit_ref
        and value_audit.organization_id=r.organization_id and value_audit.project_id=r.project_id
      where binding.id is null or value.id is null or pin.id is null or history.id is null
        or value_audit.id is null
        or value.config_revision_id is distinct from r.applied_source_result->>'configRevisionId'
        or pin.config_revision_id is distinct from value.config_revision_id
        or (item->>'kind'<>'created' and history.success_audit_ref is distinct from r.applied_audit_ref)
        or history.old_current_value_id is distinct from item->>'oldValueId'
        or (item->>'kind' in ('changed','deleted') and history.applied_request_id is distinct from r.id)
        or (item->>'kind' in ('derived','created') and history.applied_request_id is not null)
        or (item->>'kind'='created' and not exists(
          select 1 from jsonb_array_elements(r.source_revision_context->'newProperties') planned
          join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
          where planned->>'logicalNodeId'=binding.logical_node_id
            and planned->>'definitionId'=binding.definition_id
            and planned->>'definitionRevisionId'=binding.effective_revision_id
            and planned->>'registrationId'=binding.registration_id
            and planned->>'subjectId'=binding.subject_id
            and planned->>'fileId'=pin.file_id and occurrence.file_id=pin.file_id
            and occurrence.config_set_id=r.source_revision_config_set_id
            and planned->>'propertyName'=pin.locator->>'propertyName'))
        or coalesce(item->>'kind','') not in ('changed','deleted','derived','created'))
  ) then
    raise exception using errcode='23514',message='Whole-source cohort receipt has unowned or missing value history';
  end if;
  if r.status<>'approved' and exists(select 1 from public.project_parameter_value_change_targets target
    where target.request_id=r.id and (target.applied_value_id is not null or target.applied_history_event_id is not null
      or target.applied_source_pin_id is not null or target.applied_file_version_id is not null)) then
    raise exception using errcode='23514',message='Unapproved whole-source targets have applied results';
  end if;
  return null;
end $$;
create constraint trigger project_parameter_source_revision_receipt_ck
  after insert or update on public.project_parameter_value_change_requests
  deferrable initially deferred for each row when(new.request_kind='source_revision')
  execute function parameter_catalog.assert_source_revision_request();
create constraint trigger project_parameter_source_revision_target_ck
  after insert or update on public.project_parameter_value_change_targets
  deferrable initially deferred for each row
  execute function parameter_catalog.assert_source_revision_request();

-- The legacy target trigger also runs for the new request's real targets.
-- Route only this explicit kind to the verifier above, keeping its installed
-- single/batch checks byte-for-byte intact.
do $$
declare installed text; marker text := 'if request_row.id is null then return null; end if;';
begin
  installed := pg_get_functiondef('parameter_catalog.assert_batch_value_request()'::regprocedure);
  if position(marker in installed)=0 then
    raise exception 'Installed batch verifier has an unexpected shape';
  end if;
  execute replace(installed,marker,marker || E'\n  if request_row.request_kind=''source_revision'' then return null; end if;');
end $$;

alter function parameter_catalog.protect_source_revision_context() owner to catalog_migration_owner;
alter function parameter_catalog.protect_source_revision_request() owner to catalog_migration_owner;
alter function parameter_catalog.assert_source_revision_request() owner to catalog_migration_owner;
revoke all on function parameter_catalog.protect_source_revision_context() from public;
revoke all on function parameter_catalog.protect_source_revision_request() from public;
revoke all on function parameter_catalog.assert_source_revision_request() from public;
