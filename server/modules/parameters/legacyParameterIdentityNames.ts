/**
 * Flat parameter-identity SQL names. Production activity code must import these
 * constants rather than embedding retired table/column literals.
 * literal strings live only here (+ migrations/cutovers/adapters).
 */
export const LEGACY_IDENTITY_SQL = {
  definitionsTable: "parameter_definitions",
  valuesTable: "project_parameter_values",
  recommendedValueColumn: "recommended_value"
} as const;
