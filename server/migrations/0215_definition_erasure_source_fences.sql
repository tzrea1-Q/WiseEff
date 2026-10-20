-- Preserve the pre-erasure source tuple fence after table-ACL convergence.
grant update (id) on public.dts_config_revisions to catalog_migration_owner;

-- Shared current-pointer locking is an advisory protocol, not a SQL helper.
-- Acquire it before any source read in the fresh READ COMMITTED capture.
create or replace function parameter_catalog.lock_parameter_plane_archive()
returns void language plpgsql security definer
set search_path=pg_catalog,parameter_catalog,public as $$
declare previous_lock_timeout text;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='Parameter plane capture requires a fresh read-committed transaction';
  end if;
  previous_lock_timeout:=current_setting('lock_timeout');
  perform set_config('lock_timeout','2s',true);
  begin
    perform pg_advisory_xact_lock_shared(688004000041::bigint);
  exception when lock_not_available then
    perform set_config('lock_timeout',previous_lock_timeout,true);
    raise exception using errcode='PCA05',message='catalog current-pointer serialization timed out',detail='PCAT-GUARD-SYNCHRONIZATION-BUSY';
  end;
  perform set_config('lock_timeout',previous_lock_timeout,true);
  -- ponytail: the archive is bounded; streaming/snapshot export is the upgrade
  -- path if capturing larger project planes makes this shared fence too long.
  lock table public.parameter_drafts,public.project_parameter_values,public.parameter_draft_identity_invalidations,
    public.parameter_history_entries,public.parameter_submission_rounds,public.parameter_change_requests,
    public.project_parameter_bindings,public.project_parameter_files,public.project_parameter_file_candidates,
    public.project_parameter_initialization_drafts,public.project_parameter_initialization_reviews,
    public.parameter_import_batches,public.parameter_file_sync_conflicts,public.identity_mapping_tasks,
    public.parameter_spec_matcher_overrides,public.dts_property_occurrence_spec_decisions,
    public.project_parameter_value_drafts,public.project_parameter_value_change_requests,
    public.project_parameter_value_change_targets,public.parameter_review_decisions,public.parameter_submission_items,
    public.project_parameter_binding_revisions,public.project_parameter_file_versions,public.dts_config_set,
    public.dts_release_baseline,public.dts_release_baseline_members,public.dts_config_revisions,
    public.dts_config_revision_members,public.dts_logical_nodes,public.dts_logical_node_revisions,
    parameter_catalog.project_parameter_bindings,parameter_catalog.project_parameter_source_occurrences,
    parameter_catalog.project_value_source_pins,parameter_catalog.binding_history_events,
    parameter_catalog.project_parameter_values in share mode;
end;
$$;
