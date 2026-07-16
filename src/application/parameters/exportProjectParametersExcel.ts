import * as XLSX from "xlsx";
import type { ProjectParameterBinding } from "@/domain/parameter-topology/types";

const PARAMETER_EXPORT_HEADERS = [
  "属性键",
  "驱动模块",
  "实例",
  "定位符",
  "生效值",
  "Schema 版本"
] as const;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type ParameterExportRow = Pick<
  ProjectParameterBinding,
  "propertyKey" | "driverModule" | "instanceName" | "locator" | "effectiveValue"
> & {
  schemaVersion?: string | number | null;
};

function formatEffectiveValue(value: ProjectParameterBinding["effectiveValue"]): string {
  if (value.kind === "boolean") return "true";
  if (value.kind === "empty") return "";
  if (value.kind === "strings") return value.values.join(", ");
  if (value.kind === "bytes") return value.values.map((item) => String(item)).join(" ");
  if (value.kind === "cells") {
    return value.groups
      .map((group) =>
        group
          .map((cell) => (cell.kind === "integer" ? cell.raw || cell.value : cell.label))
          .join(" ")
      )
      .join(" | ");
  }
  return value.segments
    .map((segment) => {
      if (segment.kind === "string") return segment.value;
      return segment.cells
        .map((cell) => (cell.kind === "integer" ? cell.raw || cell.value : cell.label))
        .join(" ");
    })
    .join(" ");
}

export function buildProjectParametersSheetRows(rows: ParameterExportRow[]) {
  return [
    [...PARAMETER_EXPORT_HEADERS],
    ...rows.map((parameter) => [
      parameter.propertyKey,
      parameter.driverModule ?? "",
      parameter.instanceName ?? "",
      parameter.locator ?? "",
      formatEffectiveValue(parameter.effectiveValue),
      parameter.schemaVersion == null ? "" : String(parameter.schemaVersion)
    ])
  ];
}

export function buildProjectParametersWorkbook(rows: ParameterExportRow[]) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(buildProjectParametersSheetRows(rows));
  XLSX.utils.book_append_sheet(workbook, worksheet, "参数");
  return workbook;
}

export function serializeProjectParametersWorkbook(rows: ParameterExportRow[]) {
  const workbook = buildProjectParametersWorkbook(rows);
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as number[];
  return new Uint8Array(bytes);
}

export function exportProjectParametersAsExcel(
  rows: ParameterExportRow[],
  projectCode: string,
  options?: { returnBuffer?: boolean }
) {
  const buffer = serializeProjectParametersWorkbook(rows);

  if (options?.returnBuffer) {
    return buffer;
  }
  if (typeof window === "undefined") {
    return buffer;
  }

  const blob = new Blob([buffer], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${projectCode}-project-parameters.xlsx`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
