-- A removed shared member has no member row in the successor revision. Present
-- pins retain the same composite FK; absence pins use the exact deferred proof.
alter table parameter_catalog.project_value_source_pins
  add column member_config_revision_id text generated always as
    (case when locator->>'kind'='dts-source-absence' then null else config_revision_id end) stored;
alter table parameter_catalog.project_value_source_pins drop constraint project_value_source_pin_revision_member_fk;
alter table parameter_catalog.project_value_source_pins add constraint project_value_source_pin_revision_member_fk
  foreign key(member_config_revision_id,file_id,file_version_id)
  references public.dts_config_revision_members(config_revision_id,file_id,file_version_id) on delete restrict;

do $$ declare installed text; changed text; begin
  select pg_get_functiondef('parameter_catalog.valid_source_revision_absence_pin(text)'::regprocedure) into strict installed;
  changed:=replace(installed,'join public.dts_config_revision_members member on member.config_revision_id=pin.config_revision_id',
    'left join public.dts_config_revision_members member on member.config_revision_id=pin.config_revision_id');
  if changed=installed then raise exception 'Exact absence member marker unavailable'; end if;
  changed:=replace(changed,$old$where pin.id=pin_id and pin.format='dts'$old$,$new$where pin.id=pin_id
    and (member.config_revision_id is not null or (
      request.request_kind='member_addition' and request.source_revision_context ? 'sharedRemoval'
      and request.source_revision_application_mode='administrator_direct'
      and pin.file_version_id=base_pin.file_version_id
      and exists(select 1 from public.dts_config_revision_members before_member
        where before_member.config_revision_id=base_pin.config_revision_id
          and before_member.file_id=pin.file_id and before_member.file_version_id=base_pin.file_version_id
          and before_member.shared_reference is not null
          and request.source_revision_context->'sharedSwitch'->'beforeSources' @> jsonb_build_array(jsonb_build_object(
            'fileId',pin.file_id,'fileVersionId',pin.file_version_id,'memberId',before_member.shared_reference->>'memberId')))
      and not exists(select 1 from public.dts_config_revision_members after_member
        where after_member.config_revision_id=pin.config_revision_id and after_member.file_id=pin.file_id)
      and not exists(select 1 from public.dts_occurrence_effects effect
        join public.dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
          and logical.config_revision_id=effect.config_revision_id and logical.logical_node_id=occurrence.logical_node_id
        where effect.config_revision_id=pin.config_revision_id and effect.property_name=definition.property_key
          and effect.effect_kind in('set','override')
          and not exists(select 1 from public.dts_occurrence_effects later
            where later.config_revision_id=effect.config_revision_id and later.logical_node_revision_id=effect.logical_node_revision_id
              and later.property_name=effect.property_name and later.source_order>effect.source_order))
    )) and pin.format='dts'$new$);
  if changed=installed then raise exception 'Exact absence scope marker unavailable'; end if;
  execute changed;

  select pg_get_functiondef('parameter_catalog.assert_member_addition_receipt()'::regprocedure) into strict installed;
  changed:=replace(installed,
    '(select sum(jsonb_array_length(resource->''sources'')) from jsonb_array_elements(r.source_revision_context->''sharedComposition'') resource)',
    '(select coalesce(sum(jsonb_array_length(resource->''sources'')),0) from jsonb_array_elements(r.source_revision_context->''sharedComposition'') resource)');
  if changed=installed then raise exception 'Complete shared composition count marker unavailable'; end if;
  execute changed;

  select pg_get_functiondef('public.apply_shared_dtsi_switch(text,jsonb)'::regprocedure) into strict installed;
  changed:=replace(installed,
    '(select sum(jsonb_array_length(value->''sources'')) from jsonb_array_elements(r.source_revision_context->''sharedComposition''))',
    '(select coalesce(sum(jsonb_array_length(value->''sources'')),0) from jsonb_array_elements(r.source_revision_context->''sharedComposition''))');
  if changed=installed then raise exception 'Complete switch source count marker unavailable'; end if;
  execute changed;

  select pg_get_functiondef('parameter_catalog.assert_removed_member_has_tombstone()'::regprocedure) into strict installed;
  changed:=regexp_replace(installed,E'\\mBEGIN\\M',$branch$begin
    if new.config_set_id is null and old.config_set_id is not null
      and (to_jsonb(new)-'config_set_id'-'updated_at')=(to_jsonb(old)-'config_set_id'-'updated_at')
      and exists(select 1 from public.project_parameter_value_change_requests request
        join public.audit_events audit on audit.id=request.applied_audit_ref
          and audit.organization_id=request.organization_id and audit.project_id=request.project_id
          and audit.action='value-change-applied' and audit.target_id=request.id
          and audit.metadata->'result'=request.applied_source_result
        where request.request_kind='member_addition' and request.status='approved'
          and request.source_revision_application_mode='administrator_direct'
          and request.organization_id=old.organization_id and request.project_id=old.project_id
          and request.source_revision_config_set_id=old.config_set_id
          and request.source_revision_context ? 'sharedRemoval'
          and request.source_revision_context->'sharedSwitch'->'beforeSources' @> jsonb_build_array(jsonb_build_object(
            'fileId',old.id,'fileVersionId',old.current_version_id))
          and not exists(select 1 from public.dts_config_revision_members member
            where member.config_revision_id=request.applied_source_result->>'configRevisionId' and member.file_id=old.id)
      ) then return null; end if;
  $branch$,'i');
  if changed=installed then raise exception 'Removed member proof owner unavailable'; end if;
  execute changed;
end $$;
