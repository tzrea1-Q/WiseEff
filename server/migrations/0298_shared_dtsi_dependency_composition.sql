-- Additive authoring intent; published dependency closure remains in immutable manifests.
alter table public.shared_dtsi_drafts add column dependencies jsonb not null default '[]'::jsonb
  check(jsonb_typeof(dependencies)='array' and jsonb_array_length(dependencies)<=32);
alter table public.project_shared_dtsi_references add column mount_path text not null default '';
alter table public.project_shared_dtsi_references add column is_direct boolean not null default true;

do $$ declare installed text; changed text; begin
  select pg_get_functiondef('public.guard_project_shared_dtsi_provenance()'::regprocedure) into strict installed;
  changed:=replace(installed,'m.source_name=f.file_name',
    '(case when r.mount_path='''' then m.source_name else r.mount_path||''/''||m.source_name end)=f.file_name');
  if changed=installed then raise exception 'Shared source path marker unavailable'; end if;
  execute changed;
  select pg_get_expr(conbin,conrelid) into strict installed from pg_constraint
    where conrelid='public.project_parameter_value_change_requests'::regclass and conname='project_parameter_value_change_requests_outcome_ck';
  changed:=replace(installed,'jsonb_array_length(applied_file_version_ids) = 2',
    $new$(jsonb_array_length(applied_file_version_ids)=2 or (source_revision_context ? 'sharedComposition'
      and jsonb_array_length(applied_file_version_ids)=jsonb_array_length(applied_source_result->'derivedSources')+1
      and jsonb_array_length(applied_source_result->'derivedSources') between 1 and 128))$new$);
  if changed=installed then raise exception 'Shared source version count marker unavailable'; end if;
  alter table public.project_parameter_value_change_requests drop constraint project_parameter_value_change_requests_outcome_ck;
  execute format('alter table public.project_parameter_value_change_requests add constraint project_parameter_value_change_requests_outcome_ck check (%s)',changed);
  select pg_get_functiondef('parameter_catalog.assert_member_addition_receipt()'::regprocedure) into strict installed;
  changed:=replace(installed,$old$case when member.file_id=result->>'fileId' then result->>'fileVersionId'$old$,
    $new$case when r.source_revision_context ? 'sharedComposition' and exists(select 1 from jsonb_array_elements(result->'derivedSources') derived where derived->>'fileId'=member.file_id)
      then (select derived->>'fileVersionId' from jsonb_array_elements(result->'derivedSources') derived where derived->>'fileId'=member.file_id)
      when member.file_id=result->>'fileId' then result->>'fileVersionId'$new$);
  if changed=installed then raise exception 'Shared composition version map marker unavailable'; end if;
  changed:=replace(changed,$old$result := r.applied_source_result;$old$,$new$result := r.applied_source_result;
  if r.source_revision_context ? 'sharedComposition' and (
    jsonb_typeof(result->'derivedSources') is distinct from 'array'
    or jsonb_array_length(result->'derivedSources') is distinct from
      (select sum(jsonb_array_length(resource->'sources')) from jsonb_array_elements(r.source_revision_context->'sharedComposition') resource)
    or (select count(distinct derived->>'fileId') from jsonb_array_elements(result->'derivedSources') derived)<>jsonb_array_length(result->'derivedSources')
    or jsonb_array_length(r.applied_file_version_ids)<>jsonb_array_length(result->'derivedSources')+1
    or not r.applied_file_version_ids @> jsonb_build_array(result->>'rootFileVersionId')
    or exists(select 1 from jsonb_array_elements(result->'derivedSources') derived
      where derived->>'fileId'=r.source_revision_context->'rootEdit'->>'fileId'
        or not r.applied_file_version_ids @> jsonb_build_array(derived->>'fileVersionId')
        or not exists(select 1 from jsonb_array_elements(r.source_revision_context->'sharedComposition') resource,
          jsonb_array_elements(resource->'sources') source,
          public.project_shared_dtsi_references ref
          join public.shared_dtsi_revisions upstream on upstream.id=ref.revision_id
          join public.project_shared_dtsi_snapshots snapshot on snapshot.reference_id=ref.id
          join public.project_parameter_file_versions version on version.id=snapshot.file_version_id and version.file_id=snapshot.file_id
          join public.shared_dtsi_revision_members member on member.revision_id=snapshot.revision_id and member.member_id=snapshot.member_id
          where source->>'fileId'=derived->>'fileId' and snapshot.file_id=derived->>'fileId' and snapshot.file_version_id=derived->>'fileVersionId'
            and snapshot.member_id=source->>'memberId' and ref.organization_id=r.organization_id and ref.project_id=r.project_id
            and ref.config_set_id=r.source_revision_config_set_id and ref.resource_id=resource->>'resourceId' and ref.revision_id=resource->>'versionId'
            and ref.mount_path=resource->>'mountPath' and ref.is_direct=(resource->>'direct')::boolean and upstream.digest=resource->>'digest'
            and version.checksum=member.checksum and version.size_bytes=member.size_bytes
            and source->>'sourceName'=case when ref.mount_path='' then member.source_name else ref.mount_path||'/'||member.source_name end))
  ) then raise exception using errcode='23514',message='Shared dependency composition has no exact complete derived source receipt'; end if;$new$);
  execute changed;
end $$;
