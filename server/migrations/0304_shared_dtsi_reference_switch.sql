-- Only the existing frozen, administrator-confirmed composition owner may derive
-- shared snapshots. Historical revision manifests and upstream bytes stay immutable.
create function public.shared_dtsi_switch_allows_change(relation_name text, old_row jsonb, new_row jsonb, operation text)
returns boolean language sql stable security definer set search_path=pg_catalog,public,parameter_catalog as $$
  select exists(select 1 from public.project_parameter_value_change_requests request
    cross join lateral (select request.source_revision_context as proof) frozen
    where request.request_kind='member_addition' and request.status='pending'
      and request.source_revision_application_mode='administrator_direct' and proof ? 'sharedSwitch'
      and request.organization_id=proof->>'organizationId' and request.project_id=proof->>'projectId'
      and request.source_revision_config_set_id=proof->>'configSetId'
      and exists(select 1 from public.users actor join public.user_role_bindings role on role.user_id=actor.id
        and role.organization_id=actor.organization_id
        and (role.role_id='platform-admin' or role.role_id='admin' and role.organization_id=request.organization_id)
        and (role.project_id is null or role.project_id=request.project_id)
        where actor.id=request.submitter_user_id and actor.is_active)
      and case relation_name
        when 'project_parameter_file_versions' then operation='INSERT' and exists(
          select 1 from jsonb_array_elements(proof->'members') member,
            jsonb_array_elements(proof->'sharedComposition') resource,
            jsonb_array_elements(resource->'sources') source
          where source->>'fileId'=new_row->>'file_id' and member->>'fileId'=source->>'fileId'
            and member->>'checksum'=new_row->>'checksum' and (member->>'sizeBytes')::bigint=(new_row->>'size_bytes')::bigint
            and new_row->>'created_by_user_id'=request.submitter_user_id and new_row->>'origin'='upload')
        when 'project_parameter_files' then operation='UPDATE'
          and (old_row-'current_version_id'-'config_set_id'-'config_set_role'-'config_set_sort_order'-'file_name'-'updated_at')=
              (new_row-'current_version_id'-'config_set_id'-'config_set_role'-'config_set_sort_order'-'file_name'-'updated_at')
          and old_row->>'organization_id'=request.organization_id and old_row->>'project_id'=request.project_id
          and exists(select 1 from jsonb_array_elements(proof->'sharedSwitch'->'beforeFiles') source
            where source->>'fileId'=old_row->>'id' and source->>'fileVersionId'=old_row->>'current_version_id')
          and (new_row->>'config_set_id' is null and new_row->>'current_version_id'=old_row->>'current_version_id'
            and not exists(select 1 from jsonb_array_elements(proof->'members') member where member->>'fileId'=old_row->>'id')
            or new_row->>'config_set_id'=request.source_revision_config_set_id and exists(
              select 1 from jsonb_array_elements(proof->'members') member
                join public.project_parameter_file_versions version on version.id=new_row->>'current_version_id'
              where member->>'fileId'=old_row->>'id' and version.file_id=old_row->>'id'
                and member->>'sourceName'=new_row->>'file_name' and member->>'checksum'=version.checksum
                and (member->>'sizeBytes')::bigint=version.size_bytes and new_row->>'config_set_role'='misc'
                and (member->>'sortOrder')::integer=(new_row->>'config_set_sort_order')::integer))
        when 'project_shared_dtsi_references' then operation='DELETE' and exists(
          select 1 from jsonb_array_elements(proof->'sharedSwitch'->'beforeReferences') ref
          where ref->>'id'=old_row->>'id' and ref->>'resourceId'=old_row->>'resource_id'
            and ref->>'versionId'=old_row->>'revision_id' and ref->>'mountPath'=old_row->>'mount_path'
            and old_row->>'organization_id'=request.organization_id and old_row->>'project_id'=request.project_id
            and old_row->>'config_set_id'=request.source_revision_config_set_id)
        when 'project_shared_dtsi_snapshots' then operation='DELETE' and exists(
          select 1 from jsonb_array_elements(proof->'sharedSwitch'->'beforeSources') source
          where source->>'fileId'=old_row->>'file_id' and source->>'fileVersionId'=old_row->>'file_version_id'
            and source->>'referenceId'=old_row->>'reference_id' and source->>'memberId'=old_row->>'member_id')
        else false end)
$$;

-- Preserve all previous refusal/erasure branches. The exception requires the
-- migration owner plus the exact pending receipt; no caller-controlled mode flag.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('public.guard_project_shared_dtsi_source()'::regprocedure) into strict installed;
  changed:=replace(installed,'begin', $new$begin
  if current_user='catalog_migration_owner' and public.shared_dtsi_switch_allows_change(TG_TABLE_NAME,
    case when TG_OP='INSERT' then null else to_jsonb(OLD) end,
    case when TG_OP='DELETE' then null else to_jsonb(NEW) end,TG_OP) then return NEW; end if;$new$);
  changed:=replace(changed,'where file_id=target_file',
    'where file_id=target_file');
  -- A removed/replaced snapshot remains read-only through its historical manifest.
  changed:=replace(changed,
    'if exists(select 1 from public.project_shared_dtsi_snapshots where file_id=target_file',
    'if exists(select 1 from public.dts_config_revision_members where file_id=target_file and shared_reference is not null)
      or exists(select 1 from public.project_shared_dtsi_snapshots where file_id=target_file');
  if changed=installed then raise exception 'Shared source guard unavailable'; end if;
  execute changed;
  select pg_get_functiondef('public.guard_project_shared_dtsi_identity()'::regprocedure) into strict installed;
  changed:=replace(installed,'begin', $new$begin
  if current_user='catalog_migration_owner' and public.shared_dtsi_switch_allows_change(TG_TABLE_NAME,to_jsonb(OLD),
    case when TG_OP='DELETE' then null else to_jsonb(NEW) end,TG_OP) then return OLD; end if;$new$);
  if changed=installed then raise exception 'Shared identity guard unavailable'; end if;
  execute changed;
  select pg_get_functiondef('parameter_catalog.protect_pinned_source_file()'::regprocedure) into strict installed;
  changed:=replace(installed,'begin', $new$begin
  if TG_OP='UPDATE' and current_user='catalog_migration_owner'
    and public.shared_dtsi_switch_allows_change(TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW),TG_OP) then return NEW; end if;$new$);
  if changed=installed then raise exception 'Pinned source file guard unavailable'; end if;
  execute changed;
end $$;

create function public.derive_shared_dtsi_switch_version(request_id text, target_file text, version_id text, object_key text)
returns text language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$
declare r public.project_parameter_value_change_requests; member jsonb;
begin
  select * into strict r from public.project_parameter_value_change_requests where id=request_id for update;
  if r.request_kind<>'member_addition' or r.status<>'pending' or r.source_revision_application_mode<>'administrator_direct'
    or not r.source_revision_context ? 'sharedSwitch' then raise exception 'Frozen reference switch required'; end if;
  select value into strict member from jsonb_array_elements(r.source_revision_context->'members') where value->>'fileId'=target_file;
  if not exists(select 1 from public.project_parameter_files where id=target_file and organization_id=r.organization_id and project_id=r.project_id)
    or not exists(select 1 from jsonb_array_elements(r.source_revision_context->'sharedComposition') resource,
      jsonb_array_elements(resource->'sources') source
      join public.shared_dtsi_revision_members upstream on upstream.member_id=source->>'memberId'
      where source->>'fileId'=target_file and upstream.revision_id=resource->>'versionId'
        and upstream.checksum=member->>'checksum' and upstream.size_bytes=(member->>'sizeBytes')::bigint)
    then raise exception 'Exact published source required'; end if;
  insert into public.project_parameter_file_versions(id,file_id,version_number,storage_key,checksum,size_bytes,parsed_index,origin,
    created_by_user_id,initiator_type)
    values(version_id,target_file,(select coalesce(max(version_number),0)+1 from public.project_parameter_file_versions where file_id=target_file),
      object_key,member->>'checksum',(member->>'sizeBytes')::bigint,'{}','upload',r.submitter_user_id,'user');
  return version_id;
end $$;

create function public.apply_shared_dtsi_switch(request_id text, derived_sources jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$
declare r public.project_parameter_value_change_requests; resource jsonb; source jsonb; member jsonb; old_source jsonb; ref_id text; actual_version text;
begin
  select * into strict r from public.project_parameter_value_change_requests where id=request_id for update;
  if r.request_kind<>'member_addition' or r.status<>'pending' or r.source_revision_application_mode<>'administrator_direct'
    or not r.source_revision_context ? 'sharedSwitch' then raise exception 'Frozen reference switch required'; end if;
  if jsonb_array_length(derived_sources)<>(select sum(jsonb_array_length(value->'sources')) from jsonb_array_elements(r.source_revision_context->'sharedComposition'))
    or (select count(distinct value->>'fileId') from jsonb_array_elements(derived_sources))<>jsonb_array_length(derived_sources)
    then raise exception 'Complete derived source receipt required'; end if;
  for old_source in select value from jsonb_array_elements(r.source_revision_context->'sharedSwitch'->'beforeSources') loop
    delete from public.project_shared_dtsi_snapshots where file_id=old_source->>'fileId' and file_version_id=old_source->>'fileVersionId';
    if not found then raise exception 'Shared snapshot changed'; end if;
  end loop;
  delete from public.project_shared_dtsi_references where organization_id=r.organization_id and project_id=r.project_id and config_set_id=r.source_revision_config_set_id;
  for old_source in select value from jsonb_array_elements(r.source_revision_context->'sharedSwitch'->'beforeSources') loop
    if not exists(select 1 from jsonb_array_elements(r.source_revision_context->'members') value where value->>'fileId'=old_source->>'fileId') then
      update public.project_parameter_files set config_set_id=null,updated_at=now() where id=old_source->>'fileId';
    end if;
  end loop;
  for resource in select value from jsonb_array_elements(r.source_revision_context->'sharedComposition') loop
    ref_id:=gen_random_uuid()::text;
    insert into public.project_shared_dtsi_references(id,organization_id,project_id,config_set_id,resource_id,revision_id,created_by_user_id,mount_path,is_direct)
      values(ref_id,r.organization_id,r.project_id,r.source_revision_config_set_id,resource->>'resourceId',resource->>'versionId',r.submitter_user_id,resource->>'mountPath',(resource->>'direct')::boolean);
    for source in select value from jsonb_array_elements(resource->'sources') loop
      select value into strict member from jsonb_array_elements(r.source_revision_context->'members') where value->>'fileId'=source->>'fileId';
      select value->>'fileVersionId' into strict actual_version from jsonb_array_elements(derived_sources) where value->>'fileId'=source->>'fileId';
      update public.project_parameter_files set current_version_id=actual_version,config_set_id=r.source_revision_config_set_id,
        config_set_role='misc',config_set_sort_order=(member->>'sortOrder')::integer,file_name=member->>'sourceName',updated_at=now()
        where id=source->>'fileId' and organization_id=r.organization_id and project_id=r.project_id;
      if not found then raise exception 'Shared file ownership changed'; end if;
      insert into public.project_shared_dtsi_snapshots(file_id,file_version_id,reference_id,revision_id,member_id)
        values(source->>'fileId',actual_version,ref_id,resource->>'versionId',source->>'memberId');
    end loop;
  end loop;
end $$;

alter function public.shared_dtsi_switch_allows_change(text,jsonb,jsonb,text) owner to catalog_migration_owner;
alter function public.derive_shared_dtsi_switch_version(text,text,text,text) owner to catalog_migration_owner;
alter function public.apply_shared_dtsi_switch(text,jsonb) owner to catalog_migration_owner;
revoke all on function public.shared_dtsi_switch_allows_change(text,jsonb,jsonb,text),
  public.derive_shared_dtsi_switch_version(text,text,text,text),public.apply_shared_dtsi_switch(text,jsonb) from public;
grant select,insert,update,delete on public.project_shared_dtsi_references,public.project_shared_dtsi_snapshots to catalog_migration_owner;
grant select,insert on public.project_parameter_file_versions to catalog_migration_owner;
grant select,update on public.project_parameter_files to catalog_migration_owner;
do $$ declare actor text; begin
  for actor in select grantee from information_schema.role_table_grants where table_schema='public'
    and table_name='project_shared_dtsi_references' and privilege_type='INSERT' and grantee<>'PUBLIC' loop
    execute format('grant execute on function public.derive_shared_dtsi_switch_version(text,text,text,text),public.apply_shared_dtsi_switch(text,jsonb) to %I',actor);
  end loop;
end $$;
