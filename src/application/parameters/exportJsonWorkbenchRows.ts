import type { ProjectParameterBinding } from "@/domain/parameter-topology/types";

export function buildJsonWorkbenchCsv(bindings: readonly ProjectParameterBinding[]): string {
  const headers = [
    "bindingId",
    "propertyKey",
    "moduleId",
    "driverModule",
    "instanceName",
    "locator",
    "rawValue",
    "schemaState",
    "policyState"
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
    ...bindings.map((b) =>
      [
        b.id,
        b.propertyKey,
        b.moduleId ?? "",
        b.driverModule ?? "",
        b.instanceName ?? "",
        b.locator ?? "",
        b.rawValue,
        b.schemaState,
        b.policyState
      ]
        .map(escape)
        .join(",")
    )
  ];
  return `${lines.join("\n")}\n`;
}

export function downloadJsonWorkbenchCsv(
  bindings: readonly ProjectParameterBinding[],
  filename = "json-parameters-export.csv"
): void {
  if (typeof document === "undefined") return;
  const csv = buildJsonWorkbenchCsv(bindings);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
