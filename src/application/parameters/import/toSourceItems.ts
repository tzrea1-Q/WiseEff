import type { ParameterImportSourceItem } from "@/application/ports/ParameterRepository";
import type { ReviewedImportRow } from "./types";

const ELIGIBLE_ROW_STATUSES = new Set<ReviewedImportRow["status"]>(["approved", "new-confirmed"]);
const IMPORT_FIELD_PLACEHOLDER = "—";

function normalizeRequiredField(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : IMPORT_FIELD_PLACEHOLDER;
}

function normalizeValueFields(
  currentValue: string | undefined,
  recommendedValue: string | undefined
): Pick<ParameterImportSourceItem, "currentValue" | "recommendedValue"> {
  const current = currentValue?.trim();
  const recommended = recommendedValue?.trim();

  if (current && recommended) {
    return { currentValue: current, recommendedValue: recommended };
  }
  if (current) {
    return { currentValue: current, recommendedValue: current };
  }
  if (recommended) {
    return { currentValue: recommended, recommendedValue: recommended };
  }

  return { currentValue: IMPORT_FIELD_PLACEHOLDER, recommendedValue: IMPORT_FIELD_PLACEHOLDER };
}

export function toImportSourceItem(row: ReviewedImportRow): ParameterImportSourceItem {
  const values = normalizeValueFields(row.currentValue, row.recommendedValue);

  return {
    name: row.name.trim(),
    module: row.module.trim(),
    risk: row.risk ?? "Medium",
    unit: normalizeRequiredField(row.unit),
    range: normalizeRequiredField(row.range),
    ...values,
    ...(row.description?.trim() ? { description: row.description.trim() } : {}),
    ...(row.explanation?.trim() ? { explanation: row.explanation.trim() } : {}),
    ...(row.configFormat?.trim() ? { configFormat: row.configFormat.trim() } : {})
  };
}

export function toSourceItems(reviewedRows: ReviewedImportRow[]): ParameterImportSourceItem[] {
  return reviewedRows.filter((row) => ELIGIBLE_ROW_STATUSES.has(row.status)).map(toImportSourceItem);
}
