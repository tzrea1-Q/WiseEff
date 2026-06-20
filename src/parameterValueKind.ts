import type { ParameterValueKind, PowerManagementParameterTemplate } from "./powerManagementConfig";

export type { ParameterValueKind };

export function isComplexParameter(parameter: { valueKind: ParameterValueKind }) {
  return parameter.valueKind === "complex";
}

export function getComplexParameterLineCount(value: string) {
  return value ? value.split(/\r?\n/).length : 0;
}

export function getComplexParameterKindLabel(parameter: PowerManagementParameterTemplate) {
  const format = parameter.configFormat.trim();
  if (format.startsWith("DTS")) {
    return "DTS";
  }
  if (format.includes("string-list") || format.includes("profile")) {
    return "多行列表";
  }
  return "多行配置";
}

export function complexEditorRows(value: string, minRows = 6) {
  return Math.min(Math.max(minRows, getComplexParameterLineCount(value)), 16);
}
