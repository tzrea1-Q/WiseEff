-- #906: one frozen canonical request may own an ordered, relational set of
-- Binding targets. Existing single-target rows retain their exact 0146/0151
-- representation. No Binding is nominated as a synthetic primary target.

alter table public.project_parameter_value_change_requests
  add column request_kind text not null default 'single',
  add column batch_proof_digest text,
  add column batch_target_count integer,
  add column batch_cohort_count integer,
  add column batch_source_proof_token text,
  add column batch_cohort_proof_token text,
  add column batch_file_id text,
  add column batch_base_version_id text,
  add column batch_config_set_id text;

alter table public.project_parameter_value_change_requests
  alter column binding_id drop not null,
  alter column definition_id drop not null,
  alter column definition_revision_id drop not null,
  alter column catalog_release_id drop not null,
  alter column base_current_value_id drop not null,
  alter column config_revision_id drop not null,
  alter column source_ref drop not null,
  alter column action drop not null,
  alter column target_value drop not null;

alter table public.project_parameter_value_change_requests
  add constraint project_parameter_value_change_requests_kind_ck check (
    (request_kind = 'single' and batch_proof_digest is null and batch_target_count is null
      and batch_cohort_count is null
      and batch_source_proof_token is null and batch_cohort_proof_token is null
      and batch_file_id is null and batch_base_version_id is null
      and batch_config_set_id is null
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
      and candidate_id is not null and candidate_base_digest is not null
      and candidate_proposed_digest is not null and candidate_diff_digest is not null
      and candidate_member_manifest is not null
      and candidate_binding_manifest is not null
      and jsonb_typeof(candidate_member_manifest) = 'array'
      and jsonb_typeof(candidate_binding_manifest) = 'array'
      and batch_proof_digest is not null
      and batch_proof_digest ~ '^[0-9a-f]{64}$'
      and batch_target_count is not null and batch_target_count >= 2
      and batch_cohort_count is not null and batch_cohort_count >= batch_target_count
      and nullif(batch_source_proof_token, '') is not null
      and nullif(batch_cohort_proof_token, '') is not null
      and nullif(batch_file_id, '') is not null
      and nullif(batch_base_version_id, '') is not null
      and nullif(batch_config_set_id, '') is not null)
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
  );

create unique index project_parameter_value_change_requests_id_owner_uk
  on public.project_parameter_value_change_requests(id, organization_id, project_id);
create unique index project_parameter_value_change_requests_open_batch_candidate_uk
  on public.project_parameter_value_change_requests(candidate_id)
  where request_kind = 'batch' and status = 'pending';
create unique index project_parameter_value_drafts_id_owner_binding_uk
  on public.project_parameter_value_drafts(id, organization_id, project_id, binding_id);

create table public.project_parameter_value_change_targets (
  id text primary key,
  request_id text not null,
  organization_id text not null,
  project_id text not null,
  ordinal integer not null check (ordinal >= 0),
  draft_id text,
  binding_id text not null,
  definition_id text not null,
  definition_revision_id text not null,
  catalog_release_id text not null,
  base_current_value_id text not null,
  config_revision_id text not null,
  source_ref text not null check (btrim(source_ref) <> ''),
  source_pin_id text,
  action text not null check (action in ('set', 'delete')),
  target_value jsonb not null,
  target_text text,
  base_digest text,
  proposed_digest text,
  applied_value_id text,
  applied_history_event_id text,
  applied_source_pin_id text,
  applied_file_version_id text,
  constraint project_parameter_value_change_targets_request_fk
    foreign key (request_id, organization_id, project_id)
    references public.project_parameter_value_change_requests(id, organization_id, project_id)
    on delete restrict deferrable initially deferred,
  constraint project_parameter_value_change_targets_binding_fk
    foreign key (binding_id, organization_id, project_id)
    references parameter_catalog.project_parameter_bindings(id, organization_id, project_id)
    on delete restrict deferrable initially deferred,
  constraint project_parameter_value_change_targets_draft_fk
    foreign key (draft_id, organization_id, project_id, binding_id)
    references public.project_parameter_value_drafts(id, organization_id, project_id, binding_id)
    on delete set null (draft_id) deferrable initially deferred,
  constraint project_parameter_value_change_targets_value_fk
    foreign key (base_current_value_id, binding_id, definition_id)
    references parameter_catalog.project_parameter_values(id, binding_id, definition_id)
    on delete restrict deferrable initially deferred,
  constraint project_parameter_value_change_targets_pin_fk
    foreign key (source_pin_id, organization_id, project_id, binding_id)
    references parameter_catalog.project_value_source_pins(id, organization_id, project_id, binding_id)
    on delete restrict deferrable initially deferred,
  constraint project_parameter_value_change_targets_applied_value_fk
    foreign key (applied_value_id, binding_id, definition_id)
    references parameter_catalog.project_parameter_values(id, binding_id, definition_id)
    on delete restrict deferrable initially deferred,
  constraint project_parameter_value_change_targets_history_fk
    foreign key (applied_history_event_id)
    references parameter_catalog.binding_history_events(id)
    on delete restrict deferrable initially deferred,
  constraint project_parameter_value_change_targets_applied_pin_fk
    foreign key (applied_source_pin_id, organization_id, project_id, binding_id)
    references parameter_catalog.project_value_source_pins(id, organization_id, project_id, binding_id)
    on delete restrict deferrable initially deferred,
  constraint project_parameter_value_change_targets_applied_file_fk
    foreign key (applied_file_version_id)
    references public.project_parameter_file_versions(id)
    on delete restrict deferrable initially deferred,
  constraint project_parameter_value_change_targets_result_ck check (
    (applied_value_id is null and applied_history_event_id is null
      and applied_source_pin_id is null and applied_file_version_id is null)
    or
    (applied_value_id is not null and applied_history_event_id is not null
      and applied_source_pin_id is not null and applied_file_version_id is not null)
  ),
  unique (request_id, ordinal),
  unique (request_id, binding_id),
  unique (request_id, organization_id, project_id, binding_id)
);

-- All old requests gain a real target row. This preserves 0161's delete pin
-- lineage when its FK moves to target identity, including approved history.
insert into public.project_parameter_value_change_targets (
  id, request_id, organization_id, project_id, ordinal, draft_id, binding_id,
  definition_id, definition_revision_id, catalog_release_id, base_current_value_id,
  config_revision_id, source_ref, source_pin_id, action, target_value,
  applied_value_id, applied_history_event_id, applied_source_pin_id,
  applied_file_version_id
)
select 'pvct_' || request.id, request.id, request.organization_id, request.project_id,
       0, request.draft_id, request.binding_id, request.definition_id,
       request.definition_revision_id, request.catalog_release_id,
       request.base_current_value_id, request.config_revision_id,
       request.source_ref, request.source_pin_id, request.action, request.target_value,
       request.applied_value_id, request.applied_history_event_id,
       applied_pin.id, applied_pin.file_version_id
from public.project_parameter_value_change_requests request
left join parameter_catalog.project_value_source_pins applied_pin
  on applied_pin.project_value_id = request.applied_value_id
 and applied_pin.binding_id = request.binding_id
 and applied_pin.organization_id = request.organization_id
 and applied_pin.project_id = request.project_id;

-- Keep the old writer unchanged: every new single request gets the same real
-- target row, and its approved result is copied after the canonical pin exists.
create or replace function parameter_catalog.mirror_single_value_request_target()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog, public as $$
declare
  applied_pin_id text;
  applied_version_id text;
begin
  if new.request_kind <> 'single' then return null; end if;
  if tg_op = 'INSERT' then
    insert into public.project_parameter_value_change_targets (
      id, request_id, organization_id, project_id, ordinal, draft_id, binding_id,
      definition_id, definition_revision_id, catalog_release_id, base_current_value_id,
      config_revision_id, source_ref, source_pin_id, action, target_value
    ) values (
      'pvct_' || new.id, new.id, new.organization_id, new.project_id, 0, new.draft_id,
      new.binding_id, new.definition_id, new.definition_revision_id,
      new.catalog_release_id, new.base_current_value_id, new.config_revision_id,
      new.source_ref, new.source_pin_id, new.action, new.target_value
    );
  elsif new.status = 'approved' and old.status is distinct from 'approved' then
    select pin.id, pin.file_version_id into applied_pin_id, applied_version_id
      from parameter_catalog.project_value_source_pins pin
     where pin.organization_id = new.organization_id
       and pin.project_id = new.project_id and pin.binding_id = new.binding_id
       and pin.project_value_id = new.applied_value_id;
    if applied_pin_id is null then
      raise exception using errcode = '23503', message = 'Applied single target has no canonical source pin';
    end if;
    update public.project_parameter_value_change_targets
       set applied_value_id = new.applied_value_id,
           applied_history_event_id = new.applied_history_event_id,
           applied_source_pin_id = applied_pin_id,
           applied_file_version_id = applied_version_id
     where request_id = new.id and binding_id = new.binding_id;
  end if;
  return null;
end;
$$;
create trigger project_parameter_value_change_request_single_target_insert
after insert on public.project_parameter_value_change_requests
for each row execute function parameter_catalog.mirror_single_value_request_target();
create trigger project_parameter_value_change_request_single_target_apply
after update of status on public.project_parameter_value_change_requests
for each row execute function parameter_catalog.mirror_single_value_request_target();
alter function parameter_catalog.mirror_single_value_request_target()
  owner to catalog_migration_owner;
revoke all on function parameter_catalog.mirror_single_value_request_target()
  from public, catalog_synchronizer_role, parameter_governance_writer_role;

-- The old one-history-per-request index is replaced by one history per target.
drop index parameter_catalog.binding_history_events_applied_request_uk;
create unique index binding_history_events_applied_request_binding_uk
  on parameter_catalog.binding_history_events(applied_request_id, binding_id)
  where applied_request_id is not null;
alter table parameter_catalog.binding_history_events
  add constraint binding_history_event_applied_target_fk
  foreign key (applied_request_id, binding_id)
  references public.project_parameter_value_change_targets(request_id, binding_id)
  on delete no action deferrable initially deferred;

alter table parameter_catalog.project_value_source_pins
  drop constraint project_value_source_pin_delete_request_fk;
alter table parameter_catalog.project_value_source_pins
  add constraint project_value_source_pin_delete_target_fk
  foreign key (delete_request_id, organization_id, project_id, binding_id)
  references public.project_parameter_value_change_targets(request_id, organization_id, project_id, binding_id)
  on delete no action deferrable initially deferred;

-- 0151's singular result verifier continues to validate old rows verbatim.
drop trigger project_parameter_value_change_request_applied_source_result_owner_ck
  on public.project_parameter_value_change_requests;
create constraint trigger project_parameter_value_change_request_applied_source_result_owner_ck
after insert or update of status, applied_value_id, applied_at, apply_outcome,
  applied_history_event_id, applied_audit_ref, applied_file_version_ids,
  applied_source_result
on public.project_parameter_value_change_requests
deferrable initially deferred
for each row when (new.request_kind = 'single')
execute function parameter_catalog.assert_source_apply_result();

create or replace function parameter_catalog.assert_project_value_source_pin_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  binding_occurrence text;
  value_binding text;
  value_definition text;
  value_config_revision text;
  current_value_state text;
  pin_provenance_valid boolean;
begin
  select value.binding_id, value.definition_id, value.config_revision_id, value.value_state
    into value_binding, value_definition, value_config_revision, current_value_state
  from parameter_catalog.project_parameter_values value
  where value.id = new.project_value_id;
  select binding.source_occurrence_id into binding_occurrence
  from parameter_catalog.project_parameter_bindings binding
  where binding.id = new.binding_id
    and binding.organization_id = new.organization_id
    and binding.project_id = new.project_id;
  if value_binding is distinct from new.binding_id
     or value_definition is distinct from new.definition_id
     or binding_occurrence is distinct from new.source_occurrence_id then
    raise exception using errcode = '23503', message = 'ProjectValue source pin owner mismatch';
  end if;

  select exists (
    select 1
    from parameter_catalog.project_value_source_pins pin
    join parameter_catalog.project_parameter_bindings binding
      on binding.id = pin.binding_id
     and binding.organization_id = pin.organization_id
     and binding.project_id = pin.project_id
    join parameter_catalog.project_parameter_values value
      on value.id = pin.project_value_id
     and value.binding_id = pin.binding_id
     and value.definition_id = pin.definition_id
    join parameter_catalog.project_parameter_source_occurrences occurrence
      on occurrence.id = pin.source_occurrence_id
     and occurrence.organization_id = pin.organization_id
     and occurrence.project_id = pin.project_id
    join public.dts_config_revisions revision
      on revision.id = pin.config_revision_id
     and revision.organization_id = pin.organization_id
     and revision.project_id = pin.project_id
     and revision.config_set_id = occurrence.config_set_id
    join public.dts_config_revision_members member
      on member.config_revision_id = pin.config_revision_id
     and member.file_id = pin.file_id
     and member.file_version_id = pin.file_version_id
     and member.source_name is not null
    join public.project_parameter_file_versions file_version
      on file_version.id = pin.file_version_id
     and file_version.file_id = pin.file_id
    join public.project_parameter_files file
      on file.id = pin.file_id
     and file.organization_id = pin.organization_id
     and file.project_id = pin.project_id
     and file.config_set_id = occurrence.config_set_id
     and file.id = occurrence.file_id
    join parameter_catalog.parameter_definitions definition
      on definition.id = pin.definition_id
    where pin.id = new.id
      and pin.project_value_id = new.project_value_id
      and pin.binding_id = new.binding_id
      and pin.definition_id = new.definition_id
      and pin.organization_id = new.organization_id
      and pin.project_id = new.project_id
      and pin.source_occurrence_id = binding_occurrence
      and pin.config_revision_id = value_config_revision
      and pin.value_state = current_value_state
      and (pin.value_state = 'present' or exists (
        select 1
        from parameter_catalog.project_value_source_pins base_pin
        join parameter_catalog.project_parameter_values base_value on base_value.id=base_pin.project_value_id
        join public.project_parameter_value_change_requests request
          on request.id=pin.delete_request_id and request.organization_id=pin.organization_id
         and request.project_id=pin.project_id
        join public.project_parameter_value_change_targets target
          on target.request_id=request.id and target.binding_id=pin.binding_id
        join parameter_catalog.binding_history_events history
          on history.id=coalesce(target.applied_history_event_id,request.applied_history_event_id)
         and history.binding_id=pin.binding_id
         and history.old_current_value_id=base_value.id and history.new_current_value_id=value.id
         and history.success_audit_ref=request.applied_audit_ref
        join public.audit_events audit on audit.id=request.applied_audit_ref
          and audit.organization_id=pin.organization_id and audit.project_id=pin.project_id
          and audit.target_id=request.id and audit.action='value-change-applied'
        join public.project_parameter_file_candidates candidate on candidate.id=request.candidate_id
          and candidate.organization_id=pin.organization_id and candidate.project_id=pin.project_id
          and candidate.file_id=pin.file_id and candidate.base_version_id=base_pin.file_version_id
          and candidate.status='active' and candidate.activated_version_id=pin.file_version_id
        where base_pin.id=pin.base_source_pin_id and base_pin.value_state='present'
          and base_value.value_state='present' and base_value.value_kind=value.value_kind
          and base_value.value=value.value and base_value.value_digest=value.value_digest
          and base_pin.organization_id=pin.organization_id and base_pin.project_id=pin.project_id
          and base_pin.binding_id=pin.binding_id and base_pin.definition_id=pin.definition_id
          and base_pin.source_occurrence_id=pin.source_occurrence_id and base_pin.file_id=pin.file_id
          and base_pin.format=pin.format and pin.locator->>'fileVersionId'=pin.file_version_id
          and target.source_pin_id=base_pin.id and target.base_current_value_id=base_value.id
          and target.config_revision_id=base_pin.config_revision_id
          and target.action='delete' and request.status='approved'
          and coalesce(target.applied_value_id,request.applied_value_id)=value.id
          and candidate.base_digest=request.candidate_base_digest
          and candidate.proposed_digest=request.candidate_proposed_digest
          and candidate.diff_digest=request.candidate_diff_digest
          and candidate.frozen_member_manifest=request.candidate_member_manifest
          and candidate.frozen_binding_manifest=request.candidate_binding_manifest
          and ((request.request_kind='single'
            and audit.metadata->'result'=request.applied_source_result
            and request.applied_source_result->'bindings' @> jsonb_build_array(jsonb_build_object(
              'kind','target','bindingId',pin.binding_id,'oldValueId',base_value.id,'newValueId',value.id,
              'sourcePinId',pin.id,'configRevisionId',pin.config_revision_id,'fileVersionId',pin.file_version_id,
              'historyEventId',history.id,'action','delete','valueState','deleted')))
            or (request.request_kind='batch'
              and audit.metadata->>'batchProofDigest'=request.batch_proof_digest
              and audit.metadata->'result'=request.applied_source_result
              and target.applied_source_pin_id=pin.id
              and target.applied_file_version_id=pin.file_version_id
              and target.applied_history_event_id=history.id))
          and (pin.format='dts' or (
            base_pin.locator->>'pointer'=pin.locator->>'pointer'
            and pin.locator->>'pointer' <> occurrence.root_pointer
            and pin.locator->>'parentPointer'=regexp_replace(pin.locator->>'pointer','/[^/]*$','')
            and pin.locator->>'memberKey'=replace(replace(
              regexp_replace(pin.locator->>'pointer','^.*/',''),'~1','/'),'~0','~')
          ))
      ))
      and not exists (
        select 1
        from public.dts_config_revision_members missing_member
        where missing_member.config_revision_id = pin.config_revision_id
          and missing_member.source_name is null
      )
      and (
        (
          pin.format = 'dts'
          and pin.value_state = 'present'
          and occurrence.occurrence_kind = 'dts'
          and pin.property_occurrence_id is not null
          and exists (
            select 1
            from public.dts_property_occurrences property
            join public.dts_node_occurrences node
              on node.id = property.node_occurrence_id
             and node.config_revision_id = property.config_revision_id
             and node.file_version_id = property.file_version_id
            join public.dts_occurrence_effects effect
              on effect.property_occurrence_id = property.id
             and effect.node_occurrence_id = node.id
             and effect.config_revision_id = property.config_revision_id
            join public.dts_logical_node_revisions logical_revision
              on logical_revision.id = effect.logical_node_revision_id
             and logical_revision.logical_node_id = occurrence.logical_node_id
             and logical_revision.config_revision_id = property.config_revision_id
            where property.id = pin.property_occurrence_id
              and property.config_revision_id = pin.config_revision_id
              and property.file_version_id = pin.file_version_id
              and property.property_name = definition.property_key
              and property.property_name = pin.locator->>'propertyName'
              and pin.locator->>'propertyOccurrenceId' = property.id
              and pin.locator->>'nodeOccurrenceId' = node.id
              and pin.locator->>'fileVersionId' = property.file_version_id
          )
        )
        or
        (
          pin.format = 'dts'
          and pin.value_state = 'deleted'
          and occurrence.occurrence_kind = 'dts'
          and pin.property_occurrence_id is null
          and pin.locator->>'kind' = 'dts-delete'
          and pin.locator = jsonb_build_object(
            'kind', 'dts-delete',
            'nodeOccurrenceId', pin.locator->>'nodeOccurrenceId',
            'fileVersionId', pin.locator->>'fileVersionId',
            'propertyName', pin.locator->>'propertyName'
          )
          and pin.locator->>'nodeOccurrenceId' is not null
          and pin.locator->>'fileVersionId' = pin.file_version_id
          and pin.locator->>'propertyName' = definition.property_key
          and pin.locator_digest = parameter_catalog.canonical_dts_delete_locator_digest(pin.locator)
          and pin.delete_proof->>'nodeOccurrenceId' = pin.locator->>'nodeOccurrenceId'
          and pin.delete_proof->>'propertyName' = pin.locator->>'propertyName'
          and pin.delete_proof->>'beforeValueDigest' = (
            select old_value.value_digest from parameter_catalog.project_value_source_pins base_pin
            join parameter_catalog.project_parameter_values old_value on old_value.id=base_pin.project_value_id
            where base_pin.id=pin.base_source_pin_id)
          and pin.delete_proof->>'beforeSourceDigest' = (
            select case when base_file_version.checksum like 'sha256:%' then base_file_version.checksum else 'sha256:' || base_file_version.checksum end
              from parameter_catalog.project_value_source_pins base_pin
              join public.project_parameter_file_versions base_file_version on base_file_version.id=base_pin.file_version_id and base_file_version.file_id=base_pin.file_id
             where base_pin.id=pin.base_source_pin_id)
          and pin.delete_proof->>'afterSourceDigest' = case when file_version.checksum like 'sha256:%' then file_version.checksum else 'sha256:' || file_version.checksum end
          and exists (
            select 1 from parameter_catalog.project_value_source_pins base_pin
            join public.project_parameter_value_change_requests request
              on request.id = pin.delete_request_id
             and request.organization_id = pin.organization_id
             and request.project_id = pin.project_id
             join public.project_parameter_value_change_targets target
              on target.request_id = request.id and target.binding_id = pin.binding_id
            where base_pin.id = pin.base_source_pin_id
              and base_pin.binding_id = pin.binding_id
              and base_pin.project_value_id = target.base_current_value_id
              and target.action = 'delete'
              and request.status = 'approved'
          )
          and (
            select count(*)
            from public.dts_occurrence_effects effect
            join public.dts_node_occurrences node
              on node.id = effect.node_occurrence_id
             and node.config_revision_id = effect.config_revision_id
             and node.file_version_id = pin.file_version_id
            join public.dts_logical_node_revisions logical_revision
              on logical_revision.id = effect.logical_node_revision_id
             and logical_revision.config_revision_id = effect.config_revision_id
             and logical_revision.logical_node_id = occurrence.logical_node_id
            where effect.config_revision_id = pin.config_revision_id
              and effect.property_name = definition.property_key
              and effect.effect_kind = 'delete'
              and effect.property_occurrence_id is null
              and node.id = pin.locator->>'nodeOccurrenceId'
              and not exists (
                select 1
                from public.dts_occurrence_effects later
                where later.config_revision_id = effect.config_revision_id
                  and later.logical_node_revision_id = effect.logical_node_revision_id
                  and later.property_name = effect.property_name
                  and (later.source_order > effect.source_order
                    or (later.source_order = effect.source_order and later.id <> effect.id))
              )
          ) = 1
        )
        or
        (
          pin.format = 'json'
          and pin.value_state = 'present'
          and occurrence.occurrence_kind = 'json'
          and pin.property_occurrence_id is null
          and revision.config_set_id = occurrence.config_set_id
          and exists (
            select 1
            from parameter_catalog.organization_subject_registrations registration
            where registration.organization_id = pin.organization_id
              and registration.subject_id = occurrence.configuration_schema_subject_id
              and registration.status = 'active'
          )
          and pin.locator->>'kind' = 'json-pointer'
          and occurrence.configuration_schema_subject_id = binding.subject_id
          and parameter_catalog.json_pointer_contains(
            occurrence.root_pointer,
            pin.locator->>'pointer'
          )
        )
        or
        (
          pin.format = 'json'
          and pin.value_state = 'deleted'
          and occurrence.occurrence_kind = 'json'
          and pin.property_occurrence_id is null
          and pin.locator->>'kind' = 'json-delete'
          and pin.locator_digest = parameter_catalog.canonical_json_delete_locator_digest(pin.locator)
          and occurrence.configuration_schema_subject_id = binding.subject_id
          and pin.locator->>'rootPointer' = occurrence.root_pointer
          and pin.delete_proof->>'rootPointer' = pin.locator->>'rootPointer'
          and pin.delete_proof->>'pointer' = pin.locator->>'pointer'
          and pin.delete_proof->>'parentPointer' = pin.locator->>'parentPointer'
          and pin.delete_proof->>'memberKey' = pin.locator->>'memberKey'
          and pin.delete_proof->>'beforeValueDigest' = (
            select old_value.value_digest from parameter_catalog.project_value_source_pins base_pin
            join parameter_catalog.project_parameter_values old_value on old_value.id=base_pin.project_value_id
            where base_pin.id=pin.base_source_pin_id)
          and pin.delete_proof->>'beforeSourceDigest' = (
            select case when base_file_version.checksum like 'sha256:%' then base_file_version.checksum else 'sha256:' || base_file_version.checksum end
              from parameter_catalog.project_value_source_pins base_pin
              join public.project_parameter_file_versions base_file_version on base_file_version.id=base_pin.file_version_id and base_file_version.file_id=base_pin.file_id
             where base_pin.id=pin.base_source_pin_id)
          and pin.delete_proof->>'afterSourceDigest' = case when file_version.checksum like 'sha256:%' then file_version.checksum else 'sha256:' || file_version.checksum end
          and parameter_catalog.json_pointer_contains(occurrence.root_pointer, pin.locator->>'pointer')
          and exists (
            select 1 from parameter_catalog.project_value_source_pins base_pin
            join public.project_parameter_value_change_requests request
              on request.id = pin.delete_request_id
             and request.organization_id = pin.organization_id
             and request.project_id = pin.project_id
             join public.project_parameter_value_change_targets target
              on target.request_id = request.id and target.binding_id = pin.binding_id
            where base_pin.id = pin.base_source_pin_id
              and base_pin.binding_id = pin.binding_id
              and base_pin.project_value_id = target.base_current_value_id
              and target.action = 'delete'
              and request.status = 'approved'
          )
        )
      )
  ) into pin_provenance_valid;
  if not pin_provenance_valid then
    raise exception using errcode = '23503', message = 'ProjectValue source pin does not prove its exact revision, member and locator';
  end if;
  return null;
end;
$$;

create or replace function parameter_catalog.protect_batch_value_request()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
begin
  if new.request_kind is distinct from old.request_kind
     or new.batch_proof_digest is distinct from old.batch_proof_digest
     or new.batch_target_count is distinct from old.batch_target_count
     or new.batch_cohort_count is distinct from old.batch_cohort_count
     or new.batch_source_proof_token is distinct from old.batch_source_proof_token
     or new.batch_cohort_proof_token is distinct from old.batch_cohort_proof_token
     or new.batch_file_id is distinct from old.batch_file_id
     or new.batch_base_version_id is distinct from old.batch_base_version_id
     or new.batch_config_set_id is distinct from old.batch_config_set_id then
    raise exception using errcode = '55000', message = 'Frozen batch request identity is immutable';
  end if;
  return new;
end;
$$;
create trigger project_parameter_value_change_request_batch_immutable
before update on public.project_parameter_value_change_requests
for each row execute function parameter_catalog.protect_batch_value_request();

create or replace function parameter_catalog.protect_batch_value_target()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
begin
  if tg_op = 'DELETE' then
    if parameter_catalog.plane_disposal_allows_delete(tg_table_schema, tg_table_name, old.id) then
      return old;
    end if;
    raise exception using errcode = '55000', message = 'Frozen batch target cannot be deleted';
  end if;
  if (to_jsonb(new) - array['draft_id', 'applied_value_id', 'applied_history_event_id',
                              'applied_source_pin_id', 'applied_file_version_id'])
     is distinct from
     (to_jsonb(old) - array['draft_id', 'applied_value_id', 'applied_history_event_id',
                              'applied_source_pin_id', 'applied_file_version_id'])
     or (new.draft_id is distinct from old.draft_id
         and not (old.draft_id is not null and new.draft_id is null))
     or (old.applied_value_id is not null and
         (new.applied_value_id is distinct from old.applied_value_id
          or new.applied_history_event_id is distinct from old.applied_history_event_id
          or new.applied_source_pin_id is distinct from old.applied_source_pin_id
          or new.applied_file_version_id is distinct from old.applied_file_version_id)) then
    raise exception using errcode = '55000', message = 'Frozen batch target identity or result is immutable';
  end if;
  return new;
end;
$$;
create trigger project_parameter_value_change_target_immutable
before update or delete on public.project_parameter_value_change_targets
for each row execute function parameter_catalog.protect_batch_value_target();

create or replace function parameter_catalog.assert_batch_value_request()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog, public as $$
declare
  request_row public.project_parameter_value_change_requests%rowtype;
  target_count integer;
begin
  if tg_table_name = 'project_parameter_value_change_targets' then
    select * into request_row from public.project_parameter_value_change_requests
     where id = coalesce(new.request_id, old.request_id);
  else
    request_row := new;
  end if;
  if request_row.id is null then return null; end if;
  if request_row.request_kind = 'single' then
    if (select count(*) from public.project_parameter_value_change_targets
         where request_id = request_row.id) <> 1
       or not exists (
         select 1 from public.project_parameter_value_change_targets target
          where target.request_id = request_row.id and target.ordinal = 0
            and target.binding_id = request_row.binding_id
            and target.organization_id = request_row.organization_id
            and target.project_id = request_row.project_id
            and target.definition_id = request_row.definition_id
            and target.definition_revision_id = request_row.definition_revision_id
            and target.catalog_release_id = request_row.catalog_release_id
            and target.base_current_value_id = request_row.base_current_value_id
            and target.config_revision_id = request_row.config_revision_id
            and target.source_ref = request_row.source_ref
            and target.source_pin_id is not distinct from request_row.source_pin_id
            and target.action = request_row.action
            and target.target_value = request_row.target_value
       ) then
      raise exception using errcode = '23514', message = 'Single request target mirror is incomplete';
    end if;
    return null;
  end if;

  if not exists (
    select 1 from public.project_parameter_file_candidates candidate
    join public.project_parameter_files file on file.id = candidate.file_id
     where candidate.id = request_row.candidate_id
       and candidate.organization_id = request_row.organization_id
       and candidate.project_id = request_row.project_id
       and candidate.file_id = request_row.batch_file_id
       and candidate.base_version_id = request_row.batch_base_version_id
       and file.config_set_id = request_row.batch_config_set_id
       and file.organization_id = request_row.organization_id
       and file.project_id = request_row.project_id
       and ((request_row.status = 'pending' and candidate.status = 'ready')
         or (request_row.status = 'approved' and candidate.status = 'active')
         or request_row.status in ('rejected', 'withdrawn'))
  ) then
    raise exception using errcode = '23503', message = 'Batch source candidate identity is not frozen';
  end if;

  select count(*) into target_count
    from public.project_parameter_value_change_targets target
   where target.request_id = request_row.id;
  if target_count <> request_row.batch_target_count or target_count < 2
     or exists (
       select 1 from public.project_parameter_value_change_targets target
        where target.request_id = request_row.id
          and (target.ordinal >= request_row.batch_target_count
            or target.organization_id <> request_row.organization_id
            or target.project_id <> request_row.project_id
            or target.source_pin_id is null
            or target.base_digest is distinct from request_row.candidate_base_digest
            or target.proposed_digest is distinct from request_row.candidate_proposed_digest
            or (target.action = 'set' and (target.target_text is null
              or target.target_value->>'kind' is distinct from 'json-source'))
            or (target.action = 'delete' and target.target_text is not null))
     ) then
    raise exception using errcode = '23514', message = 'Batch request does not own a complete ordered target set';
  end if;

  if exists (
    select 1
      from public.project_parameter_value_change_targets target
      join parameter_catalog.project_parameter_bindings binding on binding.id = target.binding_id
      join parameter_catalog.project_parameter_values base_value on base_value.id = target.base_current_value_id
      join parameter_catalog.project_value_source_pins base_pin on base_pin.id = target.source_pin_id
     where target.request_id = request_row.id
       and (binding.organization_id <> request_row.organization_id
         or binding.project_id <> request_row.project_id
         or binding.definition_id <> target.definition_id
         or binding.effective_revision_id <> target.definition_revision_id
         or binding.catalog_release_id <> target.catalog_release_id
         or base_value.binding_id <> target.binding_id
         or base_value.definition_id <> target.definition_id
         or base_value.config_revision_id <> target.config_revision_id
         or base_value.source_ref <> target.source_ref
         or base_pin.project_value_id <> target.base_current_value_id
         or base_pin.config_revision_id <> target.config_revision_id
         or base_pin.file_id <> (select file_id from public.project_parameter_file_candidates
                                  where id = request_row.candidate_id)
         or (request_row.status = 'pending'
           and binding.current_value_id <> target.base_current_value_id))
  ) then
    raise exception using errcode = '23503', message = 'Batch target frozen identity or source pin mismatch';
  end if;

  if request_row.status = 'approved' then
    if exists (
      select 1 from public.project_parameter_value_change_targets target
      left join parameter_catalog.binding_history_events history
        on history.id = target.applied_history_event_id
      left join parameter_catalog.project_value_source_pins applied_pin
        on applied_pin.id = target.applied_source_pin_id
      left join parameter_catalog.project_parameter_values applied_value
        on applied_value.id = target.applied_value_id
      left join parameter_catalog.project_parameter_bindings binding
        on binding.id = target.binding_id
      left join public.audit_events audit on audit.id = request_row.applied_audit_ref
      where target.request_id = request_row.id
        and (target.applied_value_id is null or target.applied_history_event_id is null
          or target.applied_source_pin_id is null or target.applied_file_version_id is null
          or history.binding_id is distinct from target.binding_id
          or history.applied_request_id is distinct from request_row.id
          or history.old_current_value_id is distinct from target.base_current_value_id
          or history.new_current_value_id is distinct from target.applied_value_id
          or history.success_audit_ref is distinct from request_row.applied_audit_ref
          or applied_value.binding_id is distinct from target.binding_id
          or applied_value.definition_id is distinct from target.definition_id
          or applied_value.config_revision_id is distinct from target.config_revision_id
          or applied_pin.project_value_id is distinct from target.applied_value_id
          or applied_pin.binding_id is distinct from target.binding_id
          or applied_pin.file_version_id is distinct from target.applied_file_version_id
          or applied_pin.value_state is distinct from
             (case when target.action = 'delete' then 'deleted' else 'present' end)
          or binding.current_value_id is distinct from target.applied_value_id
          or (select candidate.activated_version_id
                from public.project_parameter_file_candidates candidate
               where candidate.id = request_row.candidate_id)
             is distinct from target.applied_file_version_id
          or (select file.current_version_id
                from public.project_parameter_files file
               where file.id = request_row.batch_file_id)
             is distinct from target.applied_file_version_id
          or (target.action = 'delete' and
             (applied_pin.base_source_pin_id is distinct from target.source_pin_id
              or applied_pin.delete_request_id is distinct from request_row.id))
          or audit.organization_id is distinct from request_row.organization_id
          or audit.project_id is distinct from request_row.project_id
          or audit.target_id is distinct from request_row.id
          or audit.action is distinct from 'value-change-applied'
          or audit.metadata->>'batchProofDigest' is distinct from request_row.batch_proof_digest
          or audit.metadata->'result' is distinct from request_row.applied_source_result
          or (request_row.applied_file_version_ids @>
              jsonb_build_array(target.applied_file_version_id)) is not true)
    ) then
      raise exception using errcode = '23503', message = 'Batch applied result is not owned by every frozen target';
    end if;
    if jsonb_typeof(request_row.applied_source_result->'bindings') is distinct from 'array'
       or jsonb_array_length(request_row.applied_source_result->'bindings')
            <> request_row.batch_cohort_count
       or (select count(*) from jsonb_array_elements(request_row.applied_source_result->'bindings') item
            where item->>'kind' = 'target') <> request_row.batch_target_count
       or exists (
         select 1 from jsonb_array_elements(request_row.applied_source_result->'bindings')
           with ordinality effect(item, ordinal)
         left join parameter_catalog.project_parameter_bindings binding
           on binding.id = effect.item->>'bindingId'
          and binding.organization_id = request_row.organization_id
          and binding.project_id = request_row.project_id
         left join parameter_catalog.project_parameter_values old_value
           on old_value.id = effect.item->>'oldValueId'
          and old_value.binding_id = binding.id
         left join parameter_catalog.project_parameter_values new_value
           on new_value.id = effect.item->>'newValueId'
          and new_value.binding_id = binding.id
         left join parameter_catalog.project_value_source_pins pin
           on pin.id = effect.item->>'sourcePinId'
          and pin.binding_id = binding.id
          and pin.project_value_id = new_value.id
          and pin.organization_id = request_row.organization_id
          and pin.project_id = request_row.project_id
         left join parameter_catalog.binding_history_events history
           on history.id = effect.item->>'historyEventId'
          and history.binding_id = binding.id
          and history.old_current_value_id = old_value.id
          and history.new_current_value_id = new_value.id
         left join public.project_parameter_value_change_targets target
           on target.request_id = request_row.id and target.binding_id = binding.id
         where effect.item->>'ordinal' is distinct from (effect.ordinal - 1)::text
            or coalesce(effect.item->>'kind', '') not in ('target', 'sibling-derived')
            or binding.id is null or old_value.id is null or new_value.id is null
            or pin.id is null or history.id is null
            or new_value.config_revision_id is distinct from effect.item->>'configRevisionId'
            or pin.config_revision_id is distinct from effect.item->>'configRevisionId'
            or pin.file_version_id is distinct from effect.item->>'fileVersionId'
            or history.success_audit_ref is distinct from request_row.applied_audit_ref
            or (request_row.applied_file_version_ids @>
                jsonb_build_array(effect.item->>'fileVersionId')) is not true
            or (effect.item->>'kind' = 'target' and
               (target.id is null or history.applied_request_id is distinct from request_row.id
                or target.base_current_value_id is distinct from old_value.id
                or target.applied_value_id is distinct from new_value.id
                or target.applied_source_pin_id is distinct from pin.id
                or target.applied_history_event_id is distinct from history.id
                or target.applied_file_version_id is distinct from pin.file_version_id
                or target.action is distinct from effect.item->>'action'
                or pin.value_state is distinct from effect.item->>'valueState'))
            or (effect.item->>'kind' = 'sibling-derived' and
               (target.id is not null or history.applied_request_id is not null))
       )
       or exists (
         select 1 from jsonb_array_elements(request_row.applied_source_result->'bindings')
           with ordinality a(item, ordinal)
         join jsonb_array_elements(request_row.applied_source_result->'bindings')
           with ordinality b(item, ordinal)
           on a.ordinal < b.ordinal
          and a.item->>'bindingId' = b.item->>'bindingId'
       ) then
      raise exception using errcode = '23514', message = 'Batch source result does not match its relational target and history';
    end if;
  elsif exists (
    select 1 from public.project_parameter_value_change_targets target
     where target.request_id = request_row.id and target.applied_value_id is not null
  ) then
    raise exception using errcode = '23514', message = 'Unapproved batch has an applied result';
  end if;
  return null;
end;
$$;
create constraint trigger project_parameter_value_change_request_batch_ck
after insert or update on public.project_parameter_value_change_requests
deferrable initially deferred for each row
execute function parameter_catalog.assert_batch_value_request();
create constraint trigger project_parameter_value_change_target_batch_ck
after insert or update on public.project_parameter_value_change_targets
deferrable initially deferred for each row
execute function parameter_catalog.assert_batch_value_request();

alter function parameter_catalog.protect_batch_value_request() owner to catalog_migration_owner;
alter function parameter_catalog.protect_batch_value_target() owner to catalog_migration_owner;
alter function parameter_catalog.assert_batch_value_request() owner to catalog_migration_owner;
revoke all on function parameter_catalog.protect_batch_value_request(),
  parameter_catalog.protect_batch_value_target(), parameter_catalog.assert_batch_value_request()
  from public, catalog_synchronizer_role, parameter_governance_writer_role;

-- The 0154-0159 disposer is a closed list with a migration-owner definer.
-- Keep the same txid-scoped allowlist and grants while adding this child table.
create or replace function parameter_catalog.dispose_plane_residue(
  p_archive_id text,
  p_relation_from text,
  p_pk_column text,
  p_pks text[]
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog, public
as $$
declare
  deleted integer := 0;
  allowed constant text[] := array[
    'public.parameter_drafts',
    'public.project_parameter_values',
    'public.parameter_draft_identity_invalidations',
    'public.parameter_history_entries',
    'public.parameter_submission_rounds',
    'public.parameter_change_requests',
    'public.project_parameter_bindings',
    'public.project_parameter_files',
    'public.project_parameter_file_candidates',
    'public.project_parameter_initialization_drafts',
    'public.project_parameter_initialization_reviews',
    'public.parameter_import_batches',
    'public.parameter_file_sync_conflicts',
    'public.identity_mapping_tasks',
    'public.parameter_spec_matcher_overrides',
    'public.dts_property_occurrence_spec_decisions',
    'public.project_parameter_value_drafts',
    'public.project_parameter_value_change_requests',
    'public.project_parameter_value_change_targets',
    'public.parameter_review_decisions',
    'public.parameter_submission_items',
    'public.project_parameter_binding_revisions',
    'public.project_parameter_file_versions',
    'public.dts_config_set',
    'public.dts_release_baseline',
    'public.dts_release_baseline_members',
    'public.dts_config_revisions',
    'public.dts_config_revision_members',
    'public.dts_logical_nodes',
    'public.dts_logical_node_revisions',
    'public.dts_node_occurrences',
    'public.dts_property_occurrences',
    'public.dts_occurrence_effects',
    'public.dts_nodes',
    'public.dts_properties',
    'public.dts_phandle_refs',
    'public.dts_validation_runs',
    'public.dts_validation_diagnostics',
    'parameter_catalog.project_parameter_bindings',
    'parameter_catalog.project_parameter_source_occurrences',
    'parameter_catalog.project_value_source_pins',
    'parameter_catalog.binding_history_events',
    'parameter_catalog.project_parameter_values'
  ];
begin
  if p_relation_from is null or not (p_relation_from = any (allowed)) then
    raise exception using errcode = '22023', message = 'plane disposal relation is not in the closed list';
  end if;
  if p_pk_column is null or p_pk_column not in ('id', 'draft_id') then
    raise exception using errcode = '22023', message = 'plane disposal pk column is not allowed';
  end if;
  if p_pks is null or cardinality(p_pks) = 0 then
    return 0;
  end if;
  insert into parameter_catalog.plane_disposal_allowlist (archive_id, relation_from, pk)
  select p_archive_id, p_relation_from, pk
    from unnest(p_pks) as pk
  on conflict do nothing;
  execute format(
    'delete from %s where %I = any($1)',
    p_relation_from,
    p_pk_column
  ) using p_pks;
  get diagnostics deleted = row_count;
  delete from parameter_catalog.plane_disposal_allowlist
   where archive_id = p_archive_id
     and relation_from = p_relation_from;
  return deleted;
end;
$$;
alter function parameter_catalog.dispose_plane_residue(text, text, text, text[])
  owner to catalog_migration_owner;
grant select, insert, update, delete on public.project_parameter_value_change_targets
  to catalog_migration_owner;
revoke all on public.project_parameter_value_change_targets
  from public, catalog_synchronizer_role, parameter_governance_writer_role;
