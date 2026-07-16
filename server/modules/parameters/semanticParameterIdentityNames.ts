/**
 * Post-cutover semantic parameter identity SQL fragments.
 * Dashboard and activity reads after cutover must use these tables/expressions only.
 */
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

/** Active spec version lateral join used by dashboard aggregations. */
export const SEMANTIC_ACTIVE_SPEC_VERSION_LATERAL = `
  left join lateral (
    select psv.*
    from ${SEMANTIC_IDENTITY_SQL.specVersionsTable} psv
    where psv.parameter_spec_id = ps.id
    order by case when psv.lifecycle = 'active' then 0 else 1 end, psv.version desc
    limit 1
  ) psv on true
`;
