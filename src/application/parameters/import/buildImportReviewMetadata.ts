import type { ParameterImportReviewMetadata } from "@/application/ports/ParameterRepository";
import type { ReviewedImportRow } from "./types";

/** Build optional reviewMetadata from wizard skip decisions for import audit. */
export function buildImportReviewMetadata(reviewedRows: ReviewedImportRow[]): ParameterImportReviewMetadata | undefined {
  const skippedRows = reviewedRows
    .filter((row) => row.status === "skipped")
    .map((row) => ({
      rowKey: row.sourceLocation ?? `${row.module}/${row.name}`,
      name: row.name,
      module: row.module,
      reason: row.skipReason?.trim() || "（未填写原因）"
    }));

  if (skippedRows.length === 0) {
    return undefined;
  }

  return {
    skippedRows,
    notes: `wizard skipped ${skippedRows.length} row(s)`
  };
}

export const DTS_IMPORT_SERVER_PARSE_THRESHOLD_BYTES = 2 * 1024 * 1024;

export function shouldUseServerDtsParse(contentByteLength: number, threshold = DTS_IMPORT_SERVER_PARSE_THRESHOLD_BYTES): boolean {
  return contentByteLength > threshold;
}

export const DTS_SERVER_PARSE_HINT = "将使用服务端解析";
