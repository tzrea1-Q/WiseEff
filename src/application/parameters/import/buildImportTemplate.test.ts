import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildImportTemplateWorkbook } from "./buildImportTemplate";
import { IMPORT_TEMPLATE_HEADERS } from "./columnMap";

describe("buildImportTemplateWorkbook", () => {
  it("returns an xlsx workbook with only the import template header row", () => {
    const bytes = buildImportTemplateWorkbook();

    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);

    const workbook = XLSX.read(bytes, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    expect(sheetName).toBe("参数");

    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      defval: ""
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([...IMPORT_TEMPLATE_HEADERS]);
  });
});
