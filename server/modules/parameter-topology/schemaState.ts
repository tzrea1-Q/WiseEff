/** API / workbench contract for binding schema review state. */
export type BindingSchemaStateDto = "valid" | "invalid" | "unreviewed";

/**
 * Normalize stored revision schema_state into the product DTO enum.
 * Legacy ingest wrote matched/reviewed/merged for healthy bindings; treat those as valid.
 */
export function normalizeBindingSchemaState(value: string | null | undefined): BindingSchemaStateDto {
  if (value === "invalid") return "invalid";
  if (value === "valid" || value === "matched" || value === "reviewed" || value === "merged") {
    return "valid";
  }
  if (value === "unreviewed") return "unreviewed";
  return "unreviewed";
}
