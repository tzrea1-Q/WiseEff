import * as XLSX from "xlsx";
import type { ParameterRecord } from "../../mockData";
import { riskLabels } from "../../workbenchUi";

const PARAMETER_EXPORT_HEADERS = [
  "参数名称",
  "模块",
  "当前值",
  "推荐值",
  "范围 / 单位",
  "重要性",
  "更新时间"
] as const;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function formatParameterUpdatedAt(updatedAt: string) {
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) {
    return updatedAt;
  }

  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function buildProjectParametersSheetRows(rows: ParameterRecord[]) {
  return [
    [...PARAMETER_EXPORT_HEADERS],
    ...rows.map((parameter) => [
      parameter.name,
      parameter.module,
      parameter.currentValue,
      parameter.recommendedValue,
      `${parameter.range} ${parameter.unit}`.trim(),
      riskLabels[parameter.risk],
      formatParameterUpdatedAt(parameter.updatedAt)
    ])
  ];
}

export function buildProjectParametersWorkbook(rows: ParameterRecord[]) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(buildProjectParametersSheetRows(rows));
  XLSX.utils.book_append_sheet(workbook, worksheet, "参数");
  return workbook;
}

export function serializeProjectParametersWorkbook(rows: ParameterRecord[]) {
  const workbook = buildProjectParametersWorkbook(rows);
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as number[];
  return new Uint8Array(bytes);
}

export function exportProjectParametersAsExcel(
  rows: ParameterRecord[],
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
