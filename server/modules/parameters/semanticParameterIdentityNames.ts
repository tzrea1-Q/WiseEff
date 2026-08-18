/**
 * Post-cutover semantic parameter identity SQL fragments.
 * Dashboard and activity reads after cutover must use these tables/expressions only.
 */
import { PINNED_OR_RANKED_SPEC_VERSION_LATERAL } from "./specVersionSelection";
export const SEMANTIC_IDENTITY_SQL = {
  specsTable: "parameter_specs",
  specVersionsTable: "parameter_spec_versions",
  bindingsTable: "project_parameter_bindings",
  bindingRevisionsTable: "project_parameter_binding_revisions"
} as const;

/** Driver/module segment for dashboard grouping and KPI filters. */
export const SEMANTIC_MODULE_EXPR = `
  coalesce(
    nullif(ps.semantic_module, ''),
    case
      when cardinality(string_to_array(ps.specification_key, '/')) >= 3
        then (string_to_array(ps.specification_key, '/'))[cardinality(string_to_array(ps.specification_key, '/')) - 1]
      else split_part(ps.specification_key, '/', 1)
    end
  )
`;

/** Human title for hotspot and workflow surfaces. */
export const SEMANTIC_TITLE_EXPR = `
  coalesce(
    nullif(dps.property_key, ''),
    nullif(psv.display_name, ''),
    nullif(split_part(ps.specification_key, '/', 2), ''),
    ps.specification_key
  )
`;

/** Risk tier stored on the spec; policy targets may override later. */
export const SEMANTIC_RISK_EXPR = `coalesce(nullif(ps.risk, ''), 'Low')`;

/**
 * Post-cutover tenant scope for dashboard aggregations.
 * Bindings carry the org boundary; global vendor specs keep organization_id null.
 */
export const SEMANTIC_BINDING_ORG_SCOPE = `b.organization_id = $1`;

/** Pin to the binding revision when one is in scope; otherwise rank version_status. */
export const SEMANTIC_ACTIVE_SPEC_VERSION_LATERAL = PINNED_OR_RANKED_SPEC_VERSION_LATERAL;
