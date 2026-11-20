-- The scoped offline reader uses the same historical owner as the Catalog API.
grant select (rules_snapshot) on parameter_catalog.catalog_release_subjects to wiseeff_mod_d02_source_reader;
