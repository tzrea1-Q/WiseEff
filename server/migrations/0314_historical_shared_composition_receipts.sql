-- 0243 rechecks approved receipts after actor FK detachment against historical
-- pins. Later shared-source checks must likewise accept their exact immutable
-- applied manifest, while initial approval still requires current references.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('parameter_catalog.assert_member_addition_receipt()'::regprocedure) into strict installed;
  changed:=replace(installed,
    $old$and ref.revision_id=r.source_revision_context->'sharedReference'->>'versionId'
  ) then raise exception using errcode='23514',message='Shared reference has no exact root/source receipt';$old$,
    $new$and ref.revision_id=r.source_revision_context->'sharedReference'->>'versionId'
    union all
    select 1 from public.dts_config_revisions revision
    join public.dts_config_revision_members saved on saved.config_revision_id=revision.id
      and saved.file_id=result->>'fileId' and saved.file_version_id=result->>'fileVersionId'
    join public.shared_dtsi_revisions upstream on upstream.id=saved.shared_reference->>'versionId'
      and upstream.organization_id=revision.organization_id and upstream.resource_id=saved.shared_reference->>'resourceId'
      and upstream.digest=saved.shared_reference->>'digest'
    join public.shared_dtsi_revision_members member on member.revision_id=upstream.id and member.member_id=saved.shared_reference->>'memberId'
    join public.project_parameter_file_versions saved_version on saved_version.id=saved.file_version_id and saved_version.file_id=saved.file_id
      and regexp_replace(saved_version.checksum,'^sha256:','')=regexp_replace(member.checksum,'^sha256:','') and saved_version.size_bytes=member.size_bytes
    join public.dts_config_revision_members root on root.config_revision_id=revision.id
      and root.file_id=r.source_revision_context->'rootEdit'->>'fileId' and root.file_version_id=result->>'rootFileVersionId' and root.role='base'
    join public.project_parameter_file_versions after_version on after_version.id=root.file_version_id and after_version.file_id=root.file_id
      and regexp_replace(after_version.checksum,'^sha256:','')=encode(sha256(convert_to(r.source_revision_context->'rootEdit'->>'after','UTF8')),'hex')
    join public.project_parameter_file_versions before_version on before_version.id=r.source_revision_context->'rootEdit'->>'baseFileVersionId'
      and before_version.file_id=root.file_id
      and regexp_replace(before_version.checksum,'^sha256:','')=encode(sha256(convert_to(r.source_revision_context->'rootEdit'->>'before','UTF8')),'hex')
    where historical_receipt and revision.id=result->>'configRevisionId' and revision.organization_id=r.organization_id
      and revision.project_id=r.project_id and revision.config_set_id=r.source_revision_config_set_id
      and saved.shared_reference->>'readOnly'='true'
      and saved.shared_reference->>'memberId'=r.source_revision_context->'sharedReference'->>'memberId'
      and upstream.resource_id=r.source_revision_context->'sharedReference'->>'resourceId'
      and upstream.id=r.source_revision_context->'sharedReference'->>'versionId'
      and upstream.digest=r.source_revision_context->'sharedReference'->>'digest'
      and ((not r.source_revision_context ? 'sharedComposition' and saved.source_name=member.source_name)
        or exists(select 1 from jsonb_array_elements(r.source_revision_context->'sharedComposition') resource,
          jsonb_array_elements(resource->'sources') source where resource->>'resourceId'=upstream.resource_id
          and resource->>'versionId'=upstream.id and resource->>'digest'=upstream.digest
          and source->>'fileId'=saved.file_id and source->>'memberId'=member.member_id and source->>'sourceName'=saved.source_name
          and saved.source_name=case when resource->>'mountPath'='' then member.source_name else (resource->>'mountPath')||'/'||member.source_name end))
  ) then raise exception using errcode='23514',message='Shared reference has no exact root/source receipt';$new$);
  if changed=installed then raise exception 'Historical shared root receipt marker unavailable'; end if;
  installed:=changed;
  changed:=replace(installed,
    $old$and source->>'sourceName'=case when ref.mount_path='' then member.source_name else ref.mount_path||'/'||member.source_name end))
  ) then raise exception using errcode='23514',message='Shared dependency composition has no exact complete derived source receipt';$old$,
    $new$and source->>'sourceName'=case when ref.mount_path='' then member.source_name else ref.mount_path||'/'||member.source_name end
        union all
        select 1 from jsonb_array_elements(r.source_revision_context->'sharedComposition') resource,
          jsonb_array_elements(resource->'sources') source,
          public.dts_config_revisions revision
          join public.dts_config_revision_members saved on saved.config_revision_id=revision.id
          join public.project_parameter_file_versions version on version.id=saved.file_version_id and version.file_id=saved.file_id
          join public.shared_dtsi_revisions upstream on upstream.id=saved.shared_reference->>'versionId'
            and upstream.organization_id=revision.organization_id and upstream.resource_id=saved.shared_reference->>'resourceId'
            and upstream.digest=saved.shared_reference->>'digest'
          join public.shared_dtsi_revision_members member on member.revision_id=upstream.id and member.member_id=saved.shared_reference->>'memberId'
        where historical_receipt and revision.id=result->>'configRevisionId' and revision.organization_id=r.organization_id
          and revision.project_id=r.project_id and revision.config_set_id=r.source_revision_config_set_id
          and saved.file_id=derived->>'fileId' and saved.file_version_id=derived->>'fileVersionId'
          and saved.shared_reference->>'readOnly'='true' and source->>'fileId'=saved.file_id
          and source->>'memberId'=member.member_id and source->>'sourceName'=saved.source_name
          and upstream.resource_id=resource->>'resourceId' and upstream.id=resource->>'versionId' and upstream.digest=resource->>'digest'
          and version.checksum=member.checksum and version.size_bytes=member.size_bytes
          and saved.source_name=case when resource->>'mountPath'='' then member.source_name else (resource->>'mountPath')||'/'||member.source_name end))
  ) then raise exception using errcode='23514',message='Shared dependency composition has no exact complete derived source receipt';$new$);
  if changed=installed then raise exception 'Historical shared composition receipt marker unavailable'; end if;
  installed:=changed;
  changed:=replace(installed,
    $old$and upstream.manifest->'sourceEvidence'->>'digest'=r.source_revision_context->'sharedConversion'->>'sourceEvidence')$old$,
    $new$and upstream.manifest->'sourceEvidence'->>'digest'=r.source_revision_context->'sharedConversion'->>'sourceEvidence'
      union all
      select 1 from public.dts_config_revisions revision
      join public.dts_config_revision_members saved on saved.config_revision_id=revision.id
        and saved.file_id=result->>'fileId' and saved.file_version_id=result->>'fileVersionId'
      join public.shared_dtsi_revisions upstream on upstream.id=saved.shared_reference->>'versionId'
        and upstream.organization_id=revision.organization_id and upstream.resource_id=saved.shared_reference->>'resourceId'
        and upstream.digest=saved.shared_reference->>'digest'
      join public.audit_events origin on origin.organization_id=r.organization_id and origin.kind='shared-dtsi-project-source' and origin.action='import'
        and origin.target_type='shared-dtsi-resource' and origin.target_id=upstream.resource_id and origin.actor_type='user'
        and origin.metadata->'evidence'->>'digest'=upstream.manifest->'sourceEvidence'->>'digest'
      where historical_receipt and revision.id=result->>'configRevisionId' and revision.organization_id=r.organization_id
        and revision.project_id=r.project_id and revision.config_set_id=r.source_revision_config_set_id
        and saved.shared_reference->>'readOnly'='true'
        and saved.shared_reference->>'memberId'=r.source_revision_context->'sharedReference'->>'memberId'
        and upstream.resource_id=r.source_revision_context->'sharedReference'->>'resourceId'
        and upstream.id=r.source_revision_context->'sharedReference'->>'versionId'
        and upstream.digest=r.source_revision_context->'sharedReference'->>'digest'
        and upstream.manifest->'sourceEvidence'->>'digest'=r.source_revision_context->'sharedConversion'->>'sourceEvidence')$new$);
  if changed=installed then raise exception 'Historical private conversion origin marker unavailable'; end if;
  installed:=changed;
  changed:=replace(installed,
    $old$and regexp_replace(version.checksum,'^sha256:','')=regexp_replace(member.checksum,'^sha256:','') and version.size_bytes=member.size_bytes))
  ) then raise exception using errcode='23514',message='Private conversion has no complete unchanged source receipt';$old$,
    $new$and regexp_replace(version.checksum,'^sha256:','')=regexp_replace(member.checksum,'^sha256:','') and version.size_bytes=member.size_bytes
        union all
        select 1 from jsonb_array_elements(r.source_revision_context->'sharedConversion'->'files') pair,
          jsonb_array_elements(result->'derivedSources') derived,
          public.dts_config_revisions revision
          join public.dts_config_revision_members saved on saved.config_revision_id=revision.id
          join public.shared_dtsi_revisions upstream on upstream.id=saved.shared_reference->>'versionId'
            and upstream.organization_id=revision.organization_id and upstream.resource_id=saved.shared_reference->>'resourceId'
            and upstream.digest=saved.shared_reference->>'digest'
          join public.shared_dtsi_revision_members member on member.revision_id=upstream.id and member.member_id=saved.shared_reference->>'memberId'
          join public.project_parameter_file_versions version on version.id=saved.file_version_id and version.file_id=saved.file_id
          join public.dts_config_revision_members before_member on before_member.config_revision_id=r.source_revision_context->>'baseConfigRevisionId'
            and before_member.file_id=saved.file_id and before_member.file_version_id=saved.file_version_id and before_member.shared_reference is null
        where historical_receipt and revision.id=result->>'configRevisionId' and revision.organization_id=r.organization_id
          and revision.project_id=r.project_id and revision.config_set_id=r.source_revision_config_set_id
          and saved.shared_reference->>'readOnly'='true'
          and pair->>'fileId'=source->>'fileId' and pair->>'memberId'=source->>'memberId'
          and pair->>'resourceId'=resource->>'resourceId' and pair->>'versionId'=resource->>'versionId'
          and pair->>'fileVersionId'=saved.file_version_id and pair->>'sourceName'=before_member.source_name
          and pair->>'role'=before_member.role and (pair->>'sortOrder')::integer=before_member.sort_order
          and derived->>'fileId'=saved.file_id and derived->>'fileVersionId'=saved.file_version_id
          and r.applied_file_version_ids ? saved.file_version_id
          and upstream.resource_id=resource->>'resourceId' and upstream.id=resource->>'versionId' and upstream.digest=resource->>'digest'
          and saved.file_id=source->>'fileId' and member.member_id=source->>'memberId'
          and source->>'sourceName'=saved.source_name
          and saved.source_name=case when resource->>'mountPath'='' then member.source_name else (resource->>'mountPath')||'/'||member.source_name end
          and regexp_replace(version.checksum,'^sha256:','')=regexp_replace(member.checksum,'^sha256:','') and version.size_bytes=member.size_bytes))
  ) then raise exception using errcode='23514',message='Private conversion has no complete unchanged source receipt';$new$);
  if changed=installed then raise exception 'Historical private conversion members marker unavailable'; end if;
  execute changed;
end $$;
