-- Reuse the exact pending administrator receipt and immutable published-byte
-- derivation used by version switching. Historical manifests remain untouched.
do $$ declare installed text; changed text; routine text; begin
  select pg_get_functiondef('public.shared_dtsi_switch_allows_change(text,jsonb,jsonb,text)'::regprocedure) into strict installed;
  changed:=replace(installed,$old$request.request_kind='member_addition'$old$,
    $new$(request.request_kind='member_addition' or request.request_kind='configuration_restore'
      and proof->>'kind'='configuration_restore'
      and exists(select 1 from public.dts_config_revisions historical
        where historical.id=proof->>'snapshotConfigRevisionId' and historical.status='resolved'
          and historical.organization_id=request.organization_id and historical.project_id=request.project_id
          and historical.config_set_id=request.source_revision_config_set_id)
      and not exists(select 1 from jsonb_array_elements(proof->'sharedComposition') resource,
        jsonb_array_elements(resource->'sources') source
        where not exists(select 1 from public.dts_config_revision_members member
          join public.dts_config_revisions revision on revision.id=member.config_revision_id
          where revision.id in(proof->>'snapshotConfigRevisionId',proof->>'baseConfigRevisionId')
            and revision.organization_id=request.organization_id and revision.project_id=request.project_id
            and revision.config_set_id=request.source_revision_config_set_id
            and member.file_id=source->>'fileId' and member.file_version_id=source->>'fileVersionId'
            and member.source_name=source->>'sourceName' and member.shared_reference->>'memberId'=source->>'memberId'
            and member.shared_reference->>'resourceId'=resource->>'resourceId'
            and member.shared_reference->>'versionId'=resource->>'versionId'
            and member.shared_reference->>'digest'=resource->>'digest')))$new$);
  if changed=installed then raise exception 'Shared switch receipt marker unavailable'; end if;
  execute changed;
  foreach routine in array array['public.derive_shared_dtsi_switch_version(text,text,text,text)','public.apply_shared_dtsi_switch(text,jsonb)'] loop
    select pg_get_functiondef(routine::regprocedure) into strict installed;
    changed:=replace(installed,$old$r.request_kind<>'member_addition'$old$,$new$r.request_kind not in('member_addition','configuration_restore')$new$);
    if changed=installed then raise exception 'Shared switch operation marker unavailable'; end if;
    execute changed;
  end loop;
end $$;
