import * as XLSX from "xlsx";
import { IMPORT_TEMPLATE_HEADERS } from "./columnMap";

export function buildImportTemplateWorkbook(): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([[...IMPORT_TEMPLATE_HEADERS]]);
  XLSX.utils.book_append_sheet(workbook, sheet, "参数");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}
