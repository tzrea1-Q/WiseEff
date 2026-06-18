import type { PowerManagementParameterTemplate } from "./powerManagementConfig";

export function isComplexParameterValue(value: string) {
  return value.includes("\n") || value.length > 80;
}

export function isComplexParameter(parameter: PowerManagementParameterTemplate) {
  if (isComplexParameterValue(parameter.configFormat)) {
    return true;
  }

  for (const entry of Object.values(parameter.values)) {
    if (!entry) {
      continue;
    }
    if (isComplexParameterValue(entry.currentValue) || isComplexParameterValue(entry.recommendedValue)) {
      return true;
    }
  }

  return false;
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
