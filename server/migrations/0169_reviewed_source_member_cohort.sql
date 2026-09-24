-- A reviewed member removal advances every surviving current Binding to one
-- successor source revision. Historical Values, pins, and removed Bindings stay.
-- 0167/0168 remain immutable; the deferred proof replaces only their function.

-- Reuse C's one canonical request/reviewer ledger. C owns its HTTP submit and
-- decision routes; D freezes and consumes the member-removal kind here.
alter table public.project_parameter_value_change_requests
  add column member_file_id text,
  add column member_config_set_id text,
  add column member_file_version_id text,
  add column member_proof_digest text,
  add column member_frozen_proof jsonb,
  add constraint project_parameter_value_change_request_member_file_fk
    foreign key (member_file_id,organization_id,project_id)
    references public.project_parameter_files(id,organization_id,project_id)
    on delete restrict deferrable initially deferred,
  add constraint project_parameter_value_change_request_member_set_fk
    foreign key (member_config_set_id,organization_id,project_id)
    references public.dts_config_set(id,organization_id,project_id)
    on delete restrict deferrable initially deferred,
  add constraint project_parameter_value_change_request_member_version_fk
    foreign key (member_file_id,member_file_version_id)
    references public.project_parameter_file_versions(file_id,id)
    on delete restrict deferrable initially deferred;

alter table public.project_parameter_value_change_requests
  drop constraint project_parameter_value_change_requests_kind_ck;
alter table public.project_parameter_value_change_requests
  add constraint project_parameter_value_change_requests_kind_ck check (
    (request_kind = 'single' and batch_proof_digest is null and batch_target_count is null
      and batch_cohort_count is null and batch_source_proof_token is null
      and batch_cohort_proof_token is null and batch_file_id is null
      and batch_base_version_id is null and batch_config_set_id is null
      and member_file_id is null and member_config_set_id is null
      and member_file_version_id is null and member_proof_digest is null
      and member_frozen_proof is null
      and binding_id is not null and definition_id is not null
      and definition_revision_id is not null and catalog_release_id is not null
      and base_current_value_id is not null and config_revision_id is not null
      and source_ref is not null and action is not null and target_value is not null)
    or
    (request_kind = 'batch' and draft_id is null and binding_id is null
      and definition_id is null and definition_revision_id is null
      and catalog_release_id is null and base_current_value_id is null
      and config_revision_id is null and source_ref is null and action is null
      and target_value is null and source_pin_id is null
      and member_file_id is null and member_config_set_id is null
      and member_file_version_id is null and member_proof_digest is null
      and member_frozen_proof is null
      and candidate_id is not null and candidate_base_digest is not null
      and candidate_proposed_digest is not null and candidate_diff_digest is not null
      and candidate_member_manifest is not null
      and candidate_binding_manifest is not null
      and jsonb_typeof(candidate_member_manifest) = 'array'
      and jsonb_typeof(candidate_binding_manifest) = 'array'
      and batch_proof_digest is not null and batch_proof_digest ~ '^[0-9a-f]{64}$'
      and batch_target_count is not null and batch_target_count >= 2
      and batch_cohort_count is not null and batch_cohort_count >= batch_target_count
      and nullif(batch_source_proof_token, '') is not null
      and nullif(batch_cohort_proof_token, '') is not null
      and nullif(batch_file_id, '') is not null
      and nullif(batch_base_version_id, '') is not null
      and nullif(batch_config_set_id, '') is not null)
    or
    (request_kind = 'member-removal' and draft_id is null and binding_id is null
      and definition_id is null and definition_revision_id is null
      and catalog_release_id is null and base_current_value_id is null
      and config_revision_id is null and source_ref is null and action is null
      and target_value is null and source_pin_id is null and candidate_id is null
      and batch_proof_digest is null and batch_target_count is null
      and batch_cohort_count is null and batch_source_proof_token is null
      and batch_cohort_proof_token is null and batch_file_id is null
      and batch_base_version_id is null and batch_config_set_id is null
      and nullif(member_file_id,'') is not null
      and nullif(member_config_set_id,'') is not null
      and nullif(member_file_version_id,'') is not null
      and member_proof_digest is not null
      and member_proof_digest ~ '^[0-9a-f]{64}$'
      and member_frozen_proof is not null
      and jsonb_typeof(member_frozen_proof) = 'object'
      and member_frozen_proof->>'kind' = 'canonical-member-removal'
      and member_frozen_proof->>'configRevisionId' is not null
      and member_frozen_proof->>'organizationId' = organization_id
      and member_frozen_proof->>'projectId' = project_id
      and member_frozen_proof->>'configSetId' = member_config_set_id
      and member_frozen_proof->>'fileId' = member_file_id
      and member_frozen_proof->>'fileVersionId' = member_file_version_id
      and member_frozen_proof->>'proofDigest' = member_proof_digest
      and member_frozen_proof->'members' is not null
      and jsonb_typeof(member_frozen_proof->'members') = 'array'
      and member_frozen_proof->'cohort' is not null
      and jsonb_typeof(member_frozen_proof->'cohort') = 'array') is true
  );

alter table public.project_parameter_value_change_requests
  drop constraint project_parameter_value_change_requests_outcome_ck;
alter table public.project_parameter_value_change_requests
  add constraint project_parameter_value_change_requests_outcome_ck check (
    (request_kind = 'single' and
      ((status = 'approved' and applied_value_id is not null and applied_at is not null
        and apply_outcome is not null and applied_history_event_id is not null
        and applied_audit_ref is not null and applied_file_version_ids is not null
        and applied_source_result is not null and jsonb_typeof(applied_file_version_ids) = 'array'
        and jsonb_typeof(applied_source_result) = 'object')
      or (status <> 'approved' and applied_value_id is null and applied_at is null
        and apply_outcome is null and applied_history_event_id is null
        and applied_audit_ref is null and applied_file_version_ids is null
        and applied_source_result is null)))
    or
    (request_kind = 'batch' and applied_value_id is null and applied_history_event_id is null and
      ((status = 'approved' and applied_at is not null and apply_outcome is not null
        and applied_audit_ref is not null and applied_file_version_ids is not null
        and applied_source_result is not null and jsonb_typeof(applied_file_version_ids) = 'array'
        and jsonb_typeof(applied_source_result) = 'object')
      or (status <> 'approved' and applied_at is null and apply_outcome is null
        and applied_audit_ref is null and applied_file_version_ids is null
        and applied_source_result is null)))
    or
    (request_kind = 'member-removal' and applied_value_id is null
      and applied_history_event_id is null and
      ((status = 'approved' and applied_at is not null and apply_outcome='committed'
        and applied_audit_ref is not null and applied_file_version_ids is not null
        and applied_file_version_ids='[]'::jsonb and applied_source_result is not null
        and jsonb_typeof(applied_source_result)='object')
       or (status <> 'approved' and applied_at is null and apply_outcome is null
        and applied_audit_ref is null and applied_file_version_ids is null
        and applied_source_result is null)))
  );

create or replace function parameter_catalog.protect_member_removal_request()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
begin
  if new.member_file_id is distinct from old.member_file_id
     or new.member_config_set_id is distinct from old.member_config_set_id
     or new.member_file_version_id is distinct from old.member_file_version_id
     or new.member_proof_digest is distinct from old.member_proof_digest
     or new.member_frozen_proof is distinct from old.member_frozen_proof then
    raise exception using errcode='55000', message='Frozen member removal request is immutable';
  end if;
  return new;
end;
$$;
create trigger project_parameter_value_change_request_member_immutable
before update on public.project_parameter_value_change_requests
for each row execute function parameter_catalog.protect_member_removal_request();

drop trigger project_parameter_value_change_request_batch_ck
  on public.project_parameter_value_change_requests;
create constraint trigger project_parameter_value_change_request_batch_ck
after insert or update on public.project_parameter_value_change_requests
deferrable initially deferred for each row
when (new.request_kind in ('single','batch'))
execute function parameter_catalog.assert_batch_value_request();

alter function parameter_catalog.protect_member_removal_request() owner to catalog_migration_owner;
revoke all on function parameter_catalog.protect_member_removal_request()
  from public, catalog_synchronizer_role, parameter_governance_writer_role;

alter table parameter_catalog.project_source_member_tombstones
  add column successor_config_revision_id text references public.dts_config_revisions(id) on delete restrict,
  add column successor_binding_manifest jsonb,
  add constraint project_source_member_tombstone_successor_ck check (
    (successor_config_revision_id is null and successor_binding_manifest is null)
    or (successor_config_revision_id is not null and jsonb_typeof(successor_binding_manifest) = 'array'
        and jsonb_array_length(successor_binding_manifest) > 0)
  );

-- The existing request ledger is the only review authority. A pending request
-- may be left by another author; only the selected request is decided.
create function parameter_catalog.assert_member_removal_request()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog, public as $$
declare
  request_row public.project_parameter_value_change_requests%rowtype;
begin
  select * into request_row from public.project_parameter_value_change_requests where id=new.id;
  if request_row.request_kind <> 'member-removal' then return null; end if;
  if request_row.submitter_user_id is null or request_row.assigned_to_user_id is null
     or request_row.submitter_user_id=request_row.assigned_to_user_id
     or exists (select 1 from public.project_parameter_value_change_targets where request_id=request_row.id)
     or request_row.member_frozen_proof->>'configRevisionId' is null then
    raise exception using errcode='23514', message='Member removal requires one frozen assigned review';
  end if;
  if request_row.status='approved' then
    if request_row.reviewer_user_id is distinct from request_row.assigned_to_user_id
       or not exists (
         select 1 from parameter_catalog.project_source_member_tombstones tombstone
         join public.audit_events audit on audit.id=tombstone.audit_event_id
         where tombstone.id=request_row.applied_source_result->>'tombstoneId'
           and tombstone.organization_id=request_row.organization_id
           and tombstone.project_id=request_row.project_id
           and tombstone.config_set_id=request_row.member_config_set_id
           and tombstone.file_id=request_row.member_file_id
           and tombstone.file_version_id=request_row.member_file_version_id
           and tombstone.config_revision_id=request_row.member_frozen_proof->>'configRevisionId'
           and tombstone.successor_config_revision_id=request_row.applied_source_result->>'successorConfigRevisionId'
           and audit.id=request_row.applied_audit_ref
           and audit.actor_user_id=request_row.reviewer_user_id
           and audit.metadata->>'reviewRequestId'=request_row.id
           and audit.metadata->>'proofDigest'=request_row.member_proof_digest
       ) then
      raise exception using errcode='23514', message='Approved member removal has no exact committed receipt';
    end if;
  elsif exists (
    select 1 from parameter_catalog.project_source_member_tombstones tombstone
    join public.audit_events audit on audit.id=tombstone.audit_event_id
    where audit.metadata->>'reviewRequestId'=request_row.id
  ) then
    raise exception using errcode='23514', message='Unapproved member removal has a tombstone';
  end if;
  return null;
end;
$$;
create constraint trigger project_parameter_value_change_request_member_ck
after insert or update on public.project_parameter_value_change_requests
deferrable initially deferred for each row
when (new.request_kind='member-removal')
execute function parameter_catalog.assert_member_removal_request();
alter function parameter_catalog.assert_member_removal_request() owner to catalog_migration_owner;
revoke all on function parameter_catalog.assert_member_removal_request()
  from public, catalog_synchronizer_role, parameter_governance_writer_role;

create or replace function parameter_catalog.assert_member_removal_tombstone()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog, public as $$
declare
  removed_bindings jsonb;
  surviving_bindings jsonb;
  surviving_count integer;
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
  if surviving_count <> jsonb_array_length(surviving_bindings)
     or surviving_bindings is distinct from new.successor_binding_manifest then
    raise exception using errcode='23514', message='Member removal must advance the complete surviving Binding cohort';
  end if;
  return null;
end;
$$;

-- Only the existing governance writer role may call this narrow audited insert.
-- Direct tombstone-table DML remains denied to runtime roles.
create function parameter_catalog.insert_reviewed_member_tombstone(
  p_id text, p_organization_id text, p_project_id text, p_config_set_id text,
  p_file_id text, p_config_revision_id text, p_file_version_id text,
  p_binding_manifest jsonb, p_successor_config_revision_id text,
  p_successor_binding_manifest jsonb, p_audit_event_id text
) returns void language plpgsql security definer
set search_path = pg_catalog, parameter_catalog, public as $$
begin
  if not exists (
    select 1 from public.audit_events audit
    join public.project_parameter_value_change_requests request
      on request.id=audit.metadata->>'reviewRequestId'
    where audit.id=p_audit_event_id and audit.organization_id=p_organization_id
      and audit.project_id=p_project_id and audit.actor_type='user'
      and audit.kind='parameter-topology-governance'
      and audit.action='source-member-removed'
      and audit.target_type='project-parameter-file' and audit.target_id=p_file_id
      and nullif(audit.metadata->>'reviewRequestId','') is not null
      and nullif(audit.metadata->>'proofDigest','') is not null
      and audit.actor_user_id is distinct from audit.metadata->>'submitterUserId'
      and audit.metadata->>'tombstoneId'=p_id
      and audit.metadata->>'configSetId'=p_config_set_id
      and audit.metadata->>'configRevisionId'=p_config_revision_id
      and audit.metadata->>'fileVersionId'=p_file_version_id
      and audit.metadata->'bindings'=p_binding_manifest
      and audit.metadata->>'successorConfigRevisionId'=p_successor_config_revision_id
      and audit.metadata->'successorBindings'=p_successor_binding_manifest
      and request.organization_id=p_organization_id and request.project_id=p_project_id
      and request.request_kind='member-removal' and request.status='pending'
      and request.member_file_id=p_file_id
      and request.member_config_set_id=p_config_set_id
      and request.member_file_version_id=p_file_version_id
      and request.member_frozen_proof->>'configRevisionId'=p_config_revision_id
      and request.member_proof_digest=audit.metadata->>'proofDigest'
      and request.submitter_user_id=audit.metadata->>'submitterUserId'
      and request.assigned_to_user_id=audit.actor_user_id
      and request.submitter_user_id is distinct from request.assigned_to_user_id
  ) then
    raise exception using errcode='23514', message='Reviewed member removal has no exact user audit receipt';
  end if;
  insert into parameter_catalog.project_source_member_tombstones
    (id,organization_id,project_id,config_set_id,file_id,config_revision_id,
     file_version_id,binding_manifest,successor_config_revision_id,
     successor_binding_manifest,audit_event_id)
  values (p_id,p_organization_id,p_project_id,p_config_set_id,p_file_id,p_config_revision_id,
          p_file_version_id,p_binding_manifest,p_successor_config_revision_id,
          p_successor_binding_manifest,p_audit_event_id);
end;
$$;

alter function parameter_catalog.assert_member_removal_tombstone() owner to catalog_migration_owner;
alter function parameter_catalog.insert_reviewed_member_tombstone(
  text,text,text,text,text,text,text,jsonb,text,jsonb,text
) owner to catalog_migration_owner;
revoke all on function parameter_catalog.insert_reviewed_member_tombstone(
  text,text,text,text,text,text,text,jsonb,text,jsonb,text
) from public, catalog_synchronizer_role, catalog_publication_coordinator_role,
       catalog_baseline_reader_role;
grant execute on function parameter_catalog.insert_reviewed_member_tombstone(
  text,text,text,text,text,text,text,jsonb,text,jsonb,text
) to parameter_governance_writer_role;
