import type { ParameterImportSourceItem } from "@/application/ports/ParameterRepository";
import type { ParameterValueKind } from "@/powerManagementConfig";
import type { ImportSourceFormat, ParsedImportRow } from "./types";

const RISK_ALIASES: Record<string, ParameterImportSourceItem["risk"]> = {
  高: "High",
  中: "Medium",
  低: "Low",
  high: "High",
  medium: "Medium",
  low: "Low",
  High: "High",
  Medium: "Medium",
  Low: "Low"
};

const VALUE_KIND_ALIASES: Record<string, ParameterValueKind> = {
  scalar: "scalar",
  complex: "complex",
  标量: "scalar",
  复杂: "complex"
};

function normalizeRisk(value: string | undefined): ParameterImportSourceItem["risk"] | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  return RISK_ALIASES[value.trim()];
}

function normalizeValueKind(value: string | undefined): ParameterValueKind | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  return VALUE_KIND_ALIASES[value.trim()];
}

export function normalizeRow(
  partial: Partial<ParsedImportRow>,
  sourceFormat: ImportSourceFormat,
  sourceLocation?: string
): ParsedImportRow | null {
  const name = partial.name?.trim();
  if (!name) {
    return null;
  }

  const row: ParsedImportRow = {
    name,
    module: partial.module?.trim() ?? "",
    sourceFormat
  };

  if (sourceLocation) {
    row.sourceLocation = sourceLocation;
  }
  if (partial.currentValue !== undefined) {
    row.currentValue = partial.currentValue;
  }
  if (partial.recommendedValue !== undefined) {
    row.recommendedValue = partial.recommendedValue;
  }
  if (partial.range !== undefined) {
    row.range = partial.range;
  }
  if (partial.unit !== undefined) {
    row.unit = partial.unit;
  }
  if (partial.description !== undefined) {
    row.description = partial.description;
  }
  if (partial.explanation !== undefined) {
    row.explanation = partial.explanation;
  }
  if (partial.configFormat !== undefined) {
    row.configFormat = partial.configFormat;
  }
  if (partial.rawSnippet !== undefined) {
    row.rawSnippet = partial.rawSnippet;
  }
  if (partial.parseWarnings !== undefined) {
    row.parseWarnings = partial.parseWarnings;
  }

  const risk = normalizeRisk(partial.risk);
  if (risk) {
    row.risk = risk;
  }

  const valueKind = normalizeValueKind(partial.valueKind);
  if (valueKind) {
    row.valueKind = valueKind;
  }

  return row;
}
