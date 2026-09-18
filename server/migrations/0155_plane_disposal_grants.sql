-- T2.3b follow-up: disposer must DELETE captured public/catalog residue.
-- 0154 stays byte-stable after first helper apply.

grant delete on
  public.parameter_drafts,
  public.project_parameter_values,
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
  public.dts_node_occurrences,
  public.dts_property_occurrences,
  public.dts_occurrence_effects,
  public.dts_nodes,
  public.dts_properties,
  public.dts_phandle_refs,
  public.dts_validation_runs,
  public.dts_validation_diagnostics
to catalog_migration_owner;

grant delete on
  parameter_catalog.project_parameter_bindings,
  parameter_catalog.project_parameter_source_occurrences,
  parameter_catalog.project_value_source_pins,
  parameter_catalog.binding_history_events,
  parameter_catalog.project_parameter_values
to catalog_migration_owner;

grant update (binding_id, disposed_binding_id) on public.dts_reload_run_targets to catalog_migration_owner;
grant execute on function parameter_catalog.plane_disposal_allows_delete(text, text, text) to public;
