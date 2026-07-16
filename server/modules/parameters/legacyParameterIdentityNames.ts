/**
 * Flat parameter-identity SQL names. Post-cutover dashboard/hotspot code must use
 * semanticParameterIdentityNames instead. Literal strings live only here (+ migrations/cutovers/adapters).
 */
export const LEGACY_IDENTITY_SQL = {
  definitionsTable: "parameter_definitions",
  valuesTable: "project_parameter_values",
  recommendedValueColumn: "recommended_value"
} as const;
