-- Restore the pre-0213 FK and owner-privilege policy. Permanent erasure needs
-- only five deferred back pointers and three cascading immutable hash keys.
-- The compact baseline records delete action / deferrable / initially deferred.
do $$
declare relation record; policy record; definition text; cycle_names text[]:=array['parameter_definition_current_revision_fk','parameter_definition_introduced_release_fk','project_parameter_binding_current_value_fk','definition_proposal_current_revision_fk','parameter_review_item_current_resolution_fk']; hash_names text[]:=array['catalog_activation_receipts_release_id_release_digest_fkey','catalog_activation_receipts_predecessor_release_id_predece_fkey','candidates_artifact_id_artifact_digest_fkey'];
begin
  for relation in select key relation_name,value policies from jsonb_each($baseline${"catalog_publication.candidates":{"candidates_artifact_id_artifact_digest_fkey":"r00","candidates_artifact_id_fkey":"r00","candidates_proposal_id_proposal_revision_id_fkey":"r00"},"catalog_publication.publication_authorizations":{"publication_authorizations_approved_authorization_id_fkey":"r00","publication_authorizations_candidate_id_artifact_digest_fkey":"r00","publication_authorizations_candidate_id_expected_base_rele_fkey":"r00","publication_authorizations_candidate_id_fkey":"r00","publication_authorizations_candidate_id_impact_report_dige_fkey":"r00","publication_authorizations_policy_revision_fkey":"r00"},"catalog_publication.publication_jobs":{"publication_jobs_authorization_id_candidate_id_fkey":"r00","publication_jobs_candidate_id_fkey":"r00"},"public.debugging_events":{"debugging_events_operation_id_fkey":"a00","debugging_events_organization_id_fkey":"a00","debugging_events_session_id_fkey":"a00"},"public.debugging_parameters":{"debugging_parameters_archived_by_fkey":"n00","debugging_parameters_organization_id_fkey":"a00","debugging_parameters_parameter_spec_id_fkey":"a00","debugging_parameters_project_parameter_binding_id_fkey":"a00"},"public.debugging_snapshots":{"debugging_snapshots_created_by_user_id_fkey":"n00","debugging_snapshots_operation_id_fkey":"a00","debugging_snapshots_organization_id_fkey":"a00","debugging_snapshots_session_id_fkey":"a00"},"public.debug_nodes":{"debug_nodes_canonical_binding_owner_fk":"r00","debug_nodes_canonical_binding_project_fk":"r00"},"public.dts_reload_run_targets":{"dts_reload_run_targets_binding_id_fkey":"c00","dts_reload_run_targets_canonical_binding_fk":"r00","dts_reload_run_targets_canonical_config_revision_fk":"r00","dts_reload_run_targets_canonical_definition_fk":"r00","dts_reload_run_targets_canonical_release_fk":"r00","dts_reload_run_targets_canonical_revision_fk":"r00","dts_reload_run_targets_canonical_source_occurrence_fk":"r00","dts_reload_run_targets_canonical_source_pin_fk":"r00","dts_reload_run_targets_canonical_value_fk":"r00","dts_reload_run_targets_reload_run_id_fkey":"c00"},"public.knowledge_parameter_references":{"knowledge_parameter_references_created_by_user_id_fkey":"n00","knowledge_parameter_references_entry_id_fkey":"c00","knowledge_parameter_references_organization_id_fkey":"a00","knowledge_parameter_references_parameter_spec_id_fkey":"a00"},"public.module_recognition_rules":{"module_recognition_rules_canonical_subject_id_fkey":"r00"},"public.node_operations":{"node_operations_actor_user_id_fkey":"n00","node_operations_canonical_binding_owner_fk":"r00","node_operations_canonical_binding_project_fk":"r00","node_operations_canonical_project_owner_fk":"r00","node_operations_node_id_fkey":"a00","node_operations_organization_id_fkey":"a00","node_operations_parameter_id_fkey":"a00","node_operations_parameter_spec_id_fkey":"a00","node_operations_project_parameter_binding_id_fkey":"a00","node_operations_related_operation_id_fkey":"n00","node_operations_session_id_fkey":"a00"},"parameter_catalog.binding_history_events":{"binding_history_event_applied_request_fk":"r11","binding_history_events_binding_id_fkey":"r00","binding_history_events_catalog_release_id_fkey":"r00","binding_history_events_new_current_value_id_fkey":"r00","binding_history_events_new_effective_revision_id_fkey":"r00","binding_history_events_old_current_value_id_fkey":"r00","binding_history_events_old_effective_revision_id_fkey":"r00","binding_history_legacy_mapping_version_fk":"r00"},"parameter_catalog.catalog_activation_receipts":{"catalog_activation_receipts_authorization_id_candidate_id_fkey":"r00","catalog_activation_receipts_candidate_id_fkey":"r00","catalog_activation_receipts_predecessor_release_id_predece_fkey":"r00","catalog_activation_receipts_publication_job_id_candidate_i_fkey":"r00","catalog_activation_receipts_release_id_release_digest_fkey":"r00"},"parameter_catalog.catalog_configuration_schemas":{"catalog_configuration_schemas_subject_id_fkey":"r11"},"parameter_catalog.catalog_drivers":{"catalog_drivers_subject_id_fkey":"r11"},"parameter_catalog.catalog_materializations":{"catalog_materializations_release_id_fkey":"r00"},"parameter_catalog.catalog_node_types":{"catalog_node_types_subject_id_fkey":"r11"},"parameter_catalog.catalog_publication_intents":{"catalog_publication_intent_proposal_base_fk":"r00","catalog_publication_intents_base_catalog_release_id_fkey":"r00","catalog_publication_intents_candidate_proposal_fk":"r00","catalog_publication_intents_proposal_id_fkey":"r00","catalog_publication_intents_proposal_id_proposal_revision__fkey":"r00"},"parameter_catalog.catalog_release_definition_heads":{"catalog_release_definition_heads_definition_id_fkey":"r11","catalog_release_definition_heads_definition_id_revision_id_fkey":"r11","catalog_release_definition_heads_release_id_fkey":"r00"},"parameter_catalog.catalog_releases":{"catalog_releases_predecessor_release_id_fkey":"r11"},"parameter_catalog.catalog_release_subject_aliases":{"catalog_release_subject_aliases_alias_id_subject_id_fkey":"r11","catalog_release_subject_aliases_release_id_subject_id_fkey":"r11"},"parameter_catalog.catalog_release_subjects":{"catalog_release_subject_subject_fk":"r11","catalog_release_subjects_release_id_fkey":"r00"},"parameter_catalog.catalog_state":{"catalog_state_current_catalog_release_id_fkey":"r00"},"parameter_catalog.catalog_subject_aliases":{"catalog_subject_alias_introduced_release_fk":"r11","catalog_subject_aliases_subject_id_fkey":"r11"},"parameter_catalog.catalog_subjects":{"catalog_subject_introduced_release_fk":"r11"},"parameter_catalog.definition_proposal_revisions":{"definition_proposal_revisions_proposal_id_fkey":"r00"},"parameter_catalog.definition_proposals":{"definition_proposal_current_revision_fk":"r11","definition_proposals_base_catalog_release_id_fkey":"r00","definition_proposals_base_definition_revision_id_fkey":"r00","definition_proposals_organization_id_fkey":"r00"},"parameter_catalog.definition_replacement_previews":{"definition_replacement_previe_old_definition_id_old_revisi_fkey":"r11","definition_replacement_previe_old_definition_id_old_subjec_fkey":"r11","definition_replacement_previews_candidate_id_fkey":"r11","definition_replacement_previews_organization_id_fkey":"r00"},"parameter_catalog.definition_replacement_projects":{"definition_replacement_projec_new_binding_id_new_definitio_fkey":"r11","definition_replacement_projec_old_binding_id_old_definitio_fkey":"r00","definition_replacement_projec_old_binding_id_organization__fkey":"r00","definition_replacement_projec_replacement_id_new_definitio_fkey":"r00","definition_replacement_project_new_binding_id_new_value_id_fkey":"r11","definition_replacement_project_old_binding_id_old_value_id_fkey":"r00","definition_replacement_projects_project_id_organization_id_fkey":"r00"},"parameter_catalog.definition_replacements":{"definition_replacements_new_definition_id_new_revision_id_fkey":"r11","definition_replacements_new_definition_id_new_subject_id_fkey":"r11","definition_replacements_old_definition_id_old_revision_id_fkey":"r11","definition_replacements_old_definition_id_old_subject_id_fkey":"r11","definition_replacements_organization_id_fkey":"r00","definition_replacements_publication_job_id_candidate_id_au_fkey":"r11","definition_replacements_source_preview_id_fkey":"r00"},"parameter_catalog.definition_revisions":{"definition_revisions_catalog_release_id_fkey":"r00","definition_revisions_definition_id_fkey":"r11"},"parameter_catalog.governance_command_idempotency":{"governance_command_idempotency_organization_id_fkey":"r00"},"parameter_catalog.legacy_mapping_heads":{"legacy_mapping_heads_legacy_identity_id_current_version_id_fkey":"r11","legacy_mapping_heads_legacy_identity_id_fkey":"r00"},"parameter_catalog.legacy_mapping_versions":{"legacy_mapping_versions_archive_id_legacy_identity_id_cuto_fkey":"r00","legacy_mapping_versions_cutover_run_id_fkey":"r00","legacy_mapping_versions_evidence_archive_id_legacy_identit_fkey":"r00","legacy_mapping_versions_legacy_identity_id_fkey":"r00","legacy_mapping_versions_supersedes_version_id_legacy_ident_fkey":"r00"},"parameter_catalog.organization_subject_registrations":{"organization_subject_registrations_organization_id_fkey":"r00","organization_subject_registrations_subject_id_fkey":"r00","registration_current_placement_fk":"r11"},"parameter_catalog.parameter_catalog_archives":{"parameter_catalog_archives_catalog_release_id_fkey":"r00","parameter_catalog_archives_cutover_run_id_fkey":"r00","parameter_catalog_archives_legacy_identity_id_owner_scope__fkey":"r00"},"parameter_catalog.parameter_catalog_classification_ledger":{"parameter_catalog_classificat_mapping_version_id_legacy_id_fkey":"r00","parameter_catalog_classification_ledger_cutover_run_id_fkey":"r00","parameter_catalog_classification_ledger_legacy_identity_id_fkey":"r00"},"parameter_catalog.parameter_catalog_comparison_cases":{"parameter_catalog_comparison_cases_cutover_run_id_fkey":"r00"},"parameter_catalog.parameter_catalog_comparison_results":{"parameter_catalog_comparison__selection_catalog_release_id_fkey":"r00","parameter_catalog_comparison__selection_legacy_identity_id_fkey":"r00","parameter_catalog_comparison_result_selection_version_fk":"r00","parameter_catalog_comparison_results_comparison_case_id_fkey":"r00","parameter_catalog_comparison_results_mapping_version_id_fkey":"r00","parameter_catalog_comparison_results_selection_run_id_fkey":"r00"},"parameter_catalog.parameter_catalog_cutover_checkpoints":{"parameter_catalog_cutover_checkpoints_cutover_run_id_fkey":"r00"},"parameter_catalog.parameter_catalog_cutover_events":{"parameter_catalog_cutover_events_cutover_run_id_fkey":"r00"},"parameter_catalog.parameter_definitions":{"parameter_definition_current_revision_fk":"r11","parameter_definition_introduced_release_fk":"r11","parameter_definitions_subject_id_fkey":"r11"},"parameter_catalog.parameter_observation_matches":{"parameter_observation_match_binding_fk":"r00","parameter_observation_match_binding_occurrence_fk":"r11","parameter_observation_match_observation_fk":"r00","parameter_observation_match_release_revision_fk":"r00","parameter_observation_match_source_occurrence_fk":"r11","parameter_observation_matches_catalog_release_id_fkey":"r00","parameter_observation_matches_definition_id_definition_rev_fkey":"r00","parameter_observation_matches_definition_id_subject_id_fkey":"r00","parameter_observation_matches_registration_id_organization_fkey":"r00"},"parameter_catalog.parameter_observations":{"parameter_observation_source_occurrence_fk":"r11","parameter_observations_catalog_release_id_fkey":"r00","parameter_observations_organization_id_fkey":"r00","parameter_observations_project_id_organization_id_fkey":"r00"},"parameter_catalog.parameter_review_evidence":{"parameter_review_evidence_observation_id_organization_id_fkey":"r00","parameter_review_evidence_organization_id_fkey":"r00"},"parameter_catalog.parameter_review_items":{"parameter_review_item_current_resolution_fk":"r11","parameter_review_items_catalog_release_id_fkey":"r00","parameter_review_items_organization_id_fkey":"r00"},"parameter_catalog.parameter_review_resolutions":{"parameter_review_resolutions_captured_catalog_release_id_fkey":"r00","parameter_review_resolutions_proposal_id_fkey":"r00","parameter_review_resolutions_registration_id_fkey":"r00","parameter_review_resolutions_review_item_id_fkey":"r00"},"parameter_catalog.plane_disposal_runs":{"plane_disposal_runs_archive_id_fkey":"r00","plane_disposal_runs_organization_id_fkey":"r00"},"parameter_catalog.project_parameter_bindings":{"project_parameter_binding_current_value_fk":"r11","project_parameter_binding_registration_fk":"r00","project_parameter_binding_release_revision_fk":"r11","project_parameter_binding_source_occurrence_fk":"r11","project_parameter_bindings_catalog_release_id_fkey":"r00","project_parameter_bindings_definition_id_effective_revisio_fkey":"r00","project_parameter_bindings_definition_id_subject_id_fkey":"r00","project_parameter_bindings_organization_id_fkey":"r00","project_parameter_bindings_project_id_organization_id_fkey":"r00"},"parameter_catalog.project_parameter_source_occurrences":{"project_parameter_source_occurrences_organization_id_fkey":"r00","source_occurrence_config_set_owner_fk":"r00","source_occurrence_configuration_schema_fk":"r00","source_occurrence_dts_node_owner_fk":"r00","source_occurrence_file_owner_fk":"r11","source_occurrence_project_owner_fk":"r00"},"parameter_catalog.project_parameter_values":{"project_parameter_value_replacement_source_fk":"r00","project_parameter_values_binding_id_definition_id_fkey":"r00","project_parameter_values_definition_id_definition_revision_fkey":"r00"},"parameter_catalog.project_source_member_tombstones":{"project_source_member_tombsto_config_revision_id_file_id_f_fkey":"r00","project_source_member_tombsto_config_set_id_organization_i_fkey":"r00","project_source_member_tombsto_file_id_organization_id_proj_fkey":"r00","project_source_member_tombsto_successor_config_revision_id_fkey":"r00","project_source_member_tombstones_audit_event_id_fkey":"r00"},"parameter_catalog.project_value_source_pins":{"project_value_source_pin_binding_fk":"r00","project_value_source_pin_file_version_fk":"r00","project_value_source_pin_occurrence_fk":"r00","project_value_source_pin_property_fk":"r00","project_value_source_pin_revision_fk":"r00","project_value_source_pin_revision_member_fk":"r00","project_value_source_pin_value_fk":"r00"},"parameter_catalog.subject_placements":{"subject_placements_module_id_organization_id_fkey":"n00","subject_placements_registration_id_organization_id_fkey":"r11"},"parameter_catalog.verification_approvals":{"verification_approvals_report_id_fkey":"r00"},"parameter_catalog.verification_attempts":{"verification_attempts_plan_id_fkey":"r00"},"parameter_catalog.verification_gate_results":{"verification_gate_results_attempt_id_fkey":"r00","verification_gate_results_gate_id_fkey":"r00"},"parameter_catalog.verification_reports":{"verification_reports_attempt_id_fkey":"r00","verification_reports_plan_id_fkey":"r00"},"public.parameter_change_requests":{"parameter_change_requests_assigned_to_user_id_fkey":"n00","parameter_change_requests_base_config_revision_id_fkey":"a00","parameter_change_requests_binding_revision_id_fkey":"a00","parameter_change_requests_candidate_config_revision_id_fkey":"a00","parameter_change_requests_logical_node_id_fkey":"a00","parameter_change_requests_organization_id_fkey":"a00","parameter_change_requests_parameter_definition_id_fkey":"a00","parameter_change_requests_parameter_spec_id_fkey":"a00","parameter_change_requests_project_id_fkey":"a00","parameter_change_requests_project_parameter_binding_id_fkey":"a00","parameter_change_requests_project_parameter_value_id_fkey":"a00","parameter_change_requests_property_occurrence_id_fkey":"a00","parameter_change_requests_source_file_version_id_fkey":"a00","parameter_change_requests_submission_round_id_fkey":"a00","parameter_change_requests_submitter_user_id_fkey":"n00","parameter_change_requests_workflow_hardware_committer_user_fkey":"n00","parameter_change_requests_workflow_software_committer_user_fkey":"n00","parameter_change_requests_workflow_software_user_id_fkey":"n00"},"public.parameter_definition_reconciliation_items":{"parameter_definition_reconcili_candidate_parameter_spec_id_fkey":"a00","parameter_definition_reconciliat_current_parameter_spec_id_fkey":"a00","parameter_definition_reconciliation_it_previous_subject_id_fkey":"a00","parameter_definition_reconciliation_items_next_subject_id_fkey":"a00","parameter_definition_reconciliation_items_organization_id_fkey":"c00","parameter_definition_reconciliation_items_run_id_fkey":"c00"},"public.parameter_definition_reconciliation_runs":{"parameter_definition_reconciliation_runs_organization_id_fkey":"c00"},"public.parameter_definitions":{"parameter_definitions_organization_id_fkey":"a00","parameter_definitions_parameter_module_id_fkey":"n00"},"public.parameter_drafts":{"parameter_drafts_base_config_revision_id_fkey":"a00","parameter_drafts_binding_revision_id_fkey":"a00","parameter_drafts_candidate_config_revision_id_fkey":"a00","parameter_drafts_logical_node_id_fkey":"a00","parameter_drafts_organization_id_fkey":"a00","parameter_drafts_origin_file_version_fkey":"n00","parameter_drafts_project_id_fkey":"a00","parameter_drafts_project_parameter_binding_id_fkey":"a00","parameter_drafts_project_parameter_value_id_fkey":"a00","parameter_drafts_property_occurrence_id_fkey":"a00","parameter_drafts_source_file_version_id_fkey":"a00","parameter_drafts_user_id_fkey":"c00"},"public.parameter_file_sync_conflicts":{"parameter_file_sync_conflicts_file_draft_fkey":"c00","parameter_file_sync_conflicts_file_version_fkey":"c00","parameter_file_sync_conflicts_organization_id_fkey":"a00","parameter_file_sync_conflicts_parameter_definition_id_fkey":"a00","parameter_file_sync_conflicts_parameter_spec_id_fkey":"a00","parameter_file_sync_conflicts_project_id_fkey":"a00","parameter_file_sync_conflicts_project_parameter_binding_id_fkey":"a00","parameter_file_sync_conflicts_resolved_by_user_id_fkey":"n00","parameter_file_sync_conflicts_ui_draft_fkey":"c00","parameter_file_sync_conflicts_value_fkey":"c00"},"public.parameter_history_entries":{"parameter_history_entries_changed_by_user_id_fkey":"n00","parameter_history_entries_logical_node_id_fkey":"a00","parameter_history_entries_organization_id_fkey":"a00","parameter_history_entries_parameter_definition_id_fkey":"a00","parameter_history_entries_parameter_spec_id_fkey":"a00","parameter_history_entries_project_id_fkey":"a00","parameter_history_entries_project_parameter_binding_id_fkey":"a00","parameter_history_entries_project_parameter_value_id_fkey":"a00","parameter_history_entries_request_id_fkey":"a00"},"public.parameter_identity_cutovers":{"parameter_identity_cutovers_migration_run_id_fkey":"a00"},"public.parameter_identity_migration_phases":{"parameter_identity_migration_phases_migration_run_id_fkey":"c00"},"public.parameter_import_batches":{"parameter_import_batches_created_by_user_id_fkey":"n00","parameter_import_batches_organization_id_fkey":"a00","parameter_import_batches_project_id_fkey":"a00"},"public.parameter_module_dismissed_compatibles":{"parameter_module_dismissed_compatible_dismissed_by_user_id_fkey":"n00","parameter_module_dismissed_compatibles_organization_id_fkey":"a00"},"public.parameter_module_mappings":{"parameter_module_mappings_organization_id_fkey":"a00","parameter_module_mappings_parameter_module_id_fkey":"c00"},"public.parameter_modules":{"parameter_modules_attribution_subject_id_fkey":"a00","parameter_modules_organization_id_fkey":"a00","parameter_modules_parent_id_fkey":"r00"},"public.parameter_policy_targets":{"parameter_policy_targets_organization_id_fkey":"a00","parameter_policy_targets_parameter_spec_id_fkey":"a00","parameter_policy_targets_parameter_spec_version_id_fkey":"a00"},"public.parameter_review_decisions":{"parameter_review_decisions_organization_id_fkey":"a00","parameter_review_decisions_request_id_fkey":"a00","parameter_review_decisions_reviewer_user_id_fkey":"n00"},"public.parameter_spec_matcher_overrides":{"parameter_spec_matcher_overrides_created_by_user_id_fkey":"n00","parameter_spec_matcher_overrides_organization_id_fkey":"a00","parameter_spec_matcher_overrides_parameter_spec_id_fkey":"a00","parameter_spec_matcher_overrides_project_id_fkey":"c00","parameter_spec_matcher_overrides_source_review_task_id_fkey":"a00"},"public.parameter_spec_property_key_cutover_items":{"parameter_spec_property_key_cutover_items_run_id_fkey":"c00"},"public.parameter_spec_property_key_cutover_runs":{"parameter_spec_property_key_cutover_run_created_by_user_id_fkey":"n00","parameter_spec_property_key_cutover_runs_organization_id_fkey":"a00","parameter_spec_property_key_cutover_runs_parameter_spec_id_fkey":"c00"},"public.parameter_spec_review_tasks":{"parameter_spec_review_tasks_config_revision_id_fkey":"c00","parameter_spec_review_tasks_migration_run_id_fkey":"a00","parameter_spec_review_tasks_organization_id_fkey":"a00","parameter_spec_review_tasks_parameter_spec_id_fkey":"a00","parameter_spec_review_tasks_project_id_fkey":"c00","parameter_spec_review_tasks_property_occurrence_id_fkey":"c00","parameter_spec_review_tasks_reviewer_user_id_fkey":"n00"},"public.parameter_specs":{"parameter_specs_attribution_subject_id_fkey":"a00","parameter_specs_organization_id_fkey":"a00"},"public.parameter_spec_version_cutover_items":{"parameter_spec_version_cutover_items_run_id_fkey":"c00"},"public.parameter_spec_version_cutover_runs":{"parameter_spec_version_cutover_runs_created_by_user_id_fkey":"n00","parameter_spec_version_cutover_runs_from_version_id_fkey":"a00","parameter_spec_version_cutover_runs_organization_id_fkey":"a00","parameter_spec_version_cutover_runs_parameter_spec_id_fkey":"c00","parameter_spec_version_cutover_runs_to_version_id_fkey":"a00"},"public.parameter_spec_versions":{"parameter_spec_versions_parameter_spec_id_fkey":"a00"},"public.parameter_submission_items":{"parameter_submission_items_candidate_config_revision_id_fkey":"a00","parameter_submission_items_change_request_id_fkey":"a00","parameter_submission_items_logical_node_id_fkey":"a00","parameter_submission_items_organization_id_fkey":"a00","parameter_submission_items_project_parameter_binding_id_fkey":"a00","parameter_submission_items_project_parameter_value_id_fkey":"a00","parameter_submission_items_submission_round_id_fkey":"a00"},"public.parameter_submission_rounds":{"parameter_submission_rounds_organization_id_fkey":"a00","parameter_submission_rounds_project_id_fkey":"a00","parameter_submission_rounds_submitter_user_id_fkey":"n00"},"public.project_parameter_binding_revisions":{"project_parameter_binding_revisi_parameter_spec_version_id_fkey":"a00","project_parameter_binding_revisions_binding_id_fkey":"c00","project_parameter_binding_revisions_config_revision_id_fkey":"c00"},"public.project_parameter_bindings":{"project_parameter_bindings_logical_node_id_fkey":"a00","project_parameter_bindings_module_id_fkey":"n00","project_parameter_bindings_organization_id_fkey":"a00","project_parameter_bindings_parameter_spec_id_fkey":"a00","project_parameter_bindings_project_id_fkey":"c00"},"public.project_parameter_file_candidates":{"project_parameter_file_candidates_abandoned_by_user_id_fkey":"n00","project_parameter_file_candidates_activated_by_user_id_fkey":"n00","project_parameter_file_candidates_activated_version_id_fkey":"n00","project_parameter_file_candidates_base_version_id_fkey":"n00","project_parameter_file_candidates_created_by_user_id_fkey":"n00","project_parameter_file_candidates_file_owner_fk":"r00","project_parameter_file_candidates_organization_id_fkey":"a00","project_parameter_file_candidates_project_id_fkey":"a00"},"public.project_parameter_files":{"project_parameter_files_config_set_id_fkey":"a00","project_parameter_files_current_version_fk":"a00","project_parameter_files_current_version_owner_fk":"r00","project_parameter_files_module_hint_fkey":"n00","project_parameter_files_organization_id_fkey":"a00","project_parameter_files_project_id_fkey":"c00"},"public.project_parameter_file_versions":{"project_parameter_file_versions_created_by_user_id_fkey":"n00","project_parameter_file_versions_file_id_fkey":"c00"},"public.project_parameter_initialization_drafts":{"project_parameter_initialization_drafts_created_by_user_id_fkey":"n00","project_parameter_initialization_drafts_organization_id_fkey":"a00","project_parameter_initialization_drafts_owner_user_id_fkey":"n00","project_parameter_initialization_drafts_project_id_fkey":"c00"},"public.project_parameter_initialization_reviews":{"project_parameter_initialization_revi_submitted_by_user_id_fkey":"n00","project_parameter_initialization_revie_reviewed_by_user_id_fkey":"n00","project_parameter_initialization_reviews_draft_id_fkey":"c00","project_parameter_initialization_reviews_organization_id_fkey":"a00","project_parameter_initialization_reviews_project_id_fkey":"c00"},"public.project_parameter_plane_archives":{"project_parameter_plane_archives_organization_id_fkey":"r00","project_parameter_plane_archives_project_id_fkey":"r00"},"public.project_parameter_value_change_requests":{"project_parameter_value_change_request_assigned_to_user_id_fkey":"n00","project_parameter_value_change_request_history_fk":"r11","project_parameter_value_change_request_member_file_fk":"r11","project_parameter_value_change_request_member_set_fk":"r11","project_parameter_value_change_request_member_version_fk":"r11","project_parameter_value_change_requests_binding_fk":"r11","project_parameter_value_change_requests_candidate_fk":"r11","project_parameter_value_change_requests_draft_id_fkey":"n00","project_parameter_value_change_requests_organization_id_fkey":"r00","project_parameter_value_change_requests_project_fk":"r11","project_parameter_value_change_requests_release_fk":"r11","project_parameter_value_change_requests_reviewer_user_id_fkey":"n00","project_parameter_value_change_requests_source_pin_fk":"r11","project_parameter_value_change_requests_submitter_user_id_fkey":"n00","project_parameter_value_change_requests_upload_candidate_fk":"r11","project_parameter_value_source_revision_set_fk":"r11"},"public.project_parameter_value_change_targets":{"project_parameter_value_change_targets_applied_file_fk":"r11","project_parameter_value_change_targets_applied_pin_fk":"r11","project_parameter_value_change_targets_applied_value_fk":"r11","project_parameter_value_change_targets_binding_fk":"r11","project_parameter_value_change_targets_history_fk":"r11","project_parameter_value_change_targets_pin_fk":"r11","project_parameter_value_change_targets_request_fk":"r11","project_parameter_value_change_targets_value_fk":"r11"},"public.project_parameter_value_drafts":{"project_parameter_value_drafts_binding_fk":"r11","project_parameter_value_drafts_candidate_fk":"r11","project_parameter_value_drafts_organization_id_fkey":"r00","project_parameter_value_drafts_project_fk":"r11","project_parameter_value_drafts_release_fk":"r11","project_parameter_value_drafts_source_pin_fk":"r11","project_parameter_value_drafts_user_id_fkey":"n00"},"public.project_parameter_values":{"project_parameter_values_organization_id_fkey":"a00","project_parameter_values_parameter_definition_id_fkey":"a00","project_parameter_values_project_id_fkey":"a00","project_parameter_values_updated_by_user_id_fkey":"n00"}}$baseline$::jsonb) loop
    for policy in select key name,value #>> '{}' flags from jsonb_each(relation.policies) loop
      select pg_get_constraintdef(c.oid) into definition from pg_constraint c where c.conrelid=relation.relation_name::regclass and c.conname=policy.name;
      if definition is null then raise exception 'Missing pre-erasure FK %',policy.name; end if;
      definition:=regexp_replace(definition,' (NOT )?DEFERRABLE( INITIALLY (DEFERRED|IMMEDIATE))?','');
      if left(policy.flags,1)='r' then definition:=regexp_replace(definition,' ON DELETE (NO ACTION|RESTRICT)','')||' ON DELETE RESTRICT'; end if;
      if policy.name=any(cycle_names) then
        definition:=regexp_replace(definition,' ON DELETE RESTRICT','')||' DEFERRABLE INITIALLY DEFERRED';
      else
        if policy.name=any(hash_names) then definition:=regexp_replace(definition,' ON UPDATE (NO ACTION|CASCADE)','')||' ON UPDATE CASCADE'; end if;
        if substr(policy.flags,2,1)='1' then definition:=definition||' DEFERRABLE'||case when right(policy.flags,1)='1' then ' INITIALLY DEFERRED' else '' end; end if;
      end if;
      execute format('alter table %s drop constraint %I',relation.relation_name,policy.name);
      execute format('alter table %s add constraint %I %s',relation.relation_name,policy.name,definition);
    end loop;
  end loop;
end;
$$;

-- Approvals keep the exact original bytes/base pin. New approvals are already
-- checked against the Candidate by assert_authorization_revoke_tuple; erasure
-- revokes old tuples instead of relabelling them as approvals of new bytes.
alter table catalog_publication.publication_authorizations
  drop constraint publication_authorizations_candidate_id_artifact_digest_fkey,
  drop constraint publication_authorizations_candidate_id_expected_base_rele_fkey;

-- Undo only broad table grants added in 0213, preserving old column grants.
do $$
declare entry record;
begin
  for entry in select key relation_name,value privileges from jsonb_each($acl${"public.agent_approvals":["DELETE","INSERT","SELECT","UPDATE"],"public.agent_messages":["DELETE","INSERT","SELECT","UPDATE"],"public.agent_run_traces":["DELETE","INSERT","SELECT","UPDATE"],"public.agent_sessions":["DELETE","INSERT","SELECT","UPDATE"],"public.agent_tool_calls":["DELETE","INSERT","SELECT","UPDATE"],"public.attribution_subjects":["DELETE","INSERT","UPDATE"],"public.audit_events":["DELETE","UPDATE"],"public.audit_subject_links":["DELETE","INSERT","UPDATE"],"public.auth_sessions":["DELETE","INSERT","SELECT","UPDATE"],"public.business_categories":["DELETE","INSERT","SELECT","UPDATE"],"public.debug_device_leases":["DELETE","INSERT","SELECT","UPDATE"],"public.debug_node_bindings":["DELETE","INSERT","SELECT","UPDATE"],"public.debug_node_modules":["DELETE","INSERT","SELECT","UPDATE"],"public.debug_nodes":["DELETE","INSERT","SELECT","UPDATE"],"public.debugging_devices":["DELETE","INSERT","SELECT","UPDATE"],"public.debugging_events":["DELETE","INSERT","SELECT","UPDATE"],"public.debugging_parameter_node_bindings":["DELETE","INSERT","SELECT","UPDATE"],"public.debugging_parameters":["DELETE","INSERT","SELECT","UPDATE"],"public.debugging_sessions":["DELETE","INSERT","SELECT","UPDATE"],"public.debugging_snapshots":["DELETE","INSERT","SELECT","UPDATE"],"public.debugging_targets":["DELETE","INSERT","SELECT","UPDATE"],"public.device_bridge_pairing_codes":["DELETE","INSERT","SELECT","UPDATE"],"public.device_bridge_tokens":["DELETE","INSERT","SELECT","UPDATE"],"public.device_bridges":["DELETE","INSERT","SELECT","UPDATE"],"public.driver_registration_placements":["DELETE","INSERT","UPDATE"],"public.driver_registrations":["DELETE","INSERT","SELECT","UPDATE"],"public.driver_schema_overlay_promotions":["DELETE","INSERT","UPDATE"],"public.driver_schema_overlay_properties":["DELETE","INSERT","UPDATE"],"public.driver_schema_overlays":["DELETE","INSERT","UPDATE"],"public.driver_schema_versions":["DELETE","INSERT","UPDATE"],"public.driver_schemas":["DELETE","INSERT","UPDATE"],"public.dts_config_revision_members":["INSERT","UPDATE"],"public.dts_config_revisions":["INSERT","UPDATE"],"public.dts_config_set":["INSERT","UPDATE"],"public.dts_logical_node_revisions":["INSERT","UPDATE"],"public.dts_logical_nodes":["INSERT","UPDATE"],"public.dts_node_occurrences":["INSERT","UPDATE"],"public.dts_nodes":["INSERT","UPDATE"],"public.dts_occurrence_effects":["INSERT","UPDATE"],"public.dts_phandle_refs":["INSERT","UPDATE"],"public.dts_properties":["INSERT","UPDATE"],"public.dts_property_occurrence_spec_decisions":["INSERT","UPDATE"],"public.dts_property_occurrences":["INSERT","UPDATE"],"public.dts_property_specs":["DELETE","INSERT","UPDATE"],"public.dts_release_baseline":["INSERT","UPDATE"],"public.dts_release_baseline_members":["INSERT","UPDATE"],"public.dts_reload_device_residue":["DELETE","INSERT","SELECT","UPDATE"],"public.dts_reload_org_defaults":["DELETE","INSERT","SELECT","UPDATE"],"public.dts_reload_run_targets":["DELETE","INSERT","SELECT","UPDATE"],"public.dts_reload_runs":["DELETE","INSERT","SELECT","UPDATE"],"public.dts_sensitive_node_rules":["DELETE","INSERT","SELECT","UPDATE"],"public.dts_validation_diagnostics":["INSERT","UPDATE"],"public.dts_validation_runs":["INSERT","UPDATE"],"public.identity_mapping_tasks":["INSERT","UPDATE"],"public.jobs":["DELETE","INSERT","SELECT","UPDATE"],"public.knowledge_chunks":["DELETE","INSERT","SELECT","UPDATE"],"public.knowledge_definition_references":["DELETE","INSERT","SELECT","UPDATE"],"public.knowledge_entries":["DELETE","INSERT","SELECT","UPDATE"],"public.knowledge_files":["DELETE","INSERT","SELECT","UPDATE"],"public.knowledge_index_status":["DELETE","INSERT","SELECT","UPDATE"],"public.knowledge_parameter_references":["DELETE","INSERT","SELECT","UPDATE"],"public.knowledge_revisions":["DELETE","INSERT","SELECT","UPDATE"],"public.legacy_parameter_migration_evidence":["DELETE","INSERT","UPDATE"],"public.local_registration_role_requests":["DELETE","INSERT","SELECT","UPDATE"],"public.log_analysis_reports":["DELETE","INSERT","SELECT","UPDATE"],"public.log_analysis_runs":["DELETE","INSERT","SELECT","UPDATE"],"public.log_analysis_stages":["DELETE","INSERT","SELECT","UPDATE"],"public.log_analysis_trace_steps":["DELETE","INSERT","SELECT","UPDATE"],"public.log_domain_knowledge_links":["DELETE","INSERT","SELECT","UPDATE"],"public.log_domains":["DELETE","INSERT","SELECT","UPDATE"],"public.log_evidence":["DELETE","INSERT","SELECT","UPDATE"],"public.log_feedback":["DELETE","INSERT","SELECT","UPDATE"],"public.log_file_objects":["DELETE","INSERT","SELECT","UPDATE"],"public.log_files":["DELETE","INSERT","SELECT","UPDATE"],"public.log_integration_credentials":["DELETE","INSERT","SELECT","UPDATE"],"public.log_original_uploads":["DELETE","INSERT","SELECT","UPDATE"],"public.log_records":["DELETE","INSERT","SELECT","UPDATE"],"public.log_skill_analysis_case_runs":["DELETE","INSERT","SELECT","UPDATE"],"public.log_skill_analysis_cases":["DELETE","INSERT","SELECT","UPDATE"],"public.log_skill_dry_runs":["DELETE","INSERT","SELECT","UPDATE"],"public.log_skill_revisions":["DELETE","INSERT","SELECT","UPDATE"],"public.log_skill_samples":["DELETE","INSERT","SELECT","UPDATE"],"public.log_source_chunks":["DELETE","INSERT","SELECT","UPDATE"],"public.log_source_files":["DELETE","INSERT","SELECT","UPDATE"],"public.log_source_snapshots":["DELETE","INSERT","SELECT","UPDATE"],"public.log_source_statements":["DELETE","INSERT","SELECT","UPDATE"],"public.log_webhook_deliveries":["DELETE","INSERT","SELECT","UPDATE"],"public.log_webhook_outbox":["DELETE","INSERT","SELECT","UPDATE"],"public.module_recognition_rules":["DELETE","INSERT"],"public.node_operations":["DELETE","INSERT","SELECT","UPDATE"],"public.node_type_definitions":["DELETE","INSERT","SELECT","UPDATE"],"public.notification_outbox":["DELETE","INSERT","SELECT","UPDATE"],"public.organizations":["DELETE","INSERT","UPDATE"],"public.parameter_change_requests":["INSERT","UPDATE"],"public.parameter_definition_reconciliation_items":["DELETE","INSERT","UPDATE"],"public.parameter_definition_reconciliation_runs":["DELETE","INSERT","UPDATE"],"public.parameter_definitions":["DELETE","INSERT","UPDATE"],"public.parameter_draft_identity_invalidations":["INSERT","UPDATE"],"public.parameter_drafts":["INSERT","UPDATE"],"public.parameter_file_sync_conflicts":["INSERT","UPDATE"],"public.parameter_history_entries":["INSERT","UPDATE"],"public.parameter_identity_cutovers":["DELETE","INSERT","UPDATE"],"public.parameter_identity_migration_phases":["DELETE","INSERT","UPDATE"],"public.parameter_identity_migration_runs":["DELETE","INSERT","UPDATE"],"public.parameter_import_batches":["INSERT","UPDATE"],"public.parameter_module_dismissed_compatibles":["DELETE","INSERT","UPDATE"],"public.parameter_module_mappings":["DELETE","INSERT","UPDATE"],"public.parameter_modules":["DELETE","INSERT"],"public.parameter_policy_targets":["DELETE","INSERT","UPDATE"],"public.parameter_review_decisions":["INSERT","UPDATE"],"public.parameter_spec_matcher_overrides":["INSERT","UPDATE"],"public.parameter_spec_property_key_cutover_items":["DELETE","INSERT","UPDATE"],"public.parameter_spec_property_key_cutover_runs":["DELETE","INSERT","UPDATE"],"public.parameter_spec_review_tasks":["DELETE","INSERT","UPDATE"],"public.parameter_spec_version_cutover_items":["DELETE","INSERT","UPDATE"],"public.parameter_spec_version_cutover_runs":["DELETE","INSERT","UPDATE"],"public.parameter_spec_versions":["DELETE","INSERT","UPDATE"],"public.parameter_specs":["DELETE","INSERT","UPDATE"],"public.parameter_submission_items":["INSERT","UPDATE"],"public.parameter_submission_rounds":["INSERT","UPDATE"],"public.product_feedback":["DELETE","INSERT","SELECT","UPDATE"],"public.product_feedback_attachments":["DELETE","INSERT","SELECT","UPDATE"],"public.product_feedback_progress_events":["DELETE","INSERT","SELECT","UPDATE"],"public.project_modules":["DELETE","INSERT","SELECT","UPDATE"],"public.project_parameter_binding_revisions":["INSERT","UPDATE"],"public.project_parameter_bindings":["INSERT","UPDATE"],"public.project_parameter_file_candidates":["INSERT","UPDATE"],"public.project_parameter_file_versions":["INSERT","UPDATE"],"public.project_parameter_files":["INSERT","UPDATE"],"public.project_parameter_initialization_drafts":["INSERT","UPDATE"],"public.project_parameter_initialization_reviews":["INSERT","UPDATE"],"public.project_parameter_plane_archives":["DELETE","INSERT","SELECT","UPDATE"],"public.project_parameter_value_change_requests":["INSERT","UPDATE"],"public.project_parameter_value_drafts":["INSERT","UPDATE"],"public.project_parameter_values":["INSERT","UPDATE"],"public.projects":["DELETE","INSERT","UPDATE"],"public.roles":["DELETE","INSERT","SELECT","UPDATE"],"public.schema_migrations":["DELETE","INSERT","SELECT","UPDATE"],"public.seed_initialization_runs":["DELETE","INSERT","SELECT","UPDATE"],"public.user_notifications":["DELETE","INSERT","SELECT","UPDATE"],"public.user_password_credentials":["DELETE","INSERT","SELECT","UPDATE"],"public.user_role_bindings":["DELETE","INSERT","SELECT","UPDATE"],"public.users":["DELETE","INSERT","SELECT","UPDATE"]}$acl$::jsonb) loop
    execute format('revoke %s on table %s from catalog_migration_owner',(select string_agg(v,',') from jsonb_array_elements_text(entry.privileges) v),entry.relation_name);
  end loop;
end;
$$;
-- Exact parameter descendants and structured snapshots owned by this command.
grant select,update,delete on public.agent_approvals,
  public.agent_tool_calls,
  public.audit_events,
  public.audit_subject_links,
  public.debug_nodes,
  public.debugging_events,
  public.debugging_parameters,
  public.debugging_snapshots,
  public.dts_reload_device_residue,
  public.dts_reload_run_targets,
  public.dts_reload_runs,
  public.knowledge_definition_references,
  public.knowledge_parameter_references,
  public.node_operations,
  public.parameter_change_requests,
  public.parameter_definition_reconciliation_items,
  public.parameter_definition_reconciliation_runs,
  public.parameter_definitions,
  public.parameter_drafts,
  public.parameter_file_sync_conflicts,
  public.parameter_history_entries,
  public.parameter_import_batches,
  public.parameter_policy_targets,
  public.parameter_review_decisions,
  public.parameter_spec_matcher_overrides,
  public.parameter_spec_property_key_cutover_items,
  public.parameter_spec_property_key_cutover_runs,
  public.parameter_spec_review_tasks,
  public.parameter_spec_version_cutover_items,
  public.parameter_spec_version_cutover_runs,
  public.parameter_spec_versions,
  public.parameter_specs,
  public.parameter_submission_items,
  public.project_parameter_binding_revisions,
  public.project_parameter_bindings,
  public.project_parameter_file_candidates,
  public.project_parameter_initialization_drafts,
  public.project_parameter_plane_archives,
  public.project_parameter_value_change_requests,
  public.project_parameter_value_change_targets,
  public.project_parameter_value_drafts,
  public.project_parameter_values to catalog_migration_owner;
grant select on public.project_parameter_file_versions,public.knowledge_files,public.log_file_objects,public.log_source_snapshots,public.product_feedback_attachments to catalog_migration_owner;

-- Run normal refresh/validation triggers. Only immutable guards and the one
-- sanitized member-manifest/delete-pin proof accept exact erasure capabilities.
do $$
declare routine record; original text; rewritten text; prefix text:=E'  if TG_OP in (''UPDATE'',''DELETE'') and parameter_catalog.definition_purge_allows_change(TG_TABLE_SCHEMA,TG_TABLE_NAME,to_jsonb(OLD),TG_OP) then\n    if TG_OP=''DELETE'' then return OLD; else return NEW; end if;\n  end if;\n';
begin
  for routine in select p.oid,p.proname from pg_proc p join pg_language l on l.oid=p.prolang where l.lanname='plpgsql' and p.prorettype='trigger'::regtype and p.prosrc like '%parameter_catalog.definition_purge_allows_change(TG_TABLE_SCHEMA%' loop
    original:=pg_get_functiondef(routine.oid);rewritten:=replace(original,prefix,'');
    if routine.proname like 'protect_%' or routine.proname like 'reject_%' or routine.proname in ('assert_member_removal_tombstone','assert_project_value_source_pin_owner') then rewritten:=original; end if;
    if rewritten<>original then execute rewritten; end if;
  end loop;
end;
$$;

alter table parameter_catalog.definition_erasures add constraint definition_erasures_audit_unique unique(audit_event_id);
alter table parameter_catalog.project_value_source_pins add column erased_request_audit_id text,
  add constraint project_value_source_pin_erased_request_fk foreign key(erased_request_audit_id)
    references parameter_catalog.definition_erasures(audit_event_id) on delete restrict deferrable initially deferred;
alter table parameter_catalog.project_value_source_pins drop constraint project_value_source_pin_delete_state_ck,
  add constraint project_value_source_pin_delete_state_ck check(
    (value_state='present' and base_source_pin_id is null and delete_request_id is null and delete_proof is null and erased_request_audit_id is null) or
    (value_state='deleted' and base_source_pin_id is not null and delete_proof is not null and
      ((delete_request_id is not null and erased_request_audit_id is null) or (delete_request_id is null and erased_request_audit_id is not null))));
create function parameter_catalog.protect_erased_source_pin_provenance() returns trigger language plpgsql security definer set search_path=pg_catalog,parameter_catalog as $$
begin
  if new.erased_request_audit_id is not null and (TG_OP='INSERT' or new.erased_request_audit_id is distinct from old.erased_request_audit_id)
    and not (TG_OP='UPDATE' and parameter_catalog.definition_purge_allows_change(TG_TABLE_SCHEMA,TG_TABLE_NAME,to_jsonb(old),'UPDATE')) then
    raise exception using errcode='55000',message='Only Definition erasure may detach a surviving source pin approval';
  end if;
  return new;
end;
$$;
alter function parameter_catalog.protect_erased_source_pin_provenance() owner to catalog_migration_owner;
revoke all on function parameter_catalog.protect_erased_source_pin_provenance() from public;
create trigger project_value_source_pin_erased_provenance_guard before insert or update on parameter_catalog.project_value_source_pins
for each row execute function parameter_catalog.protect_erased_source_pin_provenance();

create or replace function parameter_catalog.definition_purge_closure(p_id text)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,parameter_catalog,public,catalog_publication as $$
declare targets jsonb:='{}'; previous jsonb; keys jsonb; edge record; relation_name text; join_sql text; all_ids text[];
begin
  if not exists(select 1 from parameter_catalog.parameter_definitions where id=p_id) then return targets; end if;
  targets:=jsonb_build_object('parameter_catalog.parameter_definitions',jsonb_build_array(jsonb_build_object('id',p_id)));
  loop
    previous:=targets;
    -- Follow child FKs, never semantic parents such as shared nodes/files.
    -- Excluded edges are provenance links into surviving parameters or shared
    -- snapshots; the erasure function explicitly detaches those instead.
    for edge in
      select fk.*,child_ns.nspname||'.'||child.relname child_name,parent_ns.nspname||'.'||parent.relname parent_name
      from pg_constraint fk join pg_class child on child.oid=fk.conrelid join pg_namespace child_ns on child_ns.oid=child.relnamespace
      join pg_class parent on parent.oid=fk.confrelid join pg_namespace parent_ns on parent_ns.oid=parent.relnamespace
      where fk.contype='f' and child_ns.nspname in ('public','parameter_catalog','catalog_publication')
        and targets ? (parent_ns.nspname||'.'||parent.relname)
        and child.relname not in ('debugging_snapshots','definition_erasures','definition_purge_rows')
        and not (child_ns.nspname='parameter_catalog' and child.relname='project_parameter_values' and fk.conname='project_parameter_value_replacement_source_fk')
        and not (child_ns.nspname='parameter_catalog' and child.relname='binding_history_events' and parent.relname in ('project_parameter_value_change_requests','project_parameter_value_change_targets'))
        and not (child_ns.nspname='parameter_catalog' and child.relname='project_value_source_pins' and parent.relname='project_parameter_value_change_targets')
        and not (child_ns.nspname='catalog_publication' and child.relname='candidates' and parent.relname in ('definition_proposals','definition_proposal_revisions'))
        and not (child_ns.nspname='parameter_catalog' and child.relname='project_source_member_tombstones' and parent.relname='audit_events')
        and not (child.relname='node_operations' and parent.relname in ('debugging_snapshots','node_operations'))
      order by child_name,fk.conname
    loop
      select string_agg(format('c.%I=p.%I',ca.attname,pa.attname),' and ' order by columns.ordinal)
      into join_sql from unnest(edge.conkey,edge.confkey) with ordinality columns(child_att,parent_att,ordinal)
      join pg_attribute ca on ca.attrelid=edge.conrelid and ca.attnum=columns.child_att
      join pg_attribute pa on pa.attrelid=edge.confrelid and pa.attnum=columns.parent_att;
      execute format('select coalesce(jsonb_agg(distinct parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(c))),''[]'') from %s c join %s p on %s where $1 @> jsonb_build_array(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(p)))',
        edge.child_name,edge.child_name,edge.parent_name,join_sql,edge.parent_name)
      into keys using targets->edge.parent_name;
      if keys @> '[null]'::jsonb then raise exception 'Definition erasure requires a primary key on %',edge.child_name; end if;
      targets:=parameter_catalog.definition_purge_add(targets,edge.child_name,keys);
    end loop;
    -- Multi-parameter approvals are indivisible proofs. Remove their approval
    -- copies, preserving the other parameters' actual values and history.
    select coalesce(jsonb_agg(jsonb_build_object('id',request_id)),'[]') into keys
      from public.project_parameter_value_change_targets where id=any(parameter_catalog.definition_purge_ids(targets,'public.project_parameter_value_change_targets'));
    targets:=parameter_catalog.definition_purge_add(targets,'public.project_parameter_value_change_requests',keys);
    select coalesce(jsonb_agg(jsonb_build_object('id',observation_id)),'[]') into keys
      from parameter_catalog.parameter_observation_matches where id=any(parameter_catalog.definition_purge_ids(targets,'parameter_catalog.parameter_observation_matches'));
    targets:=parameter_catalog.definition_purge_add(targets,'parameter_catalog.parameter_observations',keys);
    select coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') into keys from public.knowledge_definition_references where definition_id=p_id;
    targets:=parameter_catalog.definition_purge_add(targets,'public.knowledge_definition_references',keys);
    -- Mappings have typed, deliberately non-FK target references.
    select coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') into keys from parameter_catalog.legacy_mapping_versions m
      where m.target_id=any(parameter_catalog.definition_purge_ids(targets,case m.target_kind
        when 'parameter-definition' then 'parameter_catalog.parameter_definitions' when 'definition-revision' then 'parameter_catalog.definition_revisions'
        when 'parameter-binding' then 'parameter_catalog.project_parameter_bindings' when 'project-value' then 'parameter_catalog.project_parameter_values'
        when 'binding-history-event' then 'parameter_catalog.binding_history_events' when 'parameter-observation' then 'parameter_catalog.parameter_observations'
        when 'observation-match' then 'parameter_catalog.parameter_observation_matches' when 'review-evidence' then 'parameter_catalog.parameter_review_evidence'
        when 'review-item' then 'parameter_catalog.parameter_review_items' when 'review-resolution' then 'parameter_catalog.parameter_review_resolutions'
        when 'definition-proposal' then 'parameter_catalog.definition_proposals' when 'definition-proposal-revision' then 'parameter_catalog.definition_proposal_revisions'
        when 'publication-intent' then 'parameter_catalog.catalog_publication_intents' else '' end));
    targets:=parameter_catalog.definition_purge_add(targets,'parameter_catalog.legacy_mapping_versions',keys);
    select coalesce(jsonb_agg(jsonb_build_object('id',legacy_identity_id)),'[]') into keys from parameter_catalog.legacy_mapping_versions
      where id=any(parameter_catalog.definition_purge_ids(targets,'parameter_catalog.legacy_mapping_versions'));
    targets:=parameter_catalog.definition_purge_add(targets,'parameter_catalog.legacy_identities',keys);
    for relation_name in select unnest(array['public.parameter_specs','public.parameter_spec_versions','public.parameter_definitions','public.project_parameter_values']) loop
      execute format('select coalesce(jsonb_agg(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(s))),''[]'') from %s s join parameter_catalog.legacy_identities i on i.source_id=s.id where i.id=any($1) and i.source_kind=$2',relation_name,relation_name)
        into keys using parameter_catalog.definition_purge_ids(targets,'parameter_catalog.legacy_identities'),case relation_name
          when 'public.parameter_specs' then 'parameter-spec' when 'public.parameter_spec_versions' then 'parameter-spec-version'
          when 'public.parameter_definitions' then 'legacy-flat-parameter-definition' else 'legacy-flat-project-parameter-value' end;
      targets:=parameter_catalog.definition_purge_add(targets,relation_name,keys);
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('id',parameter_spec_id)),'[]') into keys from public.parameter_spec_versions
      where id=any(parameter_catalog.definition_purge_ids(targets,'public.parameter_spec_versions'));
    targets:=parameter_catalog.definition_purge_add(targets,'public.parameter_specs',keys);
    select coalesce(jsonb_agg(jsonb_build_object('id',legacy_id)),'[]') into keys from public.legacy_parameter_migration_evidence
      where legacy_kind='parameter_definition' and id=any(parameter_catalog.definition_purge_ids(targets,'public.legacy_parameter_migration_evidence'));
    targets:=parameter_catalog.definition_purge_add(targets,'public.parameter_definitions',keys);
    -- Review groups can include several projects/Definitions with the same key.
    -- Remove a group only when none of its evidence survives the erasure.
    select coalesce(jsonb_agg(jsonb_build_object('id',i.id)),'[]') into keys from parameter_catalog.parameter_review_items i
      where exists(select 1 from parameter_catalog.parameter_review_evidence e where e.id=any(parameter_catalog.definition_purge_ids(targets,'parameter_catalog.parameter_review_evidence'))
        and parameter_catalog.definition_purge_review_fingerprint(to_jsonb(e))=i.evidence_fingerprint)
      and not exists(select 1 from parameter_catalog.parameter_review_evidence e where not(e.id=any(parameter_catalog.definition_purge_ids(targets,'parameter_catalog.parameter_review_evidence')))
        and parameter_catalog.definition_purge_review_fingerprint(to_jsonb(e))=i.evidence_fingerprint);
    targets:=parameter_catalog.definition_purge_add(targets,'parameter_catalog.parameter_review_items',keys);
    select coalesce(array_agg(distinct coalesce(k->>'id',k->>'draft_id')),'{}') into all_ids
      from jsonb_each(targets) t cross join jsonb_array_elements(t.value) k;
    select coalesce(jsonb_agg(parameter_catalog.definition_purge_key('parameter_catalog.legacy_identities',to_jsonb(i))),'[]') into keys
      from parameter_catalog.legacy_identities i where i.source_id=any(parameter_catalog.definition_purge_ids(targets,
        case i.source_kind when 'legacy-flat-parameter-definition' then 'public.parameter_definitions'
        when 'legacy-flat-project-parameter-value' then 'public.project_parameter_values'
        when 'parameter-history-entry' then 'public.parameter_history_entries'
        when 'legacy-parameter-migration-evidence' then 'public.legacy_parameter_migration_evidence'
        else 'public.'||replace(i.source_kind,'-','_')||'s' end));
    targets:=parameter_catalog.definition_purge_add(targets,'parameter_catalog.legacy_identities',keys);
    foreach relation_name in array array['public.debugging_parameters','public.node_operations'] loop
      execute format('select coalesce(jsonb_agg(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r))),''[]'') from %s r where r.parameter_definition_id=any($1)',relation_name,relation_name)
      into keys using parameter_catalog.definition_purge_ids(targets,'public.parameter_definitions');
      targets:=parameter_catalog.definition_purge_add(targets,relation_name,keys);
    end loop;
    foreach relation_name in array array['parameter_catalog.catalog_command_idempotency','parameter_catalog.governance_command_idempotency'] loop
      execute format('select coalesce(jsonb_agg(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r))),''[]'') from %s r where r.result_ref=any($1)',relation_name,relation_name)
      into keys using all_ids;
      targets:=parameter_catalog.definition_purge_add(targets,relation_name,keys);
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') into keys from public.audit_events where target_id=any(all_ids);
    targets:=parameter_catalog.definition_purge_add(targets,'public.audit_events',keys);
    exit when targets=previous;
  end loop;
  return targets;
end;
$$;

create or replace function parameter_catalog.preview_parameter_definition_purge(p_id text)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,parameter_catalog,public as $$
declare targets jsonb; entry record; control record; counts jsonb:='{}'; visible_targets jsonb:='{}'; row_digests jsonb:='{}'; definition jsonb; organizations text[]:='{}'; projects text[]:='{}'; part text[]; fingerprint text; rows_json jsonb; plane_archives jsonb; catalog_archives jsonb; ids text[];
begin
  select jsonb_build_object('id',d.id,'propertyKey',d.property_key,'subjectName',s.canonical_key) into definition
    from parameter_catalog.parameter_definitions d join parameter_catalog.catalog_subjects s on s.id=d.subject_id where d.id=p_id;
  if definition is null then return null; end if;
  targets:=parameter_catalog.definition_purge_closure(p_id);
  for entry in select key relation_name,value keys from jsonb_each(targets) order by key loop
    counts:=counts||jsonb_build_object(entry.relation_name,jsonb_array_length(entry.keys));
    visible_targets:=visible_targets||jsonb_build_object(entry.relation_name,(select jsonb_agg(coalesce(k->>'id',k->>'draft_id',k::text) order by k::text) from jsonb_array_elements(entry.keys) k));
    execute format('select coalesce(array_agg(distinct to_jsonb(r)->>''organization_id'') filter(where to_jsonb(r)->>''organization_id'' is not null),''{}'') from %s r where $1 @> jsonb_build_array(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r)))',entry.relation_name,entry.relation_name) into part using entry.keys;
    organizations:=organizations||part;
    execute format('select coalesce(array_agg(distinct to_jsonb(r)->>''project_id'') filter(where to_jsonb(r)->>''project_id'' is not null),''{}'') from %s r where $1 @> jsonb_build_array(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r)))',entry.relation_name,entry.relation_name) into part using entry.keys;
    projects:=projects||part;
    execute format('select coalesce(jsonb_agg(to_jsonb(r) order by parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r))::text),''[]'') from %s r where $1 @> jsonb_build_array(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r)))',entry.relation_name,entry.relation_name,entry.relation_name) into rows_json using entry.keys;
    row_digests:=row_digests||jsonb_build_object(entry.relation_name,rows_json);
  end loop;
  select coalesce(array_agg(distinct coalesce(k->>'id',k->>'draft_id')) filter(where coalesce(k->>'id',k->>'draft_id') is not null),'{}') into ids
    from jsonb_each(targets) t cross join jsonb_array_elements(t.value) k;
  for control in select * from (values
    ('public.project_parameter_initialization_drafts','binding_snapshots'),('public.project_parameter_initialization_drafts','selected_source_binding_ids'),
    ('public.project_parameter_file_candidates','impact'),('public.project_parameter_file_candidates','frozen_binding_manifest'),('public.project_parameter_file_candidates','source_revision_context'),
    ('public.debugging_snapshots','entries'),('public.debugging_events','metadata'),('public.node_operations','canonical_pin'),
    ('public.dts_reload_runs','reload_snapshot'),('public.dts_reload_runs','steps'),('public.dts_reload_runs','diagnostics'),('public.dts_reload_device_residue','parameters'),
    ('public.audit_events','metadata'),('public.parameter_import_batches','items'),('public.parameter_import_batches','summary'),
    ('public.parameter_definition_reconciliation_runs','report'),('public.parameter_definition_reconciliation_items','evidence'),
    ('public.parameter_spec_review_tasks','source_evidence'),('public.parameter_spec_review_tasks','candidate_schemas'),('public.parameter_spec_versions','reference_rules'),
    ('parameter_catalog.project_source_member_tombstones','binding_manifest'),('parameter_catalog.project_source_member_tombstones','successor_binding_manifest'),
    ('parameter_catalog.parameter_catalog_cutover_checkpoints','payload'),('parameter_catalog.parameter_catalog_cutover_events','payload'),
    ('parameter_catalog.parameter_catalog_comparison_results','evidence'),('catalog_publication.candidates','identity_allocation'),('catalog_publication.candidates','capability_contract')
  ) controls(relation_name,column_name) loop
    execute format('select coalesce(jsonb_agg(to_jsonb(r) order by parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r))::text),''[]'') from %s r where r.%I is not null and r.%I is distinct from coalesce(parameter_catalog.definition_purge_json(r.%I,$1),case jsonb_typeof(r.%I) when ''array'' then ''[]''::jsonb else ''{}''::jsonb end)',
      control.relation_name,control.relation_name,control.column_name,control.column_name,control.column_name,control.column_name) into rows_json using ids;
    if rows_json<>'[]' then row_digests:=row_digests||jsonb_build_object('json:'||control.relation_name||':'||control.column_name,rows_json); end if;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') into plane_archives from public.project_parameter_plane_archives a;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') into catalog_archives from parameter_catalog.parameter_catalog_archives a;
  fingerprint:='sha256:'||encode(sha256(convert_to((row_digests||jsonb_build_object('planeArchives',plane_archives,'catalogArchives',catalog_archives))::text,'UTF8')),'hex');
  return jsonb_build_object('definition',definition,'counts',counts,'targets',visible_targets,'fingerprint',fingerprint,
    'catalogRelease',(select jsonb_build_object('id',r.id,'digest',r.release_digest) from parameter_catalog.catalog_state s join parameter_catalog.catalog_releases r on r.id=s.current_catalog_release_id),
    'organizationIds',(select coalesce(jsonb_agg(v order by v),'[]') from (select distinct unnest(organizations) v) a),
    'projectIds',(select coalesce(jsonb_agg(v order by v),'[]') from (select distinct unnest(projects) v) a),
    'affectedOrganizations',(select count(distinct v) from unnest(organizations) v),
    'affectedProjects',(select count(distinct v) from unnest(projects) v),
    'legacySpecIds',to_jsonb(parameter_catalog.definition_purge_ids(targets,'public.parameter_specs')),
    'legacyMappingIds',to_jsonb(parameter_catalog.definition_purge_ids(targets,'parameter_catalog.legacy_mapping_versions')),
    'planeArchives',plane_archives,'catalogArchives',catalog_archives);
end;
$$;

create or replace function parameter_catalog.lock_parameter_definition_purge(p_id text)
returns void language plpgsql security definer set search_path=pg_catalog,parameter_catalog,catalog_publication,public as $$
begin
  if p_id is null or btrim(p_id)='' then raise exception using errcode='22023',message='Definition id is required'; end if;
  -- ponytail: global maintenance fence; split by Definition only when source
  -- writers and publication can share a narrower erasure protocol.
  perform parameter_catalog.acquire_current_pointer_lock_exclusive();
  perform catalog_publication.acquire_publication_guard_lock();
  lock table parameter_catalog.catalog_state in exclusive mode;
  lock table parameter_catalog.project_parameter_bindings,parameter_catalog.project_parameter_values,
    parameter_catalog.binding_history_events,parameter_catalog.project_parameter_source_occurrences,
    parameter_catalog.project_value_source_pins,public.project_parameter_value_drafts,
    public.project_parameter_value_change_requests,public.project_parameter_value_change_targets,
    public.project_parameter_bindings,public.parameter_specs,public.parameter_spec_versions,
    public.parameter_definitions,public.project_parameter_values,public.project_parameter_plane_archives in share row exclusive mode;
end;
$$;

create or replace function parameter_catalog.purge_parameter_definition(p_id text,p_plan jsonb,p_actor text,p_audit_id text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,parameter_catalog,public,catalog_publication as $$
declare targets jsonb; remaining jsonb; entry record; edge record; keys jsonb; ids text[]; counts jsonb:='{}';
  revision jsonb; release jsonb; artifact jsonb; control record; changes text; archive_update jsonb; pending_refs text[]:='{}';
  join_sql text; blocked boolean; progressed boolean; import_keys jsonb:='[]'; initialization_keys jsonb:='[]';
begin
  if p_actor is null or btrim(p_actor)='' or p_audit_id is null or btrim(p_audit_id)='' then
    raise exception using errcode='22023',message='Trusted erasure actor and audit id are required';
  end if;
  perform parameter_catalog.lock_parameter_definition_purge(p_id);
  if not exists(select 1 from parameter_catalog.parameter_definitions where id=p_id) then
    return coalesce((select jsonb_build_object('erased',true,'counts',counts,'pendingObjectRefs',to_jsonb(pending_object_refs)) from parameter_catalog.definition_erasures where definition_id=p_id),jsonb_build_object('erased',false,'counts','{}'::jsonb));
  end if;
  if p_plan->>'definitionId' is distinct from p_id or jsonb_typeof(p_plan->'releases')<>'array'
    or jsonb_typeof(p_plan->'artifacts')<>'array' or jsonb_typeof(p_plan->'revisions')<>'array' then
    raise exception using errcode='22023',message='Catalog erasure plan is invalid';
  end if;
  if exists(select 1 from jsonb_array_elements(p_plan->'releases') p where not exists(select 1 from parameter_catalog.catalog_releases r where p->>'id'=r.id and p->>'oldDigest'=r.release_digest))
    or exists(select 1 from parameter_catalog.catalog_release_definition_heads h where h.definition_id=p_id and not exists(select 1 from jsonb_array_elements(p_plan->'releases') p where p->>'id'=h.release_id)) then
    raise exception using errcode='40001',message='Catalog erasure plan is stale';
  end if;
  for artifact in select value from jsonb_array_elements(p_plan->'artifacts') loop
    if coalesce((artifact->>'create')::boolean,false) then
      if not exists(select 1 from parameter_catalog.catalog_releases r where r.id=artifact->>'targetReleaseId'
        and exists(select 1 from jsonb_array_elements(p_plan->'releases') p where p->>'id'=r.id and p->>'oldDigest'=r.release_digest)) then
        raise exception using errcode='40001',message='New artifact erasure source is stale';
      end if;
    elsif not exists(select 1 from catalog_publication.release_artifacts a where a.id=artifact->>'id' and a.artifact_digest=artifact->>'oldDigest') then
      raise exception using errcode='40001',message='Catalog artifact erasure plan is stale';
    end if;
    if 'sha256:'||encode(sha256(decode(artifact->>'artifactBytesBase64','base64')),'hex') is distinct from artifact->>'bytesChecksum' then
      raise exception using errcode='22023',message='Catalog artifact erasure bytes are invalid';
    end if;
  end loop;
  for revision in select value from jsonb_array_elements(p_plan->'revisions') loop
    if not exists(select 1 from parameter_catalog.definition_revisions r where r.id=revision->>'id' and r.definition_id<>p_id and r.content_digest=revision->>'oldContentDigest') then
      raise exception using errcode='40001',message='Catalog revision erasure plan is stale';
    end if;
  end loop;
  set constraints all deferred;
  delete from parameter_catalog.definition_purge_rows where transaction_id<>txid_current();
  targets:=parameter_catalog.definition_purge_closure(p_id);
  if exists(select 1 from parameter_catalog.parameter_catalog_archives a
    where a.id=any(parameter_catalog.definition_purge_ids(targets,'parameter_catalog.parameter_catalog_archives'))
      and not exists(select 1 from jsonb_array_elements(coalesce(p_plan->'archiveErasure'->'catalogDeletes','[]')) item where item->>'id'=a.id and item->>'oldObjectRef'=a.encrypted_object_ref)) then
    raise exception using errcode='22023',message='Catalog erasure requires validated cleanup of its owned encrypted archives';
  end if;
  for archive_update in select value from jsonb_array_elements(coalesce(p_plan->'archiveErasure'->'planeUpdates','[]')) loop
    if not exists(select 1 from public.project_parameter_plane_archives a where a.id=archive_update->>'id' and a.object_ref=archive_update->>'oldObjectRef')
      or coalesce(archive_update->>'newObjectRef','')='' then
      raise exception using errcode='40001',message='Parameter plane archive erasure plan is stale';
    end if;
    update public.project_parameter_plane_archives set object_ref=archive_update->>'newObjectRef',content_digest=archive_update->>'contentDigest',
      archive_digest=archive_update->>'archiveDigest',counts=archive_update->'counts' where id=archive_update->>'id';
    update parameter_catalog.plane_disposal_runs set archive_digest=archive_update->>'archiveDigest' where archive_id=archive_update->>'id';
    pending_refs:=array_append(pending_refs,'plane::'||(archive_update->>'oldObjectRef'));
  end loop;
  for archive_update in select value from jsonb_array_elements(coalesce(p_plan->'archiveErasure'->'catalogDeletes','[]')) loop
    if not exists(select 1 from parameter_catalog.parameter_catalog_archives a where a.id=archive_update->>'id' and a.encrypted_object_ref=archive_update->>'oldObjectRef'
      and a.id=any(parameter_catalog.definition_purge_ids(targets,'parameter_catalog.parameter_catalog_archives'))) then
      raise exception using errcode='40001',message='Catalog archive erasure plan is stale';
    end if;
    pending_refs:=array_append(pending_refs,'catalog::'||(archive_update->>'oldObjectRef'));
  end loop;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p_plan->'archiveErasure'->'pendingObjectRefs','[]')) r where not(r=any(pending_refs))) then
    raise exception using errcode='22023',message='Erasure cleanup references are outside the archive plan';
  end if;
  select coalesce(array_agg(distinct coalesce(k->>'id',k->>'draft_id')) filter(where coalesce(k->>'id',k->>'draft_id') is not null),'{}') into ids
    from jsonb_each(targets) t cross join jsonb_array_elements(t.value) k;
  for entry in select key relation_name,value keys from jsonb_each(targets) loop
    perform parameter_catalog.definition_purge_mark(entry.relation_name::regclass,entry.keys,'DELETE');
    counts:=counts||jsonb_build_object(entry.relation_name,jsonb_array_length(entry.keys));
  end loop;
  -- Revoke the original approval tuple before changing candidate bytes or its
  -- proposal linkage. Original approve/revoke hashes remain historical facts.
  insert into catalog_publication.publication_authorizations(id,event_kind,candidate_id,artifact_digest,expected_base_release_id,expected_base_release_digest,
    proposal_revision_id,impact_report_digest,capability_contract_digest,policy_revision,actor_principal_id,approved_authorization_id)
  select 'cauth_erasure_'||md5(p_audit_id||a.id),'revoke',a.candidate_id,a.artifact_digest,a.expected_base_release_id,a.expected_base_release_digest,
    a.proposal_revision_id,a.impact_report_digest,a.capability_contract_digest,a.policy_revision,p_actor,a.id
  from catalog_publication.publication_authorizations a where a.event_kind='approve'
    and a.candidate_id in(select c.id from catalog_publication.candidates c join jsonb_array_elements(p_plan->'artifacts') item on c.artifact_id=item->>'id' where item->>'oldDigest' is distinct from item->>'newDigest')
    and not exists(select 1 from catalog_publication.publication_authorizations revoked where revoked.event_kind='revoke' and revoked.approved_authorization_id=a.id);
  select coalesce(jsonb_agg(parameter_catalog.definition_purge_key('catalog_publication.candidates',to_jsonb(c))),'[]') into keys
    from catalog_publication.candidates c where c.proposal_id=any(parameter_catalog.definition_purge_ids(targets,'parameter_catalog.definition_proposals'))
      or c.proposal_revision_id=any(parameter_catalog.definition_purge_ids(targets,'parameter_catalog.definition_proposal_revisions'));
  perform parameter_catalog.definition_purge_mark('catalog_publication.candidates',keys,'UPDATE');
  update catalog_publication.candidates set proposal_id=null,proposal_revision_id=null
    where proposal_id=any(parameter_catalog.definition_purge_ids(targets,'parameter_catalog.definition_proposals'))
      or proposal_revision_id=any(parameter_catalog.definition_purge_ids(targets,'parameter_catalog.definition_proposal_revisions'));
  -- Only provenance is removed from surviving, carried-forward values.
  select coalesce(jsonb_agg(parameter_catalog.definition_purge_key('parameter_catalog.project_parameter_values',to_jsonb(v))),'[]') into keys
    from parameter_catalog.project_parameter_values v where v.definition_id<>p_id and v.replaced_from_definition_id=p_id;
  perform parameter_catalog.definition_purge_mark('parameter_catalog.project_parameter_values',keys,'UPDATE');
  update parameter_catalog.project_parameter_values set replaced_from_value_id=null,replaced_from_definition_id=null
    where definition_id<>p_id and replaced_from_definition_id=p_id;
  select coalesce(jsonb_agg(parameter_catalog.definition_purge_key('parameter_catalog.binding_history_events',to_jsonb(h))),'[]') into keys
    from parameter_catalog.binding_history_events h where h.applied_request_id=any(parameter_catalog.definition_purge_ids(targets,'public.project_parameter_value_change_requests'));
  perform parameter_catalog.definition_purge_mark('parameter_catalog.binding_history_events',keys,'UPDATE');
  update parameter_catalog.binding_history_events set applied_request_id=null where applied_request_id=any(parameter_catalog.definition_purge_ids(targets,'public.project_parameter_value_change_requests'));
  select coalesce(jsonb_agg(parameter_catalog.definition_purge_key('parameter_catalog.project_value_source_pins',to_jsonb(pin))),'[]') into keys
    from parameter_catalog.project_value_source_pins pin where pin.definition_id<>p_id
      and pin.delete_request_id=any(parameter_catalog.definition_purge_ids(targets,'public.project_parameter_value_change_requests'));
  perform parameter_catalog.definition_purge_mark('parameter_catalog.project_value_source_pins',keys,'UPDATE');
  update parameter_catalog.project_value_source_pins set delete_request_id=null,erased_request_audit_id=p_audit_id,
    delete_proof=jsonb_build_object('kind','definition-erasure','auditEventId',p_audit_id)
    where definition_id<>p_id and delete_request_id=any(parameter_catalog.definition_purge_ids(targets,'public.project_parameter_value_change_requests'));
  update public.debugging_snapshots set operation_id=null where operation_id=any(parameter_catalog.definition_purge_ids(targets,'public.node_operations'));
  update public.node_operations set related_operation_id=null where related_operation_id=any(parameter_catalog.definition_purge_ids(targets,'public.node_operations'));
  select coalesce(jsonb_agg(parameter_catalog.definition_purge_key('parameter_catalog.project_source_member_tombstones',to_jsonb(t))),'[]') into keys
    from parameter_catalog.project_source_member_tombstones t where t.audit_event_id=any(parameter_catalog.definition_purge_ids(targets,'public.audit_events'));
  perform parameter_catalog.definition_purge_mark('parameter_catalog.project_source_member_tombstones',keys,'UPDATE');
  update parameter_catalog.project_source_member_tombstones set audit_event_id=p_audit_id
    where audit_event_id=any(parameter_catalog.definition_purge_ids(targets,'public.audit_events'));

  -- Structured snapshots are shared. Leave raw files and parsed_index intact.
  for control in select * from (values
    ('public.project_parameter_initialization_drafts','binding_snapshots'),('public.project_parameter_initialization_drafts','selected_source_binding_ids'),
    ('public.project_parameter_file_candidates','impact'),('public.project_parameter_file_candidates','blockers'),
    ('public.project_parameter_file_candidates','frozen_binding_manifest'),('public.project_parameter_file_candidates','source_revision_context'),
    ('public.debugging_snapshots','entries'),('public.debugging_events','metadata'),('public.node_operations','canonical_pin'),
    ('public.dts_reload_runs','reload_snapshot'),('public.dts_reload_runs','steps'),('public.dts_reload_runs','diagnostics'),
    ('public.dts_reload_device_residue','parameters'),('public.audit_events','metadata'),
    ('public.parameter_definition_reconciliation_runs','report'),('public.parameter_definition_reconciliation_items','evidence'),
    ('public.parameter_spec_review_tasks','source_evidence'),('public.parameter_spec_review_tasks','candidate_schemas'),
    ('public.parameter_spec_versions','reference_rules'),('public.parameter_import_batches','summary'),('public.parameter_import_batches','items'),
    ('parameter_catalog.project_source_member_tombstones','binding_manifest'),('parameter_catalog.project_source_member_tombstones','successor_binding_manifest'),
    ('parameter_catalog.parameter_catalog_cutover_checkpoints','payload'),('parameter_catalog.parameter_catalog_cutover_events','payload'),
    ('parameter_catalog.parameter_catalog_comparison_results','evidence'),
    ('catalog_publication.candidates','identity_allocation'),('catalog_publication.candidates','capability_contract')
  ) controls(relation_name,column_name) loop
    if not exists(select 1 from pg_attribute where attrelid=control.relation_name::regclass and attname=control.column_name and not attisdropped) then continue; end if;
    execute format('select coalesce(jsonb_agg(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r))),''[]'') from %s r where r.%I is not null and r.%I is distinct from coalesce(parameter_catalog.definition_purge_json(r.%I,$1),case jsonb_typeof(r.%I) when ''array'' then ''[]''::jsonb else ''{}''::jsonb end)',
      control.relation_name,control.relation_name,control.column_name,control.column_name,control.column_name,control.column_name) into keys using ids;
    perform parameter_catalog.definition_purge_mark(control.relation_name::regclass,keys,'UPDATE');
    if control.relation_name='public.parameter_import_batches' and control.column_name='items' then import_keys:=keys; end if;
    if control.relation_name='public.project_parameter_initialization_drafts' and control.column_name='binding_snapshots' then initialization_keys:=keys; end if;
    execute format('update %s r set %I=coalesce(parameter_catalog.definition_purge_json(r.%I,$1),case jsonb_typeof(r.%I) when ''array'' then ''[]''::jsonb else ''{}''::jsonb end) where $2 @> jsonb_build_array(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r)))',
      control.relation_name,control.column_name,control.column_name,control.column_name,control.relation_name) using ids,keys;
  end loop;
  update public.parameter_import_batches b set summary=(b.summary-array['added','updated','unchanged','conflict','highRisk','staged','stagedItemIds'])||(
    select jsonb_build_object('added',count(*) filter(where item->>'classification'='added'),
      'updated',count(*) filter(where item->>'classification'='updated'),'unchanged',count(*) filter(where item->>'classification'='unchanged'),
      'conflict',count(*) filter(where item->>'classification'='conflict'),'highRisk',count(*) filter(where item->>'riskFlag'='true'),
      'staged',count(*) filter(where item->'stagedDraft' is not null),'stagedItemIds',coalesce(jsonb_agg(item->'id') filter(where item->'stagedDraft' is not null),'[]'))
    from jsonb_array_elements(b.items) item) where import_keys @> jsonb_build_array(parameter_catalog.definition_purge_key('public.parameter_import_batches',to_jsonb(b)));
  update public.project_parameter_initialization_drafts set empty_library=true where binding_snapshots='[]' and not empty_library
    and (selected_source_binding_ids='[]' or selected_source_binding_ids is null)
    and initialization_keys @> jsonb_build_array(jsonb_build_object('id',id));
  -- Keep ordinary RESTRICT policies. Delete selected children before parents;
  -- only the named back-pointer cycles below are deferred by this migration.
  remaining:=targets;
  while remaining<>'{}' loop
    progressed:=false;
    for entry in select key relation_name,value keys from jsonb_each(remaining) order by key loop
      blocked:=false;
      for edge in select fk.*,child_ns.nspname||'.'||child.relname child_name from pg_constraint fk
        join pg_class child on child.oid=fk.conrelid join pg_namespace child_ns on child_ns.oid=child.relnamespace
        where fk.contype='f' and fk.confrelid=entry.relation_name::regclass and fk.conrelid<>fk.confrelid
          and (fk.confdeltype='r' or not fk.condeferrable) and remaining ? (child_ns.nspname||'.'||child.relname)
      loop
        select string_agg(format('c.%I=p.%I',ca.attname,pa.attname),' and ' order by columns.ordinal) into join_sql
          from unnest(edge.conkey,edge.confkey) with ordinality columns(child_att,parent_att,ordinal)
          join pg_attribute ca on ca.attrelid=edge.conrelid and ca.attnum=columns.child_att
          join pg_attribute pa on pa.attrelid=edge.confrelid and pa.attnum=columns.parent_att;
        execute format('select exists(select 1 from %s c join %s p on %s where $1 @> jsonb_build_array(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(c))) and $2 @> jsonb_build_array(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(p))))',
          edge.child_name,entry.relation_name,join_sql,edge.child_name,entry.relation_name) into blocked using remaining->edge.child_name,entry.keys;
        exit when blocked;
      end loop;
      if blocked then continue; end if;
      execute format('delete from %s r where $1 @> jsonb_build_array(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r)))',entry.relation_name,entry.relation_name) using entry.keys;
      remaining:=remaining-entry.relation_name;
      progressed:=true;
    end loop;
    if not progressed then raise exception using errcode='23503',message='Definition erasure has an unsupported dependency cycle'; end if;
  end loop;

  -- Mark the remaining Catalog metadata that must be rewritten consistently.
  for control in select * from (values
    ('parameter_catalog.catalog_releases','r.id in(select p->>''id'' from jsonb_array_elements($1->''releases'') p)'),
    ('parameter_catalog.catalog_materializations','r.release_id in(select p->>''id'' from jsonb_array_elements($1->''releases'') p)'),
    ('parameter_catalog.catalog_activation_receipts','r.release_id in(select p->>''id'' from jsonb_array_elements($1->''releases'') p) or r.predecessor_release_id in(select p->>''id'' from jsonb_array_elements($1->''releases'') p)'),
    ('catalog_publication.release_artifacts','r.id in(select p->>''id'' from jsonb_array_elements($1->''artifacts'') p)'),
    ('catalog_publication.candidates','r.artifact_id in(select p->>''id'' from jsonb_array_elements($1->''artifacts'') p) or r.expected_base_release_id in(select p->>''id'' from jsonb_array_elements($1->''releases'') p)'),
    ('catalog_publication.publication_jobs','r.candidate_id in(select c.id from catalog_publication.candidates c where c.artifact_id in(select p->>''id'' from jsonb_array_elements($1->''artifacts'') p))'),
    ('parameter_catalog.definition_revisions','r.id in(select p->>''id'' from jsonb_array_elements($1->''revisions'') p)')
  ) plans(relation_name,predicate) loop
    execute format('select coalesce(jsonb_agg(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r))),''[]'') from %s r where %s',control.relation_name,control.relation_name,control.predicate) into keys using p_plan;
    perform parameter_catalog.definition_purge_mark(control.relation_name::regclass,keys,'UPDATE');
  end loop;
  for revision in select value from jsonb_array_elements(p_plan->'revisions') loop
    update parameter_catalog.definition_revisions set content=revision->'content',content_digest=revision->>'contentDigest' where id=revision->>'id';
  end loop;
  for release in select value from jsonb_array_elements(p_plan->'releases') loop
    update parameter_catalog.catalog_releases set release_digest=release->>'newDigest',compiled_model_digest=release->>'compiledModelDigest',toolchain_digest=release->>'toolchainDigest' where id=release->>'id';
    update parameter_catalog.catalog_materializations set compiled_fingerprint=release->>'materializationFingerprint',database_fingerprint=release->>'materializationFingerprint' where release_id=release->>'id';
    update parameter_catalog.catalog_activation_receipts set release_digest=release->>'newDigest' where release_id=release->>'id';
    update parameter_catalog.catalog_activation_receipts set predecessor_release_digest=release->>'newDigest' where predecessor_release_id=release->>'id';
    update catalog_publication.candidates set expected_base_release_digest=release->>'newDigest' where expected_base_release_id=release->>'id';
  end loop;
  for artifact in select value from jsonb_array_elements(p_plan->'artifacts') loop
    if coalesce((artifact->>'create')::boolean,false) then
      insert into catalog_publication.release_artifacts(id,artifact_digest,bytes_checksum,artifact_bytes,source_kind,target_release_id,target_release_digest,predecessor_release_id,predecessor_release_digest,toolchain)
      values(artifact->>'id',artifact->>'newDigest',artifact->>'bytesChecksum',decode(artifact->>'artifactBytesBase64','base64'),'repository-bundle',artifact->>'targetReleaseId',
        artifact->>'newDigest',artifact->>'predecessorReleaseId',artifact->>'predecessorReleaseDigest',artifact->'toolchain');
    else
      update catalog_publication.release_artifacts set artifact_digest=artifact->>'newDigest',bytes_checksum=artifact->>'bytesChecksum',artifact_bytes=decode(artifact->>'artifactBytesBase64','base64'),
        target_release_digest=artifact->>'newDigest',
        predecessor_release_id=artifact->>'predecessorReleaseId',predecessor_release_digest=artifact->>'predecessorReleaseDigest' where id=artifact->>'id';
    end if;
    update catalog_publication.candidates set artifact_digest=artifact->>'newDigest' where artifact_id=artifact->>'id';
  end loop;
  -- Original approvals never authorize the rebuilt bytes. Cancel outstanding
  -- jobs and append an explicit revocation while keeping completed history.
  update catalog_publication.publication_jobs set status='cancelled',lease_owner=null,lease_until=null,
    last_error_class='definition-erasure',last_error_reason='Catalog bytes were rebuilt after a permanent Definition erasure',updated_at=clock_timestamp()
    where status<>'active' and candidate_id in(select c.id from catalog_publication.candidates c join jsonb_array_elements(p_plan->'artifacts') a on c.artifact_id=a->>'id' where a->>'oldDigest' is distinct from a->>'newDigest');
  insert into parameter_catalog.definition_erasures(definition_id,erased_by,audit_event_id,counts,pending_object_refs,catalog_rewrite)
    values(p_id,p_actor,p_audit_id,counts,pending_refs,jsonb_build_object('releases',p_plan->'releases','artifacts',(
      select coalesce(jsonb_agg(item-'artifactBytesBase64'-'toolchain'),'[]') from jsonb_array_elements(p_plan->'artifacts') item),
      'revisions',(select coalesce(jsonb_agg(item-'content'),'[]') from jsonb_array_elements(p_plan->'revisions') item)));
  return jsonb_build_object('erased',true,'counts',counts,'pendingObjectRefs',to_jsonb(pending_refs));
end;
$$;

create function parameter_catalog.lock_parameter_plane_archive() returns void language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
begin
  if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='40001',message='Parameter plane capture requires a fresh read-committed transaction'; end if;
  perform parameter_catalog.acquire_current_pointer_lock_shared();
  -- ponytail: bounded archive capture holds a shared plane lock; streaming or
  -- snapshot export is the upgrade path for larger source planes.
  lock table public.parameter_drafts,
    public.parameter_draft_identity_invalidations,
    public.parameter_history_entries,
    public.parameter_submission_rounds,
    public.parameter_change_requests,
    public.project_parameter_bindings,
    public.project_parameter_files,
    public.project_parameter_file_candidates,
    public.project_parameter_initialization_drafts,
    public.project_parameter_initialization_reviews,
    public.parameter_import_batches,
    public.parameter_file_sync_conflicts,
    public.identity_mapping_tasks,
    public.parameter_spec_matcher_overrides,
    public.dts_property_occurrence_spec_decisions,
    public.project_parameter_value_drafts,
    public.project_parameter_value_change_requests,
    public.project_parameter_value_change_targets,
    public.parameter_review_decisions,
    public.parameter_submission_items,
    public.project_parameter_binding_revisions,
    public.project_parameter_file_versions,
    public.dts_config_set,
    public.dts_release_baseline,
    public.dts_release_baseline_members,
    public.dts_config_revisions,
    public.dts_config_revision_members,
    public.dts_logical_nodes,
    public.dts_logical_node_revisions,
    parameter_catalog.project_parameter_bindings,
    parameter_catalog.project_parameter_source_occurrences,
    parameter_catalog.project_value_source_pins,
    parameter_catalog.binding_history_events,
    parameter_catalog.project_parameter_values,
    public.project_parameter_values in share mode;
end;
$$;
alter function parameter_catalog.lock_parameter_plane_archive() owner to catalog_migration_owner;
revoke all on function parameter_catalog.lock_parameter_plane_archive() from public;

create function parameter_catalog.definition_erasure_object_is_referenced(p_store text,p_ref text) returns boolean language plpgsql stable security definer set search_path=pg_catalog,parameter_catalog,public as $$
begin
  if p_store='catalog' then return exists(select 1 from parameter_catalog.parameter_catalog_archives where encrypted_object_ref=p_ref);
  elsif p_store='plane' then return
    exists(select 1 from public.project_parameter_plane_archives where object_ref=p_ref) or
    exists(select 1 from public.project_parameter_file_versions where storage_key=p_ref) or
    exists(select 1 from public.project_parameter_file_candidates where storage_key=p_ref) or
    exists(select 1 from public.dts_reload_runs where overlay_source_storage_key=p_ref or overlay_artifact_storage_key=p_ref) or
    exists(select 1 from public.knowledge_files where storage_key=p_ref) or
    exists(select 1 from public.log_file_objects where storage_key=p_ref) or
    exists(select 1 from public.log_source_snapshots where storage_key=p_ref) or
    exists(select 1 from public.product_feedback_attachments where storage_key=p_ref);
  else raise exception using errcode='22023',message='Unknown Definition erasure object store'; end if;
end;
$$;
alter function parameter_catalog.definition_erasure_object_is_referenced(text,text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.definition_erasure_object_is_referenced(text,text) from public;
grant execute on function parameter_catalog.lock_parameter_plane_archive(),parameter_catalog.definition_erasure_object_is_referenced(text,text) to parameter_governance_writer_role;
