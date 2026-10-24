-- Counts-only Organization erasure preview. This is an explicit ownership inventory,
-- never a deletion plan or a grant to read private Catalog payloads.
grant select on public.agent_approvals,public.agent_messages,public.agent_run_traces,public.agent_sessions,public.agent_tool_calls,public.attribution_subjects,public.audit_events,public.auth_sessions,public.business_categories,public.debug_device_leases,public.debug_node_bindings,public.debug_node_modules,public.debug_nodes,public.debugging_devices,public.debugging_events,public.debugging_parameter_node_bindings,public.debugging_parameters,public.debugging_sessions,public.debugging_snapshots,public.debugging_targets,public.device_bridge_pairing_codes,public.device_bridges,public.driver_registration_placements,public.driver_schema_overlays,public.driver_schemas,public.dts_config_revisions,public.dts_config_set,public.dts_logical_nodes,public.dts_property_occurrence_spec_decisions,public.dts_release_baseline,public.dts_reload_device_residue,public.dts_reload_org_defaults,public.dts_reload_runs,public.dts_sensitive_node_rules,public.dts_validation_runs,public.identity_mapping_tasks,public.jobs,public.knowledge_chunks,public.knowledge_definition_references,public.knowledge_entries,public.knowledge_files,public.knowledge_import_batches,public.knowledge_import_documents,public.knowledge_index_status,public.knowledge_parameter_references,public.knowledge_reference_suggestions,public.knowledge_revisions,public.legacy_parameter_migration_evidence,public.local_registration_role_requests,public.log_analysis_reports,public.log_analysis_runs,public.log_analysis_stages,public.log_analysis_trace_steps,public.log_artifact_objects,public.log_domain_knowledge_links,public.log_domains,public.log_evidence,public.log_feedback,public.log_file_objects,public.log_files,public.log_integration_credentials,public.log_original_uploads,public.log_records,public.log_skill_analysis_case_runs,public.log_skill_analysis_cases,public.log_skill_artifact_objects,public.log_skill_deletions,public.log_skill_dry_runs,public.log_skill_revisions,public.log_skill_samples,public.log_source_chunks,public.log_source_files,public.log_source_snapshots,public.log_source_statements,public.log_webhook_deliveries,public.log_webhook_outbox,public.module_recognition_rules,public.node_operations,public.notification_outbox,public.organization_invitations,public.organization_team_members,public.organization_teams,public.parameter_change_requests,public.parameter_definition_reconciliation_items,public.parameter_definition_reconciliation_runs,public.parameter_definitions,public.parameter_draft_identity_invalidations,public.parameter_drafts,public.parameter_file_sync_conflicts,public.parameter_history_entries,public.parameter_import_batches,public.parameter_module_dismissed_compatibles,public.parameter_module_mappings,public.parameter_modules,public.parameter_policy_targets,public.parameter_review_decisions,public.parameter_spec_matcher_overrides,public.parameter_spec_property_key_cutover_runs,public.parameter_spec_review_tasks,public.parameter_spec_version_cutover_runs,public.parameter_specs,public.parameter_submission_items,public.parameter_submission_rounds,public.product_feedback,public.product_feedback_attachment_deletions,public.product_feedback_attachment_uploads,public.product_feedback_attachments,public.product_feedback_progress_events,public.project_members,public.project_modules,public.project_parameter_bindings,public.project_parameter_file_candidates,public.project_parameter_files,public.project_parameter_initialization_drafts,public.project_parameter_initialization_reviews,public.project_parameter_plane_archives,public.project_parameter_value_change_requests,public.project_parameter_value_change_targets,public.project_parameter_value_drafts,public.project_parameter_values,public.projects,public.seed_initialization_runs,public.user_notifications,public.user_oidc_identities,public.user_role_bindings,public.users,public.user_password_credentials,public.device_bridge_tokens,public.audit_subject_links,public.dts_config_revision_members,public.dts_logical_node_revisions,public.dts_node_occurrences,public.dts_occurrence_effects,public.dts_property_occurrences,public.project_parameter_file_versions,public.project_parameter_binding_revisions,public.dts_nodes,public.dts_properties,public.dts_phandle_refs,public.dts_release_baseline_members,public.dts_reload_run_targets,public.dts_validation_diagnostics,public.driver_registrations,public.node_type_definitions,public.driver_schema_overlay_properties,public.driver_schema_versions,public.dts_property_specs,public.parameter_spec_versions,public.parameter_spec_property_key_cutover_items,public.parameter_spec_version_cutover_items,public.driver_schema_overlay_promotions to catalog_migration_owner;

grant select on public.roles to catalog_migration_owner;

create function parameter_catalog.preview_organization_deletion(p_org text,p_actor text)
returns table(key text,category text,item_count bigint,state_digest text)
language plpgsql stable security definer set search_path=pg_catalog,parameter_catalog,public as $$
declare target record; relation text; known text[]:='{}';
begin
 if not exists(select 1 from public.users u join public.user_role_bindings b on b.user_id=u.id and b.organization_id=u.organization_id
   where u.id=p_actor and u.is_active and b.project_id is null and b.role_id='platform-admin'
   and exists(select 1 from public.roles where id=b.role_id and 'platform:access'=any(permissions)))
 then raise exception using errcode='42501',message='Current platform super administrator is required'; end if;
 if not exists(select 1 from public.organizations where id=p_org) then raise exception using errcode='P0002',message='Organization was not found'; end if;
 for target in select * from (values
    ('parameter_catalog.definition_erasures','shared-references','r.organization_id=$1'),
    ('parameter_catalog.definition_proposals','catalog','r.organization_id=$1'),
    ('parameter_catalog.definition_replacement_previews','catalog','r.organization_id=$1'),
    ('parameter_catalog.definition_replacement_projects','catalog','r.organization_id=$1'),
    ('parameter_catalog.definition_replacements','catalog','r.organization_id=$1'),
    ('parameter_catalog.governance_command_idempotency','catalog','r.organization_id=$1'),
    ('parameter_catalog.log_erasures','catalog','r.organization_id=$1'),
    ('parameter_catalog.organization_subject_registrations','catalog','r.organization_id=$1'),
    ('parameter_catalog.parameter_observation_matches','catalog','r.organization_id=$1'),
    ('parameter_catalog.parameter_observations','catalog','r.organization_id=$1'),
    ('parameter_catalog.parameter_review_evidence','catalog','r.organization_id=$1'),
    ('parameter_catalog.parameter_review_items','catalog','r.organization_id=$1'),
    ('parameter_catalog.plane_disposal_runs','catalog','r.organization_id=$1'),
    ('parameter_catalog.project_erasures','catalog','r.organization_id=$1'),
    ('parameter_catalog.project_parameter_bindings','catalog','r.organization_id=$1'),
    ('parameter_catalog.project_parameter_source_occurrences','catalog','r.organization_id=$1'),
    ('parameter_catalog.project_source_member_tombstones','catalog','r.organization_id=$1'),
    ('parameter_catalog.project_value_source_pins','catalog','r.organization_id=$1'),
    ('parameter_catalog.subject_placements','catalog','r.organization_id=$1'),
    ('public.agent_approvals','agent','r.organization_id=$1'),
    ('public.agent_messages','agent','r.organization_id=$1'),
    ('public.agent_run_traces','agent','r.organization_id=$1'),
    ('public.agent_sessions','agent','r.organization_id=$1'),
    ('public.agent_tool_calls','agent','r.organization_id=$1'),
    ('public.attribution_subjects','organization-parameters','r.organization_id=$1'),
    ('public.audit_events','audit','r.organization_id=$1 or (r.organization_id is null and (r.target_type=''organization'' and r.target_id=$1 or r.metadata->>''operatingOrganizationId''=$1))'),
    ('public.auth_sessions','accounts','r.organization_id=$1'),
    ('public.business_categories','organization-parameters','r.organization_id=$1'),
    ('public.debug_device_leases','devices','r.organization_id=$1'),
    ('public.debug_node_bindings','devices','r.organization_id=$1'),
    ('public.debug_node_modules','devices','r.organization_id=$1'),
    ('public.debug_nodes','devices','r.organization_id=$1'),
    ('public.debugging_devices','devices','r.organization_id=$1'),
    ('public.debugging_events','devices','r.organization_id=$1'),
    ('public.debugging_parameter_node_bindings','devices','r.organization_id=$1'),
    ('public.debugging_parameters','devices','r.organization_id=$1'),
    ('public.debugging_sessions','devices','r.organization_id=$1'),
    ('public.debugging_snapshots','devices','r.organization_id=$1'),
    ('public.debugging_targets','devices','r.organization_id=$1'),
    ('public.device_bridge_pairing_codes','devices','r.organization_id=$1'),
    ('public.device_bridges','devices','r.organization_id=$1'),
    ('public.driver_registration_placements','organization-parameters','r.organization_id=$1'),
    ('public.driver_schema_overlays','organization-parameters','r.organization_id=$1'),
    ('public.driver_schemas','organization-parameters','r.organization_id=$1'),
    ('public.dts_config_revisions','projects','r.organization_id=$1'),
    ('public.dts_config_set','projects','r.organization_id=$1'),
    ('public.dts_logical_nodes','projects','r.organization_id=$1'),
    ('public.dts_property_occurrence_spec_decisions','projects','r.organization_id=$1'),
    ('public.dts_release_baseline','projects','r.organization_id=$1'),
    ('public.dts_reload_device_residue','projects','r.organization_id=$1'),
    ('public.dts_reload_org_defaults','projects','r.organization_id=$1'),
    ('public.dts_reload_runs','projects','r.organization_id=$1'),
    ('public.dts_sensitive_node_rules','projects','r.organization_id=$1'),
    ('public.dts_validation_runs','projects','r.organization_id=$1'),
    ('public.identity_mapping_tasks','organization-parameters','r.organization_id=$1'),
    ('public.jobs','producers','r.organization_id=$1'),
    ('public.knowledge_chunks','knowledge','r.organization_id=$1'),
    ('public.knowledge_definition_references','knowledge','r.organization_id=$1'),
    ('public.knowledge_entries','knowledge','r.organization_id=$1'),
    ('public.knowledge_files','knowledge','r.organization_id=$1'),
    ('public.knowledge_import_batches','knowledge','r.organization_id=$1'),
    ('public.knowledge_import_documents','knowledge','r.organization_id=$1'),
    ('public.knowledge_index_status','knowledge','r.organization_id=$1'),
    ('public.knowledge_parameter_references','knowledge','r.organization_id=$1'),
    ('public.knowledge_reference_suggestions','knowledge','r.organization_id=$1'),
    ('public.knowledge_revisions','knowledge','r.organization_id=$1'),
    ('public.legacy_parameter_migration_evidence','organization-parameters','r.organization_id=$1'),
    ('public.local_registration_role_requests','accounts','r.organization_id=$1'),
    ('public.log_analysis_reports','logs','r.organization_id=$1'),
    ('public.log_analysis_runs','logs','r.organization_id=$1'),
    ('public.log_analysis_stages','logs','r.organization_id=$1'),
    ('public.log_analysis_trace_steps','logs','r.organization_id=$1'),
    ('public.log_artifact_objects','logs','r.organization_id=$1'),
    ('public.log_domain_knowledge_links','logs','r.organization_id=$1'),
    ('public.log_domains','logs','r.organization_id=$1'),
    ('public.log_evidence','logs','r.organization_id=$1'),
    ('public.log_feedback','logs','r.organization_id=$1'),
    ('public.log_file_objects','logs','r.organization_id=$1'),
    ('public.log_files','logs','r.organization_id=$1'),
    ('public.log_integration_credentials','logs','r.organization_id=$1'),
    ('public.log_original_uploads','logs','r.organization_id=$1'),
    ('public.log_records','logs','r.organization_id=$1'),
    ('public.log_skill_analysis_case_runs','logs','r.organization_id=$1'),
    ('public.log_skill_analysis_cases','logs','r.organization_id=$1'),
    ('public.log_skill_artifact_objects','logs','r.organization_id=$1'),
    ('public.log_skill_deletions','logs','r.organization_id=$1'),
    ('public.log_skill_dry_runs','logs','r.organization_id=$1'),
    ('public.log_skill_revisions','logs','r.organization_id=$1'),
    ('public.log_skill_samples','logs','r.organization_id=$1'),
    ('public.log_source_chunks','logs','r.organization_id=$1'),
    ('public.log_source_files','logs','r.organization_id=$1'),
    ('public.log_source_snapshots','logs','r.organization_id=$1'),
    ('public.log_source_statements','logs','r.organization_id=$1'),
    ('public.log_webhook_deliveries','logs','r.organization_id=$1'),
    ('public.log_webhook_outbox','logs','r.organization_id=$1'),
    ('public.module_recognition_rules','organization-parameters','r.organization_id=$1'),
    ('public.node_operations','devices','r.organization_id=$1'),
    ('public.notification_outbox','feedback-notifications','r.organization_id=$1 or r.payload->''metadata''->>''feedbackOrganizationId''=$1 or (r.payload->>''sourceKind''=''product-feedback'' and r.payload->>''sourceId'' in (select id::text from public.product_feedback where organization_id=$1))'),
    ('public.organization_invitations','teams-invitations','r.organization_id=$1'),
    ('public.organization_team_members','teams-invitations','r.organization_id=$1'),
    ('public.organization_teams','teams-invitations','r.organization_id=$1'),
    ('public.parameter_change_requests','organization-parameters','r.organization_id=$1'),
    ('public.parameter_definition_reconciliation_items','organization-parameters','r.organization_id=$1'),
    ('public.parameter_definition_reconciliation_runs','organization-parameters','r.organization_id=$1'),
    ('public.parameter_definitions','organization-parameters','r.organization_id=$1'),
    ('public.parameter_draft_identity_invalidations','organization-parameters','r.organization_id=$1'),
    ('public.parameter_drafts','organization-parameters','r.organization_id=$1'),
    ('public.parameter_file_sync_conflicts','organization-parameters','r.organization_id=$1'),
    ('public.parameter_history_entries','organization-parameters','r.organization_id=$1'),
    ('public.parameter_import_batches','organization-parameters','r.organization_id=$1'),
    ('public.parameter_module_dismissed_compatibles','organization-parameters','r.organization_id=$1'),
    ('public.parameter_module_mappings','organization-parameters','r.organization_id=$1'),
    ('public.parameter_modules','organization-parameters','r.organization_id=$1'),
    ('public.parameter_policy_targets','organization-parameters','r.organization_id=$1'),
    ('public.parameter_review_decisions','organization-parameters','r.organization_id=$1'),
    ('public.parameter_spec_matcher_overrides','organization-parameters','r.organization_id=$1'),
    ('public.parameter_spec_property_key_cutover_runs','organization-parameters','r.organization_id=$1'),
    ('public.parameter_spec_review_tasks','organization-parameters','r.organization_id=$1'),
    ('public.parameter_spec_version_cutover_runs','organization-parameters','r.organization_id=$1'),
    ('public.parameter_specs','organization-parameters','r.organization_id=$1'),
    ('public.parameter_submission_items','organization-parameters','r.organization_id=$1'),
    ('public.parameter_submission_rounds','organization-parameters','r.organization_id=$1'),
    ('public.product_feedback','feedback-notifications','r.organization_id=$1'),
    ('public.product_feedback_attachment_deletions','feedback-notifications','r.organization_id=$1'),
    ('public.product_feedback_attachment_uploads','feedback-notifications','r.organization_id=$1'),
    ('public.product_feedback_attachments','feedback-notifications','r.organization_id=$1'),
    ('public.product_feedback_progress_events','feedback-notifications','r.organization_id=$1'),
    ('public.project_members','projects','r.organization_id=$1'),
    ('public.project_modules','projects','r.organization_id=$1'),
    ('public.project_parameter_bindings','projects','r.organization_id=$1'),
    ('public.project_parameter_file_candidates','projects','r.organization_id=$1'),
    ('public.project_parameter_files','projects','r.organization_id=$1'),
    ('public.project_parameter_initialization_drafts','projects','r.organization_id=$1'),
    ('public.project_parameter_initialization_reviews','projects','r.organization_id=$1'),
    ('public.project_parameter_plane_archives','projects','r.organization_id=$1'),
    ('public.project_parameter_value_change_requests','projects','r.organization_id=$1'),
    ('public.project_parameter_value_change_targets','projects','r.organization_id=$1'),
    ('public.project_parameter_value_drafts','projects','r.organization_id=$1'),
    ('public.project_parameter_values','projects','r.organization_id=$1'),
    ('public.projects','projects','r.organization_id=$1'),
    ('public.seed_initialization_runs','organization-parameters','r.organization_id=$1'),
    ('public.user_notifications','feedback-notifications','r.organization_id=$1 or r.metadata->>''feedbackOrganizationId''=$1 or (r.source_kind=''product-feedback'' and r.source_id in (select id::text from public.product_feedback where organization_id=$1))'),
    ('public.user_oidc_identities','accounts','r.organization_id=$1'),
    ('public.user_role_bindings','accounts','r.organization_id=$1'),
    ('public.users','accounts','r.organization_id=$1'),
    ('public.user_password_credentials','accounts','r.user_id in (select id from public.users where organization_id=$1)'),
    ('public.device_bridge_tokens','devices','r.bridge_id in (select id from public.device_bridges where organization_id=$1)'),
    ('public.audit_subject_links','audit','r.audit_event_id in (select id from public.audit_events where organization_id=$1)'),
    ('public.dts_config_revision_members','projects','r.config_revision_id in (select id from public.dts_config_revisions where organization_id=$1)'),
    ('public.dts_logical_node_revisions','projects','r.config_revision_id in (select id from public.dts_config_revisions where organization_id=$1)'),
    ('public.dts_node_occurrences','projects','r.config_revision_id in (select id from public.dts_config_revisions where organization_id=$1)'),
    ('public.dts_occurrence_effects','projects','r.config_revision_id in (select id from public.dts_config_revisions where organization_id=$1)'),
    ('public.dts_property_occurrences','projects','r.config_revision_id in (select id from public.dts_config_revisions where organization_id=$1)'),
    ('public.project_parameter_file_versions','projects','r.file_id in (select id from public.project_parameter_files where organization_id=$1)'),
    ('public.project_parameter_binding_revisions','projects','r.binding_id in (select id from public.project_parameter_bindings where organization_id=$1)'),
    ('public.dts_nodes','projects','r.file_version_id in (select v.id from public.project_parameter_file_versions v join public.project_parameter_files f on f.id=v.file_id where f.organization_id=$1)'),
    ('public.dts_properties','projects','r.node_id in (select n.id from public.dts_nodes n join public.project_parameter_file_versions v on v.id=n.file_version_id join public.project_parameter_files f on f.id=v.file_id where f.organization_id=$1)'),
    ('public.dts_phandle_refs','projects','r.from_property_id in (select p.id from public.dts_properties p join public.dts_nodes n on n.id=p.node_id join public.project_parameter_file_versions v on v.id=n.file_version_id join public.project_parameter_files f on f.id=v.file_id where f.organization_id=$1)'),
    ('public.dts_release_baseline_members','projects','r.baseline_id in (select id from public.dts_release_baseline where organization_id=$1)'),
    ('public.dts_reload_run_targets','projects','r.reload_run_id in (select id from public.dts_reload_runs where organization_id=$1)'),
    ('public.dts_validation_diagnostics','projects','r.validation_run_id in (select id from public.dts_validation_runs where organization_id=$1)'),
    ('public.driver_registrations','organization-parameters','r.attribution_subject_id in (select id from public.attribution_subjects where organization_id=$1)'),
    ('public.node_type_definitions','organization-parameters','r.attribution_subject_id in (select id from public.attribution_subjects where organization_id=$1)'),
    ('public.driver_schema_overlay_properties','organization-parameters','r.driver_schema_overlay_id in (select id from public.driver_schema_overlays where organization_id=$1)'),
    ('public.driver_schema_versions','organization-parameters','r.driver_schema_id in (select id from public.driver_schemas where organization_id=$1)'),
    ('public.dts_property_specs','organization-parameters','r.driver_schema_id in (select id from public.driver_schemas where organization_id=$1)'),
    ('public.parameter_spec_versions','organization-parameters','r.parameter_spec_id in (select id from public.parameter_specs where organization_id=$1)'),
    ('public.parameter_spec_property_key_cutover_items','organization-parameters','r.run_id in (select id from public.parameter_spec_property_key_cutover_runs where organization_id=$1)'),
    ('public.parameter_spec_version_cutover_items','organization-parameters','r.run_id in (select id from public.parameter_spec_version_cutover_runs where organization_id=$1)'),
    ('public.driver_schema_overlay_promotions','shared-references','r.source_organization_id=$1'),
    ('parameter_catalog.project_parameter_values','catalog','r.binding_id in (select id from parameter_catalog.project_parameter_bindings where organization_id=$1)'),
    ('parameter_catalog.binding_history_events','catalog','r.binding_id in (select id from parameter_catalog.project_parameter_bindings where organization_id=$1)'),
    ('parameter_catalog.definition_proposal_revisions','catalog','r.proposal_id in (select id from parameter_catalog.definition_proposals where organization_id=$1)'),
    ('parameter_catalog.parameter_review_resolutions','catalog','r.review_item_id in (select id from parameter_catalog.parameter_review_items where organization_id=$1)'),
    ('parameter_catalog.legacy_identities','legacy-archives','((r.owner_scope_kind=''organization'' and r.owner_scope_id=$1) or (r.owner_scope_kind=''project'' and r.owner_scope_id in (select id from public.projects where organization_id=$1)))'),
    ('parameter_catalog.parameter_catalog_archives','legacy-archives','((r.owner_scope_kind=''organization'' and r.owner_scope_id=$1) or (r.owner_scope_kind=''project'' and r.owner_scope_id in (select id from public.projects where organization_id=$1)))'),
    ('parameter_catalog.legacy_mapping_heads','legacy-archives','r.legacy_identity_id in (select id from parameter_catalog.legacy_identities where (owner_scope_kind=''organization'' and owner_scope_id=$1) or (owner_scope_kind=''project'' and owner_scope_id in (select id from public.projects where organization_id=$1)))'),
    ('parameter_catalog.legacy_mapping_versions','legacy-archives','r.legacy_identity_id in (select id from parameter_catalog.legacy_identities where (owner_scope_kind=''organization'' and owner_scope_id=$1) or (owner_scope_kind=''project'' and owner_scope_id in (select id from public.projects where organization_id=$1)))'),
    ('parameter_catalog.parameter_catalog_classification_ledger','legacy-archives','r.legacy_identity_id in (select id from parameter_catalog.legacy_identities where (owner_scope_kind=''organization'' and owner_scope_id=$1) or (owner_scope_kind=''project'' and owner_scope_id in (select id from public.projects where organization_id=$1)))'),
    ('parameter_catalog.parameter_catalog_comparison_cases','legacy-archives','(r.protected_reference_owner_scope_kind=''organization'' and r.protected_reference_owner_scope_id=$1) or (r.protected_reference_owner_scope_kind=''project'' and r.protected_reference_owner_scope_id in (select id from public.projects where organization_id=$1))'),
    ('parameter_catalog.parameter_catalog_comparison_results','legacy-archives','r.comparison_case_id in (select id from parameter_catalog.parameter_catalog_comparison_cases where (protected_reference_owner_scope_kind=''organization'' and protected_reference_owner_scope_id=$1) or (protected_reference_owner_scope_kind=''project'' and protected_reference_owner_scope_id in (select id from public.projects where organization_id=$1)))')
 ) as inventory(relation_name,domain,ownership) loop
   known:=array_append(known,target.relation_name);
   key:=target.relation_name;category:=target.domain;
   -- Heartbeats and progress do not change erasure ownership or authorization.
   -- Keep every business/identity field and physical key in the impact version.
   execute format($query$select count(*),encode(sha256(convert_to(coalesce(string_agg(digest,'' order by digest),''),'UTF8')),'hex') from (select encode(sha256(convert_to((to_jsonb(r)-array['last_seen_at','last_used_at','last_active_at','updated_at','progress','current_stage','lease_owner','lease_expires_at','lease_until','heartbeat_at','last_heartbeat_at'])::text,'UTF8')),'hex') digest from %s r where %s) s$query$,target.relation_name,target.ownership)
     into item_count,state_digest using p_org;
   return next;
 end loop;
 return query select 'platform-catalog.definitions','platform-catalog',count(*),'retained'::text from parameter_catalog.parameter_definitions;
 return query select 'platform-catalog.subjects','platform-catalog',count(*),'retained'::text from parameter_catalog.catalog_subjects;
 return query select 'platform-catalog.releases','platform-catalog',count(*),'retained'::text from parameter_catalog.catalog_releases;
 -- Frozen platform publication artifacts can contain a target Organization proposal.
 -- They require explicit domain treatment, never a substring-based global purge.
 return query select 'catalog_publication.organization-proposal-artifacts','unclassified',count(*),'protected-platform-provenance'::text
   from catalog_publication.candidates c where c.proposal_id in (select id from parameter_catalog.definition_proposals where organization_id=p_org) having count(*)>0;
 -- Physical keys, including pending cleanup reservations, can have foreign references.
 -- Counts describe database references; no bytes are listed, downloaded or removed.
 return query with refs(org,object_key) as (
   select organization_id,storage_key from public.log_file_objects
   union all select organization_id,object_key from public.log_files
   union all select organization_id,line_index_key from public.log_files
   union all select organization_id,object_key from public.log_original_uploads
   union all select organization_id,object_key from public.log_artifact_objects
   union all select organization_id,decoded_events_object_key from public.log_analysis_runs
   union all select organization_id,object_key from public.log_skill_samples
   union all select organization_id,sample_object_key from public.log_skill_dry_runs
   union all select organization_id,u->>'objectKey' from public.log_skill_analysis_cases cross join lateral jsonb_array_elements(uploads) u
   union all select organization_id,storage_key from public.log_source_snapshots
   union all select organization_id,object_key from public.log_skill_artifact_objects
   union all select organization_id,storage_key from public.knowledge_files
   union all select organization_id,storage_key from public.product_feedback_attachments
   union all select organization_id,unnest(object_keys) from public.product_feedback_attachment_uploads
   union all select f.organization_id,v.storage_key from public.project_parameter_file_versions v join public.project_parameter_files f on f.id=v.file_id
   union all select organization_id,storage_key from public.project_parameter_file_candidates
   union all select organization_id,object_ref from public.project_parameter_plane_archives
   union all select organization_id,overlay_source_storage_key from public.dts_reload_runs
   union all select organization_id,overlay_artifact_storage_key from public.dts_reload_runs
   union all select organization_id,unnest(pending_object_keys) from public.log_skill_deletions
   union all select organization_id,unnest(pending_object_refs) from parameter_catalog.project_erasures
   union all select organization_id,unnest(pending_object_refs) from parameter_catalog.log_erasures
   -- organization_id here is the original operator's Home, not file ownership.
   -- Global definition erasure and its pending cleanup survive that Organization.
   union all select null::text,unnest(pending_object_refs) from parameter_catalog.definition_erasures
   union all select case when a.owner_scope_kind='organization' then a.owner_scope_id when a.owner_scope_kind='project' then p.organization_id else null end,a.encrypted_object_ref
     from parameter_catalog.parameter_catalog_archives a left join public.projects p on a.owner_scope_kind='project' and p.id=a.owner_scope_id
 ), objects as (
   select distinct own.object_key,exists(select 1 from refs other where other.object_key=own.object_key and other.org is distinct from p_org) shared
     from refs own where own.org=p_org and own.object_key is not null
 ) select case when shared then 'storage.shared' else 'storage.exclusive' end,'storage',count(*),
   encode(sha256(convert_to(string_agg(encode(sha256(convert_to(object_key,'UTF8')),'hex'),'' order by object_key),'UTF8')),'hex') from objects group by shared;
 -- Runtime-owned LangGraph tables are optional and are not migration tables.
 foreach relation in array array['public.checkpoints','public.checkpoint_blobs','public.checkpoint_writes'] loop
   key:=relation;category:='agent';item_count:=0;state_digest:='absent';
   if to_regclass(relation) is not null and not has_table_privilege(current_user,relation,'SELECT') then
     category:='unclassified';item_count:=1;state_digest:='checkpoint-reader-unavailable';
   elsif to_regclass(relation) is not null then
     execute format($query$select count(*),encode(sha256(convert_to(coalesce(string_agg(digest,'' order by digest),''),'UTF8')),'hex') from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') digest from %s r where thread_id in (select id from public.agent_sessions where organization_id=$1)) s$query$,relation) into item_count,state_digest using p_org;
   end if;
   return next;
 end loop;
 -- A newly introduced direct owner cannot silently disappear from the preview.
 for relation in select n.nspname||'.'||c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   join pg_attribute a on a.attrelid=c.oid and a.attname='organization_id' and not a.attisdropped
   where n.nspname in ('public','parameter_catalog') and c.relkind='r'
   and not (n.nspname||'.'||c.relname=any(known)) and c.relname<>'public_experience_registration'
 loop key:=relation;category:='unclassified';item_count:=1;state_digest:='unregistered-owner';return next;end loop;
 -- Deployed cutovers may rename legacy relations; classify them explicitly before erasure.
 foreach relation in array array['public.legacy_parameter_definitions','public.legacy_project_parameter_values'] loop
   if to_regclass(relation) is not null then key:=relation;category:='unclassified';item_count:=1;state_digest:='legacy-owner-review';return next;end if;
 end loop;
end $$;
alter function parameter_catalog.preview_organization_deletion(text,text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.preview_organization_deletion(text,text) from public;
grant execute on function parameter_catalog.preview_organization_deletion(text,text) to catalog_baseline_reader_role;
