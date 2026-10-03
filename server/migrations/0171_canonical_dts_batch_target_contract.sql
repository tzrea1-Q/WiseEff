-- #906 D forward admission for exact DTS batch targets. Keep the applied 0165
-- and 0166 bodies unchanged; the C request route remains JSON-only until its
-- owner consumes the D writer. All other frozen target/result checks persist.

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
              or not coalesce(
                (target.target_value->>'kind' = 'json-source' and exists (
                  select 1 from parameter_catalog.project_value_source_pins base_pin
                   where base_pin.id=target.source_pin_id and base_pin.format='json'
                )) or (target.target_value->>'kind' in
                  ('boolean','empty','strings','cells','bytes','mixed') and exists (
                  select 1 from parameter_catalog.project_value_source_pins base_pin
                   where base_pin.id=target.source_pin_id and base_pin.format='dts'
                ))
              , false)))
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
          or applied_value.config_revision_id is distinct from applied_pin.config_revision_id
          or applied_value.config_revision_id is not distinct from target.config_revision_id
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

alter function parameter_catalog.assert_batch_value_request()
  owner to catalog_migration_owner;
revoke all on function parameter_catalog.assert_batch_value_request()
  from public, catalog_synchronizer_role, parameter_governance_writer_role;
