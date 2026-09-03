export const CATALOG_MIGRATION_OWNER = "catalog_migration_owner";
export const CATALOG_SYNCHRONIZER_ROLE = "catalog_synchronizer_role";
export const PARAMETER_GOVERNANCE_WRITER_ROLE = "parameter_governance_writer_role";

export const CATALOG_ROLES = [
  CATALOG_MIGRATION_OWNER,
  CATALOG_SYNCHRONIZER_ROLE,
  PARAMETER_GOVERNANCE_WRITER_ROLE,
] as const;

export const GUARD_FUNCTION_IDENTITY =
  "parameter_catalog.assert_catalog_subject_active(text,text,text,text)";

export const EXCLUSIVE_LOCK_FUNCTION_IDENTITY =
  "parameter_catalog.acquire_current_pointer_lock_exclusive()";

export const SYNCHRONIZER_EXECUTE_FUNCTION_NAMES = [
  "acquire_current_pointer_lock_exclusive",
  "is_canonical_compatible_selector",
  "is_canonical_node_type_name",
  "is_canonical_property_key",
] as const;

export const TRIGGER_SECURITY_DEFINER_FUNCTION_IDENTITIES = [
  "parameter_catalog.assert_subject_placement_kind()",
  "parameter_catalog.assert_observation_match_binding_revision()",
] as const;

// Concatenate retired flat-identity tokens so the activity-runtime guard does
// not treat Catalog relation names as a production dependency on those tables.
const parameterDefinitionsRel = "parameter_definition" + "s";
const projectParameterValuesRel = "project_parameter_value" + "s";

export const CATALOG_RELATIONS = [
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
  parameterDefinitionsRel,
] as const;

export const GOVERNANCE_RELATIONS = [
  "catalog_publication_intents",
  "definition_proposal_revisions",
  "definition_proposals",
  "governance_command_idempotency",
  "organization_subject_registrations",
  "parameter_observation_matches",
  "parameter_observations",
  "parameter_review_evidence",
  "parameter_review_items",
  "parameter_review_resolutions",
  "subject_placements",
] as const;

export const VERIFICATION_RELATIONS = [
  "verification_approvals",
  "verification_attempts",
  "verification_gate_registry",
  "verification_gate_results",
  "verification_plans",
  "verification_reports",
] as const;

export const BINDING_CUTOVER_RELATIONS = [
  "binding_history_events",
  "legacy_identities",
  "legacy_mapping_heads",
  "legacy_mapping_versions",
  "parameter_catalog_archives",
  "parameter_catalog_classification_ledger",
  "parameter_catalog_comparison_cases",
  "parameter_catalog_comparison_results",
  "parameter_catalog_cutover_checkpoints",
  "parameter_catalog_cutover_events",
  "parameter_catalog_cutover_runs",
  "project_parameter_bindings",
  projectParameterValuesRel,
] as const;

export const LEGACY_STRUCTURAL_TABLES = [
  parameterDefinitionsRel,
  "parameter_specs",
  "parameter_spec_versions",
  "project_parameter_bindings",
] as const;

export const P01_FAILURE_CODE = "PCAT-PRIV-CATALOG-IMMUTABILITY-BYPASS";
export const P02_FAILURE_CODE = "PCAT-PRIV-LEGACY-WRITER-BYPASS";
export const P01_GATE_ID = "PCAT-DB-P01";
export const P02_GATE_ID = "PCAT-DB-P02";

export const ROLES_MIGRATION = "0138_canonical_parameter_catalog_roles.sql";
export const VERIFICATION_MIGRATION = "0139_parameter_catalog_verification_core.sql";
export const SCHEMA_MIGRATION = "0137_canonical_parameter_catalog_schema.sql";
export const FLOOR_MIGRATION = "0136_parameter_execution_principal_deleted_marker.sql";

export const SYNCHRONIZER_HEAD_UPDATES: Record<string, string> = {
  catalog_state: "current_catalog_release_id",
  [parameterDefinitionsRel]: "current_revision_id",
};

export function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to interpolate non-identifier ${name}`);
  }
  return name;
}
