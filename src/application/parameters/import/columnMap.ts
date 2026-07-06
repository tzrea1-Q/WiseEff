import type { ParsedImportRow } from "./types";

export const IMPORT_TEMPLATE_HEADERS = [
  "参数名称",
  "模块",
  "当前值",
  "推荐值",
  "范围",
  "单位",
  "重要性",
  "描述",
  "说明",
  "配置格式",
  "值类型"
] as const;

const HEADER_TO_FIELD: Record<string, keyof ParsedImportRow> = {
  参数名称: "name",
  模块: "module",
  当前值: "currentValue",
  推荐值: "recommendedValue",
  范围: "range",
  单位: "unit",
  重要性: "risk",
  描述: "description",
  说明: "explanation",
  配置格式: "configFormat",
  值类型: "valueKind",
  name: "name",
  module: "module",
  currentValue: "currentValue",
  recommendedValue: "recommendedValue",
  range: "range",
  unit: "unit",
  risk: "risk",
  description: "description",
  explanation: "explanation",
  configFormat: "configFormat",
  valueKind: "valueKind"
};

export function mapRowRecordToFields(record: Record<string, string>): Partial<ParsedImportRow> {
  const mapped: Partial<ParsedImportRow> = {};
  for (const [header, value] of Object.entries(record)) {
    const field = HEADER_TO_FIELD[header.trim()];
    if (field && value.trim()) {
      (mapped as Record<string, string>)[field] = value.trim();
    }
  }
  return mapped;
}
