import type { ParameterImportSourceItem } from "@/application/ports/ParameterRepository";
import type { ReviewedImportRow } from "./types";

const ELIGIBLE_ROW_STATUSES = new Set<ReviewedImportRow["status"]>(["approved", "new-confirmed"]);

export function toSourceItems(reviewedRows: ReviewedImportRow[]): ParameterImportSourceItem[] {
  return reviewedRows
    .filter((row) => ELIGIBLE_ROW_STATUSES.has(row.status))
    .map((row) => ({
      name: row.name,
      module: row.module,
      risk: row.risk ?? "Medium",
      unit: row.unit ?? "",
      range: row.range ?? "",
      currentValue: row.currentValue,
      recommendedValue: row.recommendedValue,
      description: row.description,
      explanation: row.explanation,
      configFormat: row.configFormat
    }));
}
