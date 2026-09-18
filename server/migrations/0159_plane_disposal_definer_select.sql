-- T3.1: disposer SECURITY DEFINER must SELECT every public relation it names.

grant select on
  public.dts_nodes,
  public.dts_phandle_refs,
  public.dts_properties,
  public.dts_release_baseline,
  public.dts_release_baseline_members,
  public.dts_validation_diagnostics,
  public.dts_validation_runs,
  public.identity_mapping_tasks,
  public.parameter_draft_identity_invalidations,
  public.project_parameter_value_drafts
to catalog_migration_owner;
