import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { IMPORT_TEMPLATE_HEADERS } from "./columnMap";
import { parseSpreadsheetImport } from "./parseSpreadsheet";

describe("parseSpreadsheetImport", () => {
  it("parses CSV text with UTF-8 BOM and Chinese headers", () => {
    const csv = [
      IMPORT_TEMPLATE_HEADERS.join(","),
      [
        "fast_charge_current_limit_ma",
        "Charging Policy",
        "3200",
        "3400",
        "2500 - 4500",
        "mA",
        "高",
        "Fast charge limit",
        "Controls fast charge current",
        "int32",
        "scalar"
      ].join(",")
    ].join("\n");
    const text = `\uFEFF${csv}`;

    const rows = parseSpreadsheetImport({ text });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "fast_charge_current_limit_ma",
      module: "Charging Policy",
      currentValue: "3200",
      recommendedValue: "3400",
      range: "2500 - 4500",
      unit: "mA",
      risk: "High",
      valueKind: "scalar",
      sourceFormat: "spreadsheet",
      sourceLocation: "row:2"
    });
  });

  it("parses an xlsx workbook built from the import template headers", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [...IMPORT_TEMPLATE_HEADERS],
      [
        "battery_health_reserve_pct",
        "Battery Safety",
        "10",
        "12",
        "5-20",
        "%",
        "中",
        "Health reserve",
        "Reserve percentage",
        "int32",
        "scalar"
      ]
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "参数");
    const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));

    const rows = parseSpreadsheetImport({ bytes });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "battery_health_reserve_pct",
      module: "Battery Safety",
      currentValue: "10",
      recommendedValue: "12",
      range: "5-20",
      unit: "%",
      risk: "Medium",
      valueKind: "scalar",
      sourceFormat: "spreadsheet",
      sourceLocation: "row:2"
    });
  });
});
