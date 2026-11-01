import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildImportTemplateWorkbook } from "./buildImportTemplate";
import { IMPORT_TEMPLATE_HEADERS } from "./columnMap";
import { parseSpreadsheetImport } from "./parseSpreadsheet";

describe("buildImportTemplateWorkbook", () => {
  it("keeps the import sheet empty and excludes guidance and examples from parsing", () => {
    const bytes = buildImportTemplateWorkbook();

    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);

    const workbook = XLSX.read(bytes, { type: "array" });
    expect(workbook.SheetNames).toEqual(["参数", "填写说明", "填写示例"]);
    const sheetName = workbook.SheetNames[0];
    expect(sheetName).toBe("参数");

    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      defval: ""
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([...IMPORT_TEMPLATE_HEADERS]);
    expect(parseSpreadsheetImport({ bytes })).toEqual([]);
  });

  it("parses copied example rows without importing guidance or changing JSON text", () => {
    const workbook = XLSX.read(buildImportTemplateWorkbook(), { type: "array" });
    const examples = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets["填写示例"], {
      header: 1,
      defval: ""
    });
    XLSX.utils.sheet_add_aoa(workbook.Sheets["参数"], examples.slice(2), { origin: "A2" });
    const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));

    expect(parseSpreadsheetImport({ bytes })).toEqual([
      {
        name: "示例电流上限", module: "示例充电管理", currentValue: "3200", range: "0–5000",
        unit: "mA", risk: "High", description: "示例电流限制", explanation: "仅演示数字值写法",
        configFormat: "json", valueKind: "scalar", sourceFormat: "spreadsheet", sourceLocation: "row:2"
      },
      {
        name: "示例设备配置", module: "示例设备管理", currentValue: '{"code":"0007","limits":[3200,4500]}',
        risk: "Medium", description: "示例结构化配置", explanation: "JSON 内的 0007 是字符串，保留前导零",
        configFormat: "json", valueKind: "complex", sourceFormat: "spreadsheet", sourceLocation: "row:3"
      }
    ]);
  });
});
