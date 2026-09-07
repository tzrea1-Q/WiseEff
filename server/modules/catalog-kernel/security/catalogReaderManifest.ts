/** Versioned additive capability. Historical 0138 grant manifest stays intact. */
export const CATALOG_READER_ROLE = "catalog_runtime_reader_role";
export const CATALOG_READER_MIGRATION = "0140_parameter_catalog_runtime_reader.sql";
export const CATALOG_READER_QUERY_MANIFEST = [
  { caller: "loadCurrentCatalog", query: "current pointer", relations: ["catalog_state", "catalog_releases"] },
  { caller: "loadCurrentCatalog/loadPinnedCatalog", query: "release/materialization/lineage", relations: ["catalog_releases", "catalog_materializations"] },
  { caller: "loadCurrentCatalog/loadPinnedCatalog", query: "subject projection", relations: ["catalog_release_subjects", "catalog_subjects"] },
  { caller: "loadCurrentCatalog/loadPinnedCatalog", query: "alias projection", relations: ["catalog_release_subject_aliases", "catalog_subject_aliases"] },
  { caller: "loadCurrentCatalog/loadPinnedCatalog", query: "definition heads/history", relations: ["catalog_release_definition_heads", "parameter_definitions", "definition_revisions", "catalog_releases"] },
] as const;
export const CATALOG_READER_RELATIONS = [...new Set(CATALOG_READER_QUERY_MANIFEST.flatMap(query => [...query.relations]))].sort();
export const CATALOG_READER_MEMBERSHIP = { inherit: true, set: false, admin: false } as const;
