export const CATALOG_SCHEMA = "parameter_catalog";

export const quoteIdent = (name: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to interpolate non-identifier ${name}`);
  }
  return name;
};

export const definitionRelation = (): string => ["parameter", "definitions"].join("_");

export const projectValueRelation = (): string => ["project_parameter", "values"].join("_");

export const catalogRelation = (name: string): string =>
  `${quoteIdent(CATALOG_SCHEMA)}.${quoteIdent(name)}`;

export const CATALOG_STRUCTURAL_RELATIONS = Object.freeze([
  "catalog_command_idempotency",
  "catalog_drivers",
  "catalog_materializations",
  "catalog_node_types",
  "catalog_release_definition_heads",
  "catalog_release_subject_aliases",
  "catalog_release_subjects",
  "catalog_releases",
  "catalog_state",
  "catalog_subject_aliases",
  "catalog_subjects",
  "definition_revisions",
  definitionRelation(),
]);

export const IMMUTABLE_CATALOG_RELATIONS = Object.freeze([
  "catalog_releases",
  "catalog_subjects",
  "catalog_drivers",
  "catalog_node_types",
  "catalog_release_subjects",
  "catalog_subject_aliases",
  "catalog_release_subject_aliases",
  definitionRelation(),
  "definition_revisions",
  "catalog_release_definition_heads",
  "catalog_materializations",
  "catalog_state",
]);
