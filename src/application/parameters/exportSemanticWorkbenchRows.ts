import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";

const importanceLabels = {
  high: "高",
  medium: "中",
  low: "低"
} as const;

/**
 * Semantic/governance-oriented export — never a flat legacy Excel dump.
 * Columns stay identity-aware (module · driver · property) so same-named
 * properties remain distinguishable after download.
 */
export function buildSemanticWorkbenchCsv(rows: DtsParameterWorkbenchRow[]): string {
  const headers = [
    "bindingId",
    "propertyKey",
    "moduleName",
    "moduleMapped",
    "importance",
    "driverModule",
    "compatible",
    "instanceName",
    "rawValue",
    "governanceState",
    "schemaState",
    "policyState",
    "topologyPath",
    "sourceFileName",
    "sourceNodePath",
    "sourceLine",
    "parameterSpecId"
  ];

  const escape = (value: string | number | boolean | null | undefined) => {
    let text = value == null ? "" : String(value);
    if (/^[=+\-@]/.test(text)) {
      text = `'${text}`;
    }
    if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
    return text;
  };

  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.bindingId,
        row.propertyKey,
        row.moduleName,
        row.moduleMapped ? "mapped" : "fallback",
        importanceLabels[row.importance],
        row.driverModule,
        row.compatible,
        row.instanceName,
        row.rawValue,
        row.governanceState,
        row.schemaState,
        row.policyState,
        row.topologyPath,
        row.sourceFileName,
        row.sourceNodePath,
        row.sourceLine,
        row.parameterSpecId
      ]
        .map(escape)
        .join(",")
    )
  ];
  return `${lines.join("\n")}\n`;
}

export function downloadSemanticWorkbenchCsv(
  rows: DtsParameterWorkbenchRow[],
  filename = "parameter-workbench-export.csv"
): void {
  if (typeof document === "undefined") return;
  const csv = buildSemanticWorkbenchCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
