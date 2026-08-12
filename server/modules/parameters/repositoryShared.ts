/**
 * Shared row-mapping and SQL-building helpers used by the parameters
 * repository modules (repository, projectRepository, reviewWorkflowRepository,
 * draftRepository, fileSyncConflictRepository, importBatchRepository).
 */

export function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

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

export function addCondition(parts: string[], values: unknown[], condition: (placeholder: string) => string, value: unknown) {
  values.push(value);
  parts.push(condition(`$${values.length}`));
}
