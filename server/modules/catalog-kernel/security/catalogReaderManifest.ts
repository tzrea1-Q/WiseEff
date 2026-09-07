/** Versioned additive capability. Historical 0138 grant manifest stays intact. */
export const CATALOG_READER_ROLE = "catalog_runtime_reader_role";
export const CATALOG_READER_MIGRATION = "0140_parameter_catalog_runtime_reader.sql";
export const CATALOG_READER_QUERY_MANIFEST = [
  { caller: "loadCurrentCatalog", query: "current pointer", relations: ["parameter_catalog.catalog_state", "parameter_catalog.catalog_releases"] },
  { caller: "loadCurrentCatalog/loadPinnedCatalog", query: "release/materialization/lineage", relations: ["parameter_catalog.catalog_releases", "parameter_catalog.catalog_materializations"] },
  { caller: "loadCurrentCatalog/loadPinnedCatalog", query: "subject projection", relations: ["parameter_catalog.catalog_release_subjects", "parameter_catalog.catalog_subjects"] },
  { caller: "loadCurrentCatalog/loadPinnedCatalog", query: "alias projection", relations: ["parameter_catalog.catalog_release_subject_aliases", "parameter_catalog.catalog_subject_aliases"] },
  { caller: "loadCurrentCatalog/loadPinnedCatalog", query: "definition heads/history", relations: ["parameter_catalog.catalog_release_definition_heads", "parameter_catalog.parameter_definitions", "parameter_catalog.definition_revisions", "parameter_catalog.catalog_releases"] },
] as const;
export const CATALOG_READER_RELATIONS = [...new Set(CATALOG_READER_QUERY_MANIFEST.flatMap(query => [...query.relations]))].sort();
export const CATALOG_READER_MEMBERSHIP = { inherit: true, set: false, admin: false } as const;
