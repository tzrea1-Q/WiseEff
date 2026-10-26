-- Conversion retains existing immutable file/version/occurrence identities.
-- A complete frozen receipt proves the ownership change; source bytes are not copied.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('public.guard_project_shared_dtsi_provenance()'::regprocedure) into strict installed;
  changed:=replace(installed,'m.checksum=v.checksum',
    $new$regexp_replace(m.checksum,'^sha256:','')=regexp_replace(v.checksum,'^sha256:','')$new$);
  changed:=replace(changed,$old$(case when r.mount_path='' then m.source_name else r.mount_path||'/'||m.source_name end)=f.file_name$old$,
    $new$((case when r.mount_path='' then m.source_name else r.mount_path||'/'||m.source_name end)=f.file_name
      or exists(select 1 from public.project_parameter_value_change_requests request
        cross join lateral jsonb_array_elements(request.source_revision_context->'sharedConversion'->'files') pair
        join public.dts_config_revision_members original on original.config_revision_id=request.source_revision_context->>'baseConfigRevisionId'
          and original.file_id=pair->>'fileId' and original.file_version_id=pair->>'fileVersionId' and original.shared_reference is null
        where request.organization_id=r.organization_id and request.project_id=r.project_id and request.source_revision_config_set_id=r.config_set_id
          and request.request_kind='member_addition' and request.status='pending' and request.source_revision_application_mode='administrator_direct'
          and pair->>'fileId'=f.id and pair->>'fileVersionId'=v.id and pair->>'resourceId'=r.resource_id
          and pair->>'versionId'=r.revision_id and pair->>'memberId'=m.member_id
          and pair->>'sourceName'=original.source_name
          and original.source_name=case when r.mount_path='' then m.source_name else r.mount_path||'/'||m.source_name end))$new$);
  if changed=installed then raise exception 'Shared provenance checksum marker unavailable'; end if;
  execute changed;
  select pg_get_functiondef('parameter_catalog.assert_member_addition_receipt()'::regprocedure) into strict installed;
  changed:=replace(installed,$old$if r.source_revision_context ? 'sharedReference' and not exists($old$,
    $new$if r.source_revision_context ? 'sharedReference' and not r.source_revision_context ? 'sharedConversion' and not exists($new$);
  if changed=installed then raise exception 'Shared root receipt marker unavailable'; end if;
  changed:=replace(changed,$old$if r.source_revision_context ? 'sharedComposition' and ($old$,
    $new$if r.source_revision_context ? 'sharedComposition' and not r.source_revision_context ? 'sharedConversion' and ($new$);
  changed:=replace(changed,$old$result := r.applied_source_result;$old$,$new$result := r.applied_source_result;
  if r.source_revision_context ? 'sharedConversion' and (
    r.source_revision_context->'sharedConversion'->>'semanticEqual' is distinct from 'true'
    or r.source_revision_context->'sharedConversion'->>'identitiesRetained' is distinct from 'true'
    or r.source_revision_context ? 'rootEdit' or r.source_revision_context ? 'sharedSwitch'
    or jsonb_array_length(r.source_revision_context->'targets')<>0
    or jsonb_array_length(r.source_revision_context->'newProperties')<>0
    or jsonb_typeof(result->'derivedSources') is distinct from 'array'
    or jsonb_array_length(result->'derivedSources')<>jsonb_array_length(r.source_revision_context->'sharedConversion'->'files')
    or jsonb_array_length(result->'derivedSources')<>(select sum(jsonb_array_length(value->'sources')) from jsonb_array_elements(r.source_revision_context->'sharedComposition'))
    or (select count(distinct value->>'fileId') from jsonb_array_elements(r.source_revision_context->'sharedConversion'->'files'))<>jsonb_array_length(result->'derivedSources')
    or jsonb_array_length(r.applied_file_version_ids)<>jsonb_array_length(result->'derivedSources')
    or (select count(distinct value->>'fileId') from jsonb_array_elements(result->'derivedSources'))<>jsonb_array_length(result->'derivedSources')
    or not exists(select 1 from public.dts_config_revisions before_revision join public.dts_config_revisions after_revision
      on after_revision.id=result->>'configRevisionId' and after_revision.organization_id=before_revision.organization_id
      and after_revision.project_id=before_revision.project_id and after_revision.config_set_id=before_revision.config_set_id
      where before_revision.id=r.source_revision_context->>'baseConfigRevisionId'
        and before_revision.organization_id=r.organization_id and before_revision.project_id=r.project_id
        and before_revision.config_set_id=r.source_revision_config_set_id
        and before_revision.entry_file=after_revision.entry_file and before_revision.include_search_paths=after_revision.include_search_paths
        and before_revision.overlay_order=after_revision.overlay_order and before_revision.declared_build_inputs=after_revision.declared_build_inputs
        and before_revision.preprocessing is not distinct from after_revision.preprocessing)
    or (select count(*) from public.dts_config_revision_members where config_revision_id=r.source_revision_context->>'baseConfigRevisionId')
      <>(select count(*) from public.dts_config_revision_members where config_revision_id=result->>'configRevisionId')
    or exists(select 1 from public.dts_config_revision_members after_member where after_member.config_revision_id=result->>'configRevisionId'
      and not exists(select 1 from public.dts_config_revision_members before_member
        where before_member.config_revision_id=r.source_revision_context->>'baseConfigRevisionId'
          and before_member.file_id=after_member.file_id and before_member.file_version_id=after_member.file_version_id
          and before_member.source_name=after_member.source_name and before_member.role=after_member.role and before_member.sort_order=after_member.sort_order))
    or not exists(select 1 from public.project_shared_dtsi_references ref
      join public.project_shared_dtsi_snapshots snapshot on snapshot.reference_id=ref.id and snapshot.file_id=result->>'fileId' and snapshot.file_version_id=result->>'fileVersionId'
      join public.shared_dtsi_revisions upstream on upstream.id=ref.revision_id
      join public.audit_events origin on origin.organization_id=r.organization_id and origin.kind='shared-dtsi-project-source' and origin.action='import'
        and origin.target_type='shared-dtsi-resource' and origin.target_id=ref.resource_id and origin.actor_type='user'
        and origin.metadata->'evidence'->>'digest'=upstream.manifest->'sourceEvidence'->>'digest'
      where ref.organization_id=r.organization_id and ref.project_id=r.project_id and ref.config_set_id=r.source_revision_config_set_id
        and ref.resource_id=r.source_revision_context->'sharedReference'->>'resourceId'
        and ref.revision_id=r.source_revision_context->'sharedReference'->>'versionId'
        and snapshot.member_id=r.source_revision_context->'sharedReference'->>'memberId'
        and upstream.digest=r.source_revision_context->'sharedReference'->>'digest'
        and upstream.manifest->'sourceEvidence'->>'digest'=r.source_revision_context->'sharedConversion'->>'sourceEvidence')
    or exists(select 1 from jsonb_array_elements(r.source_revision_context->'sharedComposition') resource,
      jsonb_array_elements(resource->'sources') source where not exists(
        select 1 from jsonb_array_elements(r.source_revision_context->'sharedConversion'->'files') pair,
          jsonb_array_elements(result->'derivedSources') derived,
          public.project_shared_dtsi_references ref join public.project_shared_dtsi_snapshots snapshot on snapshot.reference_id=ref.id
          join public.shared_dtsi_revisions upstream on upstream.id=ref.revision_id
          join public.shared_dtsi_revision_members member on member.revision_id=upstream.id and member.member_id=snapshot.member_id
          join public.project_parameter_file_versions version on version.id=snapshot.file_version_id and version.file_id=snapshot.file_id
          join public.dts_config_revision_members before_member on before_member.config_revision_id=r.source_revision_context->>'baseConfigRevisionId'
            and before_member.file_id=snapshot.file_id and before_member.file_version_id=snapshot.file_version_id and before_member.shared_reference is null
        where pair->>'fileId'=source->>'fileId' and pair->>'memberId'=source->>'memberId'
          and pair->>'resourceId'=resource->>'resourceId' and pair->>'versionId'=resource->>'versionId'
          and pair->>'fileVersionId'=snapshot.file_version_id and pair->>'sourceName'=before_member.source_name
          and pair->>'role'=before_member.role and (pair->>'sortOrder')::integer=before_member.sort_order
          and derived->>'fileId'=snapshot.file_id and derived->>'fileVersionId'=snapshot.file_version_id
          and r.applied_file_version_ids ? snapshot.file_version_id
          and ref.organization_id=r.organization_id and ref.project_id=r.project_id and ref.config_set_id=r.source_revision_config_set_id
          and ref.resource_id=resource->>'resourceId' and ref.revision_id=resource->>'versionId' and upstream.digest=resource->>'digest'
          and ref.mount_path=resource->>'mountPath' and ref.is_direct=(resource->>'direct')::boolean
          and snapshot.file_id=source->>'fileId' and snapshot.member_id=source->>'memberId'
          and regexp_replace(version.checksum,'^sha256:','')=regexp_replace(member.checksum,'^sha256:','') and version.size_bytes=member.size_bytes))
  ) then raise exception using errcode='23514',message='Private conversion has no complete unchanged source receipt'; end if;$new$);
  execute changed;
  select pg_get_expr(conbin,conrelid) into strict installed from pg_constraint
    where conrelid='public.project_parameter_value_change_requests'::regclass and conname='project_parameter_value_change_requests_outcome_ck';
  changed:=replace(installed,'jsonb_array_length(applied_file_version_ids) = 1',
    $new$(jsonb_array_length(applied_file_version_ids)=1 or (request_kind='member_addition'
      and source_revision_context ? 'sharedConversion'
      and jsonb_array_length(applied_file_version_ids)=jsonb_array_length(applied_source_result->'derivedSources')))$new$);
  if changed=installed then raise exception 'Conversion version-count marker unavailable'; end if;
  alter table public.project_parameter_value_change_requests drop constraint project_parameter_value_change_requests_outcome_ck;
  execute format('alter table public.project_parameter_value_change_requests add constraint project_parameter_value_change_requests_outcome_ck check (%s)',changed);
end $$;

-- Only a completed exact private historical restoration can make this file
-- privately writable again. Every later canonical revision must retain that
-- private member through its own committed source receipt.
create function public.shared_dtsi_private_source_is_restored(target_file text)
returns boolean language sql stable security definer set search_path=pg_catalog,public,parameter_catalog as $$
  select exists(select 1 from public.project_parameter_files file
    join public.project_parameter_value_change_requests request on request.organization_id=file.organization_id and request.project_id=file.project_id
      and request.source_revision_config_set_id=file.config_set_id and request.request_kind='configuration_restore'
      and request.status='approved' and request.apply_outcome='committed' and request.source_revision_application_mode='administrator_direct'
    join public.dts_config_revisions restored on restored.id=request.applied_source_result->>'configRevisionId'
      and restored.organization_id=file.organization_id and restored.project_id=file.project_id and restored.config_set_id=file.config_set_id and restored.status='resolved'
    join public.dts_config_revisions latest on latest.organization_id=file.organization_id and latest.project_id=file.project_id
      and latest.config_set_id=file.config_set_id and latest.status='resolved' and latest.revision_number>=restored.revision_number
      and (latest.id=(select id from public.dts_config_revisions where config_set_id=file.config_set_id and status='resolved' order by revision_number desc limit 1)
        or exists(select 1 from public.project_parameter_value_change_requests pending
          join public.dts_config_revisions proposed on proposed.organization_id=file.organization_id and proposed.project_id=file.project_id
            and proposed.config_set_id=file.config_set_id and proposed.revision_number=latest.revision_number+1 and proposed.status='resolved'
            and proposed.id=(select id from public.dts_config_revisions where config_set_id=file.config_set_id and status='resolved' order by revision_number desc limit 1)
          join public.dts_config_revision_members proposed_member on proposed_member.config_revision_id=proposed.id and proposed_member.file_id=file.id
            and proposed_member.shared_reference is null
          join public.project_parameter_file_versions proposed_version on proposed_version.id=proposed_member.file_version_id and proposed_version.file_id=file.id
          where pending.organization_id=file.organization_id and pending.project_id=file.project_id and pending.source_revision_config_set_id=file.config_set_id
            and pending.request_kind='source_revision' and pending.status='pending'
            and pending.source_revision_context->>'baseConfigRevisionId'=latest.id
            and pending.source_revision_context->>'fileId'=file.id and pending.source_revision_context->>'baseVersionId'=file.current_version_id
            and regexp_replace(proposed_version.checksum,'^sha256:','')=pending.source_revision_context->>'proposedDigest'
            and proposed.entry_file=latest.entry_file and proposed.include_search_paths=latest.include_search_paths
            and proposed.overlay_order=latest.overlay_order and proposed.declared_build_inputs=latest.declared_build_inputs))
    join public.dts_config_revision_members current_member on current_member.config_revision_id=latest.id and current_member.file_id=file.id
      and current_member.file_version_id=file.current_version_id and current_member.shared_reference is null
      and current_member.sort_order=file.config_set_sort_order
      and file.config_set_role=case when current_member.role='include' then 'misc' else current_member.role end
    cross join lateral jsonb_array_elements(request.source_revision_context->'members') planned
    join public.dts_config_revision_members historical on historical.config_revision_id=request.source_revision_context->>'snapshotConfigRevisionId'
      and historical.file_id=file.id and historical.file_version_id=planned->>'fileVersionId' and historical.shared_reference is null
    join public.dts_release_baseline_members saved on saved.baseline_id=request.source_revision_context->>'baselineId'
      and saved.file_id=file.id and saved.file_version_id=historical.file_version_id
    join public.dts_config_revision_members restored_member on restored_member.config_revision_id=restored.id
      and restored_member.file_id=file.id and restored_member.file_version_id=historical.file_version_id and restored_member.shared_reference is null
    where file.id=target_file and planned->>'fileId'=file.id and (planned->'sharedReference' is null or planned->'sharedReference'='null'::jsonb)
      and current_member.source_name=historical.source_name
      and not exists(select 1 from public.project_shared_dtsi_snapshots where file_id=file.id)
      and not exists(select 1 from public.dts_config_revisions lineage where lineage.config_set_id=file.config_set_id and lineage.status='resolved'
        and lineage.revision_number between restored.revision_number and latest.revision_number
        and (not exists(select 1 from public.dts_config_revision_members member where member.config_revision_id=lineage.id and member.file_id=file.id and member.shared_reference is null)
          or not exists(select 1 from public.project_parameter_value_change_requests receipt where receipt.organization_id=file.organization_id
            and receipt.project_id=file.project_id and receipt.source_revision_config_set_id=file.config_set_id and receipt.status='approved'
            and receipt.apply_outcome='committed' and receipt.request_kind in('configuration_restore','source_revision','member_addition')
            and receipt.applied_source_result->>'configRevisionId'=lineage.id))))
$$;

create function public.shared_dtsi_private_restore_allows_change(relation_name text,old_row jsonb,new_row jsonb,operation text)
returns boolean language sql stable security definer set search_path=pg_catalog,public,parameter_catalog as $$
  select relation_name='project_parameter_files' and operation='UPDATE'
    and (old_row-'current_version_id'-'config_set_id'-'config_set_role'-'config_set_sort_order'-'updated_at')=
        (new_row-'current_version_id'-'config_set_id'-'config_set_role'-'config_set_sort_order'-'updated_at')
    and exists(select 1 from public.project_parameter_value_change_requests request
      cross join lateral jsonb_array_elements(request.source_revision_context->'members') planned
      join public.dts_config_revisions historical_revision on historical_revision.id=request.source_revision_context->>'snapshotConfigRevisionId'
        and historical_revision.organization_id=request.organization_id and historical_revision.project_id=request.project_id
        and historical_revision.config_set_id=request.source_revision_config_set_id and historical_revision.status='resolved'
      join public.dts_config_revision_members historical on historical.config_revision_id=historical_revision.id
        and historical.file_id=planned->>'fileId' and historical.file_version_id=planned->>'fileVersionId' and historical.shared_reference is null
      join public.dts_release_baseline_members saved on saved.baseline_id=request.source_revision_context->>'baselineId'
        and saved.file_id=historical.file_id and saved.file_version_id=historical.file_version_id
      join public.project_parameter_file_versions version on version.id=historical.file_version_id and version.file_id=historical.file_id
      where request.request_kind='configuration_restore' and request.status='pending' and request.source_revision_application_mode='administrator_direct'
        and request.organization_id=old_row->>'organization_id' and request.project_id=old_row->>'project_id'
        and request.source_revision_config_set_id=new_row->>'config_set_id' and planned->>'fileId'=old_row->>'id'
        and planned->>'currentVersionId'=old_row->>'current_version_id'
        and (planned->>'currentConfigSetId') is not distinct from old_row->>'config_set_id'
        and planned->>'fileVersionId'=new_row->>'current_version_id' and planned->>'sourceName'=historical.source_name
        and new_row->>'config_set_role'=case when historical.role='include' then 'misc' else historical.role end
        and (new_row->>'config_set_sort_order')::integer=historical.sort_order
        and regexp_replace(version.checksum,'^sha256:','')=regexp_replace(planned->>'checksum','^sha256:','')
        and version.size_bytes=(planned->>'sizeBytes')::bigint
        and exists(select 1 from jsonb_array_elements(request.source_revision_context->'sharedSwitch'->'beforeFiles') before_file
          where before_file->>'fileId'=old_row->>'id' and before_file->>'fileVersionId'=old_row->>'current_version_id')
        and exists(select 1 from public.users actor join public.user_role_bindings role on role.user_id=actor.id
          and role.organization_id=actor.organization_id and (role.role_id='platform-admin' or role.role_id='admin' and role.organization_id=request.organization_id)
          and (role.project_id is null or role.project_id=request.project_id) where actor.id=request.submitter_user_id and actor.is_active))
$$;

create function public.restore_private_shared_dtsi_source(request_id text,target_file text)
returns text language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$
declare request public.project_parameter_value_change_requests; file public.project_parameter_files; planned jsonb; proposed jsonb;
begin
  select * into strict request from public.project_parameter_value_change_requests where id=request_id for update;
  select * into strict file from public.project_parameter_files where id=target_file for update;
  select value into strict planned from jsonb_array_elements(request.source_revision_context->'members') where value->>'fileId'=target_file;
  proposed:=to_jsonb(file)||jsonb_build_object('current_version_id',planned->>'fileVersionId','config_set_id',request.source_revision_config_set_id,
    'config_set_role',case when planned->>'role'='include' then 'misc' else planned->>'role' end,'config_set_sort_order',(planned->>'sortOrder')::integer);
  if not public.shared_dtsi_private_restore_allows_change('project_parameter_files',to_jsonb(file),proposed,'UPDATE')
    then raise exception 'Exact private historical restore receipt required'; end if;
  update public.project_parameter_files set current_version_id=planned->>'fileVersionId',config_set_id=request.source_revision_config_set_id,
    config_set_role=proposed->>'config_set_role',config_set_sort_order=(proposed->>'config_set_sort_order')::integer,updated_at=now() where id=target_file;
  return planned->>'fileVersionId';
end $$;

do $$ declare installed text; changed text; begin
  select pg_get_functiondef('public.shared_dtsi_switch_allows_change(text,jsonb,jsonb,text)'::regprocedure) into strict installed;
  changed:=replace(installed,'select exists(select 1 from public.project_parameter_value_change_requests request',
    'select public.shared_dtsi_private_restore_allows_change(relation_name,old_row,new_row,operation) or exists(select 1 from public.project_parameter_value_change_requests request');
  if changed=installed then raise exception 'Shared restore receipt predicate unavailable'; end if;
  execute changed;
  select pg_get_functiondef('public.guard_project_shared_dtsi_source()'::regprocedure) into strict installed;
  changed:=replace(installed,
    'if exists(select 1 from public.dts_config_revision_members where file_id=target_file and shared_reference is not null)',
    $new$if (not public.shared_dtsi_private_source_is_restored(target_file)
      or TG_TABLE_NAME='project_parameter_file_versions' and TG_OP<>'INSERT' and exists(
        select 1 from public.dts_config_revision_members where file_version_id=OLD.id and shared_reference is not null))
      and (exists(select 1 from public.dts_config_revision_members where file_id=target_file and shared_reference is not null)$new$);
  changed:=replace(changed,$old$or (TG_OP='UPDATE' and file_id=to_jsonb(NEW)->>'file_id')) then$old$,
    $new$or (TG_OP='UPDATE' and file_id=to_jsonb(NEW)->>'file_id'))) then$new$);
  if changed=installed then raise exception 'Shared historical fence marker unavailable'; end if;
  execute changed;
end $$;
alter function public.shared_dtsi_private_source_is_restored(text) owner to catalog_migration_owner;
alter function public.shared_dtsi_private_restore_allows_change(text,jsonb,jsonb,text) owner to catalog_migration_owner;
alter function public.restore_private_shared_dtsi_source(text,text) owner to catalog_migration_owner;
revoke all on function public.shared_dtsi_private_source_is_restored(text),public.shared_dtsi_private_restore_allows_change(text,jsonb,jsonb,text),
  public.restore_private_shared_dtsi_source(text,text) from public;
do $$ declare actor text; begin
  for actor in select grantee from information_schema.role_table_grants where table_schema='public' and table_name='project_parameter_files'
    and privilege_type='SELECT' and grantee<>'PUBLIC' loop
    execute format('grant execute on function public.shared_dtsi_private_source_is_restored(text),public.restore_private_shared_dtsi_source(text,text) to %I',actor);
  end loop;
end $$;
