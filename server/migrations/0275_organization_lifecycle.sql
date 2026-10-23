alter table public.organizations add column status text not null default 'active' check(status in ('active','suspended'));
alter table public.organizations add column lifecycle_version bigint not null default 0;
alter table public.organizations add column suspended_at timestamptz;
alter table public.dts_reload_runs add column organization_lifecycle_version bigint not null default 0;

-- Fixed, documented ownership paths. Shared Catalog subjects/definitions/releases have no tenant gate.
create function public.lifecycle_organization(schema_name text, table_name text, value jsonb) returns text
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare organization_id text;
begin
  if table_name='organizations' and schema_name='public' then return value->>'id'; end if;
  if value ? 'organization_id' then return value->>'organization_id'; end if;
  if schema_name='parameter_catalog' and table_name in ('project_parameter_values','binding_history_events') then
    select b.organization_id into organization_id from parameter_catalog.project_parameter_bindings b where b.id=value->>'binding_id';
  elsif schema_name='parameter_catalog' and table_name='definition_proposal_revisions' then
    select p.organization_id into organization_id from parameter_catalog.definition_proposals p where p.id=value->>'proposal_id';
  elsif schema_name='public' then
    case table_name
    when 'project_parameter_file_versions' then select f.organization_id into organization_id from public.project_parameter_files f where f.id=value->>'file_id';
    when 'project_parameter_binding_revisions' then select b.organization_id into organization_id from public.project_parameter_bindings b where b.id=value->>'binding_id';
    when 'dts_config_revision_members','dts_logical_node_revisions','dts_node_occurrences','dts_occurrence_effects','dts_property_occurrences' then select r.organization_id into organization_id from public.dts_config_revisions r where r.id=value->>'config_revision_id';
    when 'dts_nodes' then select f.organization_id into organization_id from public.project_parameter_file_versions v join public.project_parameter_files f on f.id=v.file_id where v.id=value->>'file_version_id';
    when 'dts_properties' then select f.organization_id into organization_id from public.dts_nodes n join public.project_parameter_file_versions v on v.id=n.file_version_id join public.project_parameter_files f on f.id=v.file_id where n.id=value->>'node_id';
    when 'dts_phandle_refs' then select f.organization_id into organization_id from public.dts_properties p join public.dts_nodes n on n.id=p.node_id join public.project_parameter_file_versions v on v.id=n.file_version_id join public.project_parameter_files f on f.id=v.file_id where p.id=value->>'from_property_id';
    when 'dts_release_baseline_members' then select b.organization_id into organization_id from public.dts_release_baseline b where b.id=value->>'baseline_id';
    when 'dts_reload_run_targets' then select r.organization_id into organization_id from public.dts_reload_runs r where r.id=value->>'reload_run_id';
    when 'dts_validation_diagnostics' then select r.organization_id into organization_id from public.dts_validation_runs r where r.id=value->>'validation_run_id';
    when 'driver_registrations','node_type_definitions' then select a.organization_id into organization_id from public.attribution_subjects a where a.id=value->>'attribution_subject_id';
    when 'driver_schema_overlay_properties' then select s.organization_id into organization_id from public.driver_schema_overlays s where s.id=value->>'driver_schema_overlay_id';
    when 'driver_schema_versions','dts_property_specs' then select s.organization_id into organization_id from public.driver_schemas s where s.id=value->>'driver_schema_id';
    when 'parameter_spec_versions' then select s.organization_id into organization_id from public.parameter_specs s where s.id=value->>'parameter_spec_id';
    when 'parameter_spec_property_key_cutover_items' then select r.organization_id into organization_id from public.parameter_spec_property_key_cutover_runs r where r.id=value->>'run_id';
    when 'parameter_spec_version_cutover_items' then select r.organization_id into organization_id from public.parameter_spec_version_cutover_runs r where r.id=value->>'run_id';
    else raise exception 'Unregistered lifecycle ownership: %.%',schema_name,table_name;
    end case;
  else raise exception 'Unregistered lifecycle ownership: %.%',schema_name,table_name;
  end if;
  return organization_id;
end $$;
revoke all on function public.lifecycle_organization(text,text,jsonb) from public;

create function public.guard_organization_lifecycle() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare old_value jsonb; new_value jsonb; org text; state text; completion jsonb;
begin
  if tg_table_name='dts_reload_runs' and tg_op='INSERT' then
    select lifecycle_version into new.organization_lifecycle_version from public.organizations where id=new.organization_id for share;
  end if;
  if tg_op <> 'INSERT' then old_value=to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_value=to_jsonb(new); end if;
  if tg_table_name='organizations' and tg_op='INSERT' then return new; end if;
  -- Personal profile and access revocation remain usable while business is read-only.
  if tg_table_name='users' and tg_op='UPDATE' and
    old_value - array['name','title','email','external_tokens_revoked_at','last_active_at'] = new_value - array['name','title','email','external_tokens_revoked_at','last_active_at'] then return new; end if;
  -- Lifecycle transitions themselves have a platform-only audited service entry.
  if tg_table_name='organizations' and tg_op='UPDATE' and old_value - array['status','lifecycle_version','suspended_at'] = new_value - array['status','lifecycle_version','suspended_at'] then return new; end if;
  completion=nullif(current_setting('wiseeff.lifecycle_completion',true),'')::jsonb;
  for org in select distinct id from unnest(array[
    case when old_value is not null then public.lifecycle_organization(tg_table_schema,tg_table_name,old_value) end,
    case when new_value is not null then public.lifecycle_organization(tg_table_schema,tg_table_name,new_value) end]) id where id is not null order by id
  loop
    select status into state from public.organizations where id=org for share;
    if state='active' then continue; end if;
    if current_setting('wiseeff.lifecycle_maintenance_org',true)=org and tg_table_name=any(array[
      'users','user_role_bindings','organization_team_members','project_members','parameter_drafts','project_parameter_value_drafts',
      'project_parameter_file_candidates','project_parameter_initialization_drafts','project_parameter_value_change_requests','parameter_change_requests',
      'knowledge_entries','knowledge_import_batches','knowledge_import_documents','product_feedback']) then continue; end if;
    if completion->>'organizationId'=org then
      if completion->>'kind'='dry-run' and (
        (tg_table_name='log_skill_dry_runs' and tg_op='UPDATE' and new_value->>'id'=completion->>'id') or
        (tg_table_name='log_analysis_trace_steps' and coalesce(new_value,old_value)->>'dry_run_id'=completion->>'id')) then continue; end if;
      if completion->>'kind'='analysis-cases' and tg_table_name='log_skill_analysis_case_runs' and tg_op='UPDATE' and new_value->>'id'=completion->>'id' then continue; end if;
      if completion->>'kind'='reload-device' and (
        (tg_table_name='dts_reload_runs' and tg_op='UPDATE' and new_value->>'id'=completion->>'runId') or
        (tg_table_name='dts_reload_device_residue' and coalesce(new_value,old_value)->>'device_id'=completion->>'deviceId') or
        (tg_table_name='debugging_devices' and coalesce(new_value,old_value)->>'id'=completion->>'deviceId') or
        (tg_table_name=any(array['debug_device_leases','debugging_sessions']) and coalesce(new_value,old_value)->>'device_id'=completion->>'deviceId')) then continue; end if;
      if completion->>'kind'='knowledge-index' and (
        (tg_table_name='knowledge_chunks' and coalesce(new_value,old_value)->>'entry_id'=completion->>'entryId') or
        (tg_table_name='knowledge_index_status' and coalesce(new_value,old_value)->>'entry_id'=completion->>'entryId') or
        (tg_table_name='knowledge_entries' and tg_op='UPDATE' and new_value->>'id'=completion->>'entryId' and old_value-array['search_text','updated_at']=new_value-array['search_text','updated_at'])) then continue; end if;
      if completion->>'kind'='source-index' and (
        (tg_table_name='log_source_snapshots' and coalesce(new_value,old_value)->>'id'=completion->>'snapshotId') or
        (tg_table_name=any(array['log_source_files','log_source_chunks','log_source_statements']) and coalesce(new_value,old_value)->>'snapshot_id'=completion->>'snapshotId')) then continue; end if;
      if completion->>'kind'='log-analysis' and (
        (tg_table_name='jobs' and tg_op='UPDATE' and new_value->>'id'=completion->>'jobId') or
        (tg_table_name='log_analysis_runs' and tg_op='UPDATE' and new_value->>'id'=completion->>'runId') or
        (tg_table_name='log_records' and tg_op='UPDATE' and new_value->>'id'=completion->>'logId' and old_value-array['status','failure_reason','updated_at']=new_value-array['status','failure_reason','updated_at']) or
        (tg_table_name=any(array['log_analysis_reports','log_analysis_stages','log_analysis_trace_steps','log_evidence','log_webhook_outbox']) and coalesce(new_value,old_value)->>'run_id'=completion->>'runId') or
        (tg_table_name=any(array['log_files','log_artifact_objects']) and coalesce(new_value,old_value)->>'record_id'=completion->>'logId')) then continue; end if;
    end if;
    raise exception using errcode='55000',message='Organization is suspended',detail=org;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_organization_lifecycle() from public;

-- Enumerated business records only. Sessions, password credentials, notifications,
-- audit receipts and bridge heartbeats retain their independent access/retention rules.
do $$ declare target text; begin
  foreach target in array array[
    'public.organizations','public.users','public.user_role_bindings','public.local_registration_role_requests',
    'public.organization_invitations','public.organization_teams','public.organization_team_members','public.project_members',
    'public.projects','public.project_modules','public.project_parameter_bindings','public.project_parameter_values','public.project_parameter_binding_revisions',
    'public.project_parameter_files','public.project_parameter_file_versions','public.project_parameter_file_candidates',
    'public.project_parameter_initialization_drafts','public.project_parameter_initialization_reviews','public.project_parameter_value_drafts',
    'public.project_parameter_value_change_requests','public.project_parameter_value_change_targets','public.project_parameter_plane_archives',
    'public.parameter_drafts','public.parameter_draft_identity_invalidations','public.parameter_definitions','public.parameter_change_requests',
    'public.parameter_history_entries','public.parameter_import_batches','public.parameter_file_sync_conflicts','public.parameter_policy_targets',
    'public.parameter_review_decisions','public.parameter_submission_items','public.parameter_submission_rounds','public.parameter_modules',
    'public.parameter_module_mappings','public.parameter_module_dismissed_compatibles','public.parameter_specs','public.parameter_spec_versions',
    'public.parameter_spec_matcher_overrides','public.parameter_spec_review_tasks','public.parameter_spec_property_key_cutover_runs',
    'public.parameter_spec_property_key_cutover_items','public.parameter_spec_version_cutover_runs','public.parameter_spec_version_cutover_items',
    'public.parameter_definition_reconciliation_items','public.parameter_definition_reconciliation_runs','public.legacy_parameter_migration_evidence',
    'public.attribution_subjects','public.business_categories','public.driver_registrations','public.driver_registration_placements',
    'public.driver_schemas','public.driver_schema_versions','public.driver_schema_overlays','public.driver_schema_overlay_properties',
    'public.node_type_definitions','public.module_recognition_rules','public.identity_mapping_tasks',
    'public.dts_config_set','public.dts_config_revisions','public.dts_config_revision_members','public.dts_logical_nodes',
    'public.dts_logical_node_revisions','public.dts_node_occurrences','public.dts_nodes','public.dts_properties','public.dts_phandle_refs',
    'public.dts_property_occurrences','public.dts_occurrence_effects','public.dts_property_specs','public.dts_property_occurrence_spec_decisions',
    'public.dts_release_baseline','public.dts_release_baseline_members','public.dts_validation_runs','public.dts_validation_diagnostics',
    'public.dts_reload_runs','public.dts_reload_run_targets','public.dts_reload_device_residue','public.dts_reload_org_defaults','public.dts_sensitive_node_rules',
    'public.debug_device_leases','public.debug_node_bindings','public.debug_node_modules','public.debug_nodes','public.debugging_devices',
    'public.debugging_events','public.debugging_parameter_node_bindings','public.debugging_parameters','public.debugging_sessions',
    'public.debugging_snapshots','public.debugging_targets','public.node_operations','public.device_bridge_pairing_codes',
    'public.agent_approvals','public.agent_messages','public.agent_run_traces','public.agent_sessions','public.agent_tool_calls',
    'public.knowledge_entries','public.knowledge_revisions','public.knowledge_files','public.knowledge_chunks','public.knowledge_index_status',
    'public.knowledge_definition_references','public.knowledge_parameter_references','public.knowledge_reference_suggestions',
    'public.knowledge_import_batches','public.knowledge_import_documents','public.jobs','public.log_records','public.log_files','public.log_file_objects',
    'public.log_original_uploads','public.log_artifact_objects','public.log_analysis_runs','public.log_analysis_reports','public.log_analysis_stages',
    'public.log_analysis_trace_steps','public.log_evidence','public.log_feedback','public.log_domains','public.log_domain_knowledge_links',
    'public.log_integration_credentials','public.log_skill_revisions','public.log_skill_samples','public.log_skill_dry_runs','public.log_skill_analysis_cases',
    'public.log_skill_analysis_case_runs','public.log_skill_artifact_objects','public.log_skill_deletions',
    'public.log_source_snapshots','public.log_source_files','public.log_source_chunks','public.log_source_statements','public.log_webhook_outbox','public.log_webhook_deliveries',
    'public.product_feedback','public.product_feedback_attachment_uploads','public.product_feedback_attachments','public.product_feedback_progress_events','public.product_feedback_attachment_deletions',
    'parameter_catalog.definition_proposals','parameter_catalog.definition_proposal_revisions','parameter_catalog.governance_command_idempotency',
    'parameter_catalog.organization_subject_registrations','parameter_catalog.subject_placements','parameter_catalog.parameter_observations',
    'parameter_catalog.parameter_observation_matches','parameter_catalog.parameter_review_items','parameter_catalog.parameter_review_evidence',
    'parameter_catalog.project_parameter_bindings','parameter_catalog.project_parameter_values','parameter_catalog.project_parameter_source_occurrences',
    'parameter_catalog.project_value_source_pins','parameter_catalog.project_source_member_tombstones','parameter_catalog.binding_history_events'
  ] loop execute format('create trigger organization_lifecycle_guard before insert or update or delete on %s for each row execute function public.guard_organization_lifecycle()',target); end loop;
end $$;

-- Preserve the existing column-only offline authentication reader.
do $$ begin if exists(select 1 from pg_roles where rolname='wiseeff_mod_d02_source_reader') then
  grant select(status) on public.organizations to wiseeff_mod_d02_source_reader;
end if; end $$;
