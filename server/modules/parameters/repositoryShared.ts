/**
 * Shared row-mapping helpers used by the parameters repository modules
 * (repository, reviewWorkflowRepository).
 */

export function resolveParameterValueKind(row: { value_kind?: string | null; config_format: string }) {
  if (row.value_kind === "complex" || row.value_kind === "scalar") {
    return row.value_kind;
  }

  const format = row.config_format.trim();
  if (format.startsWith("DTS:") || format.toLowerCase().includes("string-list")) {
    return "complex";
  }

  return "scalar";
}
