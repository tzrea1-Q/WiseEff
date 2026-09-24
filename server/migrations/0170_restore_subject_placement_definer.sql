-- 0147 replaced this trigger function and reset SECURITY DEFINER to INVOKER.
-- Governance writers must pass the placement check without reading Catalog tables.
alter function parameter_catalog.assert_subject_placement_kind()
  owner to catalog_migration_owner;
alter function parameter_catalog.assert_subject_placement_kind()
  security definer;
alter function parameter_catalog.assert_subject_placement_kind()
  set search_path = pg_catalog, parameter_catalog;
revoke all on function parameter_catalog.assert_subject_placement_kind()
  from public,
       catalog_synchronizer_role,
       parameter_governance_writer_role,
       catalog_publication_coordinator_role,
       catalog_baseline_reader_role;
