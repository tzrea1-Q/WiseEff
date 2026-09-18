-- T2.3b: disposer deletes regenerable parse trees before residue file versions.

grant delete on
  public.dts_nodes,
  public.dts_properties,
  public.dts_phandle_refs,
  public.dts_node_occurrences,
  public.dts_property_occurrences,
  public.dts_occurrence_effects,
  public.dts_validation_runs,
  public.dts_validation_diagnostics
to catalog_migration_owner;
