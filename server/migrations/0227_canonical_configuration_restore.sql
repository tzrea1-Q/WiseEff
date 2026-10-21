-- A new snapshot pins an actual complete source revision and its dependency
-- count. Old snapshots stay unchanged and require actual historical evidence.
alter table public.dts_release_baseline add column source_snapshot jsonb;
alter table public.dts_release_baseline add constraint dts_release_baseline_source_snapshot_ck check (
  source_snapshot is null or ((jsonb_typeof(source_snapshot)='object'
    and nullif(source_snapshot->>'configRevisionId','') is not null
    and jsonb_typeof(source_snapshot->'sourcePinCount')='number'
    and (source_snapshot->>'sourcePinCount')::integer>=0) is true));
create function parameter_catalog.protect_baseline_source_snapshot() returns trigger language plpgsql
set search_path=pg_catalog,parameter_catalog,public as $$
begin
  if new.source_snapshot is distinct from old.source_snapshot then
    raise exception using errcode='23514',message='Snapshot source composition is immutable';
  end if;
  return new;
end $$;
create trigger dts_release_baseline_source_snapshot_immutable before update on public.dts_release_baseline
for each row execute function parameter_catalog.protect_baseline_source_snapshot();
alter function parameter_catalog.protect_baseline_source_snapshot() owner to catalog_migration_owner;
revoke all on function parameter_catalog.protect_baseline_source_snapshot() from public;

-- Extend existing request constraints without rewriting their unrelated cases.
do $$
declare installed text; changed text;
begin
  select pg_get_expr(conbin,conrelid) into strict installed from pg_constraint
    where conrelid='public.project_parameter_value_change_requests'::regclass and conname='project_parameter_value_change_requests_kind_ck';
  changed:=replace(installed,'''member_addition''::text','''configuration_restore''::text');
  if changed=installed then raise exception 'Member addition shape is unavailable'; end if;
  alter table public.project_parameter_value_change_requests drop constraint project_parameter_value_change_requests_kind_ck;
  execute format('alter table public.project_parameter_value_change_requests add constraint project_parameter_value_change_requests_kind_ck check ((%s) or (%s))',installed,changed);
  select pg_get_expr(conbin,conrelid) into strict installed from pg_constraint
    where conrelid='public.project_parameter_value_change_requests'::regclass and conname='project_parameter_value_change_requests_outcome_ck';
  changed:=replace(installed,'''member_addition''::text','''configuration_restore''::text');
  changed:=replace(changed,'jsonb_array_length(applied_file_version_ids) = 1','jsonb_array_length(applied_file_version_ids) > 0');
  alter table public.project_parameter_value_change_requests drop constraint project_parameter_value_change_requests_outcome_ck;
  execute format('alter table public.project_parameter_value_change_requests add constraint project_parameter_value_change_requests_outcome_ck check ((%s) or (%s))',installed,changed);
  select pg_get_expr(conbin,conrelid) into strict installed from pg_constraint
    where conrelid='public.project_parameter_value_change_requests'::regclass and conname='project_parameter_source_application_mode_ck';
  alter table public.project_parameter_value_change_requests drop constraint project_parameter_source_application_mode_ck;
  execute format('alter table public.project_parameter_value_change_requests add constraint project_parameter_source_application_mode_ck check ((%s) or (source_revision_application_mode=''administrator_direct'' and request_kind=''configuration_restore'' and assigned_to_user_id is null and reviewer_user_id is null))',installed);
  select pg_get_expr(conbin,conrelid) into strict installed from pg_constraint
    where conrelid='public.project_parameter_value_change_requests'::regclass and conname='project_parameter_value_change_request_candidate_artifact_ck';
  alter table public.project_parameter_value_change_requests drop constraint project_parameter_value_change_request_candidate_artifact_ck;
  execute format($check$alter table public.project_parameter_value_change_requests add constraint project_parameter_value_change_request_candidate_artifact_ck
    check ((%s) or ((request_kind='configuration_restore' and candidate_id is null
      and source_revision_context->'candidateId'='null'::jsonb and nullif(source_revision_context->>'baselineId','') is not null
      and candidate_base_digest=source_revision_context->>'baseDigest' and candidate_proposed_digest=source_revision_context->>'proposedDigest'
      and candidate_diff_digest=source_revision_context->>'proofDigest' and candidate_member_manifest=source_revision_context->'members'
      and candidate_binding_manifest=source_revision_context->'cohort') is true))$check$,installed);
  select pg_get_functiondef('parameter_catalog.assert_source_candidate_snapshot()'::regprocedure) into strict installed;
  changed:=replace(installed,'request.request_kind=''member_addition''','request.request_kind in (''member_addition'',''configuration_restore'')');
  if changed=installed then raise exception 'Composition snapshot guard is unavailable'; end if;
  execute changed;
  select pg_get_functiondef('parameter_catalog.assert_batch_value_request()'::regprocedure) into strict installed;
  changed:=replace(installed,'''source_revision'',''member_addition''','''source_revision'',''member_addition'',''configuration_restore''');
  if changed=installed then raise exception 'Source target guard is unavailable'; end if;
  execute changed;
  -- All transfer checks continue to require real old/new pins and the final
  -- effective property graph. The restore owner uses the same receipt shape.
  select pg_get_functiondef('parameter_catalog.source_origin_matches(text,text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,'request.request_kind=''member_addition''','request.request_kind in (''member_addition'',''configuration_restore'')');
  changed:=replace(changed,'''member_addition'',''member-removal''','''member_addition'',''member-removal'',''configuration_restore''');
  if changed=installed then raise exception 'Source origin receipt guard is unavailable'; end if;
  execute changed;
  -- Definition erasure must detach surviving cross-file provenance from this
  -- indivisible approval exactly as for member addition/removal.
  select pg_get_functiondef('parameter_catalog.purge_parameter_definition(text,jsonb,text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,'request.request_kind=''member_addition''','request.request_kind in (''member_addition'',''configuration_restore'')');
  changed:=replace(changed,'''member_addition'',''member-removal''','''member_addition'',''member-removal'',''configuration_restore''');
  if changed=installed then raise exception 'Source erasure receipt guard is unavailable'; end if;
  installed:=changed;
  changed:=replace(installed,$old$pin.format='dts' and pin.file_id<>occurrence.file_id
      and parameter_catalog.source_origin_matches(pin.binding_id,pin.source_occurrence_id,pin.file_id)$old$,$new$(
      (pin.format='dts' and pin.file_id<>occurrence.file_id
        and parameter_catalog.source_origin_matches(pin.binding_id,pin.source_occurrence_id,pin.file_id))
      or exists(select 1 from public.project_parameter_value_change_requests restore
        cross join lateral jsonb_array_elements(restore.applied_source_result->'results') receipt
        where restore.id=any(parameter_catalog.definition_purge_ids(targets,'public.project_parameter_value_change_requests'))
          and restore.request_kind='configuration_restore' and restore.status='approved'
          and receipt->>'sourcePinId'=pin.id and receipt->>'bindingId'=pin.binding_id
          and receipt->>'newValueId'=pin.project_value_id))$new$);
  if changed=installed then raise exception 'Restore erasure provenance marker is unavailable'; end if;
  execute changed;
  select pg_get_functiondef('parameter_catalog.protect_pinned_source_file()'::regprocedure) into strict installed;
  changed:=replace(installed,'      if old.config_set_id is not null and new.config_set_id is null', $restore$
      if (old.config_set_id is null or old.config_set_id=new.config_set_id)
        and (to_jsonb(new)-array['config_set_id','config_set_role','config_set_sort_order','current_version_id','updated_at'])
          is not distinct from (to_jsonb(old)-array['config_set_id','config_set_role','config_set_sort_order','current_version_id','updated_at'])
        and exists(select 1 from public.project_parameter_value_change_requests restore
          cross join lateral jsonb_array_elements(restore.source_revision_context->'members') member
          join public.dts_release_baseline baseline on baseline.id=restore.source_revision_context->>'baselineId'
            and baseline.organization_id=restore.organization_id and baseline.config_set_id=restore.source_revision_config_set_id
          join public.dts_release_baseline_members saved on saved.baseline_id=baseline.id and saved.file_id=old.id
            and saved.file_version_id=member->>'fileVersionId'
          join public.project_parameter_file_versions version on version.id=new.current_version_id and version.file_id=old.id
            and version.checksum=member->>'checksum' and version.size_bytes=(member->>'sizeBytes')::bigint
          where restore.request_kind='configuration_restore' and restore.status='pending'
            and restore.organization_id=old.organization_id and restore.project_id=old.project_id
            and restore.source_revision_config_set_id=new.config_set_id and member->>'fileId'=old.id
            and (member->>'currentVersionId') is not distinct from old.current_version_id
            and new.config_set_role=case when member->>'role'='include' then 'misc' else member->>'role' end
            and new.config_set_sort_order=(member->>'sortOrder')::integer) then return new;
      end if;
      if old.config_set_id is not null and new.config_set_id is null$restore$);
  if changed=installed then raise exception 'Pinned file composition marker is unavailable'; end if;
  execute changed;
  select pg_get_functiondef('parameter_catalog.assert_removed_member_has_tombstone()'::regprocedure) into strict installed;
  changed:=replace(installed,$marker$    raise exception using errcode='23514', message='A retired canonical member cannot be reattached';$marker$,$restore$
    if not exists(select 1 from public.project_parameter_value_change_requests restore
      join public.dts_release_baseline_members saved on saved.baseline_id=restore.source_revision_context->>'baselineId' and saved.file_id=new.id
      join public.dts_config_revision_members member on member.config_revision_id=restore.applied_source_result->>'configRevisionId'
        and member.file_id=new.id and member.file_version_id=new.current_version_id
      where restore.organization_id=new.organization_id and restore.project_id=new.project_id
        and restore.request_kind='configuration_restore' and restore.status='approved' and restore.source_revision_config_set_id=new.config_set_id) then
      raise exception using errcode='23514', message='A retired canonical member cannot be reattached';
    end if;$restore$);
  if changed=installed then raise exception 'Retired membership guard is unavailable'; end if;
  execute changed;
end $$;

-- A retained member can become current only through a newer complete restore.
-- Later ordinary edits keep that restored membership; a later removal wins.
create function parameter_catalog.source_member_is_restored(p_binding_id text,p_tombstone_id text)
returns boolean language sql stable security definer set search_path=pg_catalog,parameter_catalog,public as $$
select exists(select 1 from public.project_parameter_value_change_requests request
  join parameter_catalog.project_source_member_tombstones tombstone on tombstone.id=$2
    and tombstone.organization_id=request.organization_id and tombstone.project_id=request.project_id
    and tombstone.config_set_id=request.source_revision_config_set_id
  join public.dts_config_revisions restored on restored.id=request.applied_source_result->>'configRevisionId'
  join public.dts_config_revisions removed on removed.id=tombstone.config_revision_id and restored.revision_number>removed.revision_number
  cross join lateral jsonb_array_elements(request.applied_source_result->'results') receipt
  join parameter_catalog.project_value_source_pins pin on pin.id=receipt->>'sourcePinId' and pin.binding_id=$1
    and pin.project_value_id=receipt->>'newValueId' and pin.config_revision_id=restored.id and pin.file_id=tombstone.file_id
  where request.request_kind='configuration_restore' and request.status='approved' and receipt->>'bindingId'=$1)
or exists(select 1 from parameter_catalog.project_value_source_pins pin
  join parameter_catalog.definition_erasures erasure on erasure.audit_event_id=pin.erased_request_audit_id
  join parameter_catalog.project_source_member_tombstones tombstone on tombstone.id=$2
    and tombstone.organization_id=pin.organization_id and tombstone.project_id=pin.project_id and tombstone.file_id=pin.file_id
  join public.dts_config_revisions restored on restored.id=pin.config_revision_id and restored.status='resolved'
    and restored.organization_id=pin.organization_id and restored.project_id=pin.project_id and restored.config_set_id=tombstone.config_set_id
  join public.dts_config_revisions removed on removed.id=tombstone.config_revision_id and restored.revision_number>removed.revision_number
  join public.dts_config_revision_members member on member.config_revision_id=restored.id and member.file_id=pin.file_id and member.file_version_id=pin.file_version_id
  where pin.binding_id=$1 and pin.value_state='present')
$$;
alter function parameter_catalog.source_member_is_restored(text,text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.source_member_is_restored(text,text) from public;
do $$
begin
  if exists(select 1 from pg_roles where rolname='wiseeff_api') then grant execute on function parameter_catalog.source_member_is_restored(text,text) to wiseeff_api; end if;
end $$;
create or replace view parameter_catalog.current_project_parameter_bindings as
select binding.* from parameter_catalog.project_parameter_bindings binding
where not exists(select 1 from parameter_catalog.definition_replacement_projects replacement
  where replacement.status='completed' and replacement.old_binding_id=binding.id)
and ((not exists(select 1 from parameter_catalog.project_parameter_values value
  where value.id=binding.current_value_id and value.value_state='deleted')
and not exists(select 1 from parameter_catalog.project_parameter_values value
  join parameter_catalog.project_value_source_pins pin on pin.project_value_id=value.id and pin.binding_id=value.binding_id
  where value.id=binding.current_value_id and pin.locator->>'kind' in ('dts-delete','json-delete'))
and not exists(select 1 from parameter_catalog.project_parameter_source_occurrences occurrence
  join parameter_catalog.project_source_member_tombstones tombstone on tombstone.organization_id=occurrence.organization_id
    and tombstone.project_id=occurrence.project_id and tombstone.config_set_id=occurrence.config_set_id
    and tombstone.file_id=coalesce((select pin.file_id from parameter_catalog.project_value_source_pins pin
      where pin.binding_id=binding.id and pin.project_value_id=binding.current_value_id),occurrence.file_id)
  where occurrence.id=binding.source_occurrence_id and not parameter_catalog.source_member_is_restored(binding.id,tombstone.id)))
or exists(select 1 from public.project_parameter_value_change_requests restore
  where restore.organization_id=binding.organization_id and restore.project_id=binding.project_id
    and restore.request_kind='configuration_restore' and restore.status='pending'
    and restore.source_revision_context->'cohort' @> jsonb_build_array(jsonb_build_object('bindingId',binding.id))));

create function parameter_catalog.assert_configuration_restore_receipt() returns trigger language plpgsql security definer
set search_path=pg_catalog,parameter_catalog,public as $$
declare r public.project_parameter_value_change_requests%rowtype; result jsonb; target jsonb;
begin
  if tg_table_name='project_parameter_value_change_targets' then
    select * into r from public.project_parameter_value_change_requests where id=new.request_id;
  else select * into r from public.project_parameter_value_change_requests where id=new.id; end if;
  if r.request_kind<>'configuration_restore' then return null; end if;
  result:=r.applied_source_result;
  if r.status<>'approved' or result->>'requestId' is distinct from r.id
    or result->>'sourceRevisionProofDigest' is distinct from r.source_revision_proof_digest
    or result->>'baselineId' is distinct from r.source_revision_context->>'baselineId'
    or not exists(select 1 from public.dts_release_baseline baseline
      join public.dts_config_revisions historical on historical.id=r.source_revision_context->>'snapshotConfigRevisionId'
        and historical.organization_id=baseline.organization_id and historical.config_set_id=baseline.config_set_id and historical.project_id=r.project_id
      join public.dts_config_revisions actual on actual.id=result->>'configRevisionId' and actual.organization_id=historical.organization_id
        and actual.project_id=historical.project_id and actual.config_set_id=historical.config_set_id and actual.status='resolved'
      join public.audit_events audit on audit.id=r.applied_audit_ref and audit.organization_id=r.organization_id and audit.project_id=r.project_id
        and audit.target_id=r.id and audit.action='value-change-applied' and audit.metadata->'result'=result
        and audit.metadata->>'requestKind'='configuration_restore' and audit.metadata->>'applicationMode'='administrator_direct'
      where baseline.id=result->>'baselineId' and baseline.organization_id=r.organization_id and baseline.config_set_id=r.source_revision_config_set_id
        and actual.revision_number>historical.revision_number
        and actual.entry_file is not distinct from r.source_revision_context->>'entryFile'
        and to_jsonb(actual.include_search_paths)=r.source_revision_context->'includeSearchPaths'
        and to_jsonb(actual.overlay_order)=r.source_revision_context->'overlayOrder') then
    raise exception using errcode='23514',message='Configuration restore has no complete owned source receipt';
  end if;
  if (select count(*) from public.dts_config_revision_members where config_revision_id=result->>'configRevisionId')<>jsonb_array_length(r.source_revision_context->'members')
    or (select count(*) from public.project_parameter_files where organization_id=r.organization_id and project_id=r.project_id
      and config_set_id=r.source_revision_config_set_id)<>jsonb_array_length(r.source_revision_context->'members')
    or exists(select 1 from jsonb_array_elements(r.source_revision_context->'members') frozen
      where not exists(select 1 from public.dts_config_revision_members member
        join public.project_parameter_file_versions version on version.id=member.file_version_id and version.file_id=member.file_id
        join public.project_parameter_files file on file.id=member.file_id and file.organization_id=r.organization_id and file.project_id=r.project_id
          and file.config_set_id=r.source_revision_config_set_id and file.current_version_id=version.id
          and file.config_set_role=case when member.role='include' then 'misc' else member.role end and file.config_set_sort_order=member.sort_order
        where member.config_revision_id=result->>'configRevisionId' and member.file_id=frozen->>'fileId'
          and member.source_name=frozen->>'sourceName' and member.role=frozen->>'role' and member.sort_order=(frozen->>'sortOrder')::integer
          and file.format=frozen->>'format' and version.checksum=frozen->>'checksum' and version.size_bytes=(frozen->>'sizeBytes')::bigint)) then
    raise exception using errcode='23514',message='Configuration restore lost a frozen source member';
  end if;
  if exists(select 1 from public.dts_release_baseline_members saved
    where saved.baseline_id=result->>'baselineId' and not exists(select 1 from jsonb_array_elements(r.source_revision_context->'members') frozen
      join public.project_parameter_file_versions version on version.id=saved.file_version_id and version.file_id=saved.file_id
      where frozen->>'fileId'=saved.file_id and frozen->>'fileVersionId'=saved.file_version_id
        and version.checksum=frozen->>'checksum' and version.size_bytes=(frozen->>'sizeBytes')::bigint))
    or exists(select 1 from jsonb_array_elements(r.source_revision_context->'cohort') frozen
      where not exists(select 1 from parameter_catalog.project_value_source_pins old_pin
        join parameter_catalog.project_parameter_bindings binding on binding.id=old_pin.binding_id
          and binding.source_occurrence_id=old_pin.source_occurrence_id and binding.definition_id=old_pin.definition_id
        where old_pin.id=frozen->>'sourcePinId' and old_pin.binding_id=frozen->>'bindingId' and old_pin.project_value_id=frozen->>'oldValueId'
          and old_pin.organization_id=r.organization_id and old_pin.project_id=r.project_id
          and (frozen->>'snapshotValueId' is null or exists(select 1 from parameter_catalog.project_value_source_pins historical
            where historical.binding_id=binding.id and historical.source_occurrence_id=binding.source_occurrence_id
              and historical.project_value_id=frozen->>'snapshotValueId' and historical.value_state='present'
              and historical.config_revision_id=r.source_revision_context->>'snapshotConfigRevisionId')))) then
    raise exception using errcode='23514',message='Configuration restore lost its exact saved versions or historical parameter identity';
  end if;
  if jsonb_array_length(result->'results')<>jsonb_array_length(r.source_revision_context->'cohort')
    or exists(select 1 from jsonb_array_elements(r.source_revision_context->'cohort') frozen
      where not exists(select 1 from jsonb_array_elements(result->'results') receipt
        join parameter_catalog.project_parameter_bindings binding on binding.id=receipt->>'bindingId'
        join parameter_catalog.project_parameter_values value on value.id=receipt->>'newValueId' and value.binding_id=binding.id
          and value.value_state='present' and value.value_kind=frozen->'payload'->>'kind' and value.value=frozen->'payload'->'value'
          and value.config_revision_id=result->>'configRevisionId'
        join parameter_catalog.project_value_source_pins pin on pin.id=receipt->>'sourcePinId' and pin.project_value_id=value.id and pin.binding_id=binding.id
          and pin.source_occurrence_id=binding.source_occurrence_id and pin.definition_id=binding.definition_id and pin.config_revision_id=value.config_revision_id
        join parameter_catalog.binding_history_events history on history.id=receipt->>'historyEventId' and history.binding_id=binding.id
          and history.old_current_value_id=frozen->>'oldValueId' and history.new_current_value_id=value.id and history.success_audit_ref=r.applied_audit_ref
        where receipt->>'bindingId'=frozen->>'bindingId' and receipt->>'oldValueId'=frozen->>'oldValueId'
          and binding.organization_id=r.organization_id and binding.project_id=r.project_id))
    or (select count(*) from parameter_catalog.current_project_parameter_bindings binding
      join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
      where binding.organization_id=r.organization_id and binding.project_id=r.project_id and occurrence.config_set_id=r.source_revision_config_set_id)
       <>jsonb_array_length(result->'results') then
    raise exception using errcode='23514',message='Configuration restore has an incomplete parameter cohort';
  end if;
  for target in select value from jsonb_array_elements(r.source_revision_context->'targets') loop
    if not exists(select 1 from public.project_parameter_value_change_targets applied where applied.request_id=r.id and applied.binding_id=target->>'bindingId'
      and applied.action='set' and applied.target_value=target->'payload' and applied.applied_value_id is not null
      and applied.applied_source_pin_id is not null and applied.applied_history_event_id is not null and applied.applied_file_version_id is not null) then
      raise exception using errcode='23514',message='Configuration restore has an incomplete parameter target';
    end if;
  end loop;
  return null;
end $$;
create constraint trigger project_parameter_configuration_restore_ck after insert or update on public.project_parameter_value_change_requests
  deferrable initially deferred for each row when(new.request_kind='configuration_restore') execute function parameter_catalog.assert_configuration_restore_receipt();
create constraint trigger project_parameter_configuration_restore_target_ck after insert or update on public.project_parameter_value_change_targets
  deferrable initially deferred for each row execute function parameter_catalog.assert_configuration_restore_receipt();
alter function parameter_catalog.assert_configuration_restore_receipt() owner to catalog_migration_owner;
revoke all on function parameter_catalog.assert_configuration_restore_receipt() from public;
