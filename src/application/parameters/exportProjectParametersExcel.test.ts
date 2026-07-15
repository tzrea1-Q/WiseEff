import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import type { ParameterExportRow } from "./exportProjectParametersExcel";
import {
  buildProjectParametersSheetRows,
  exportProjectParametersAsExcel,
  serializeProjectParametersWorkbook
} from "./exportProjectParametersExcel";

function sampleBinding(overrides: Partial<ParameterExportRow> = {}): ParameterExportRow {
  return {
    propertyKey: "gpio_int",
    driverModule: "gpio",
    instanceName: "gpio0",
    locator: "/soc/gpio@0",
    effectiveValue: { kind: "strings", values: ["<1>"] },
    schemaVersion: 3,
    ...overrides
  };
}

function readWorkbookRows(buffer: Uint8Array) {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets["参数"];
  expect(sheet).toBeDefined();
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
}

describe("exportProjectParametersAsExcel", () => {
  it("builds sheet rows with semantic binding columns", () => {
    const rows = buildProjectParametersSheetRows([
      sampleBinding(),
      sampleBinding({
        propertyKey: "temp_max",
        driverModule: "battery",
        instanceName: "bat0",
        locator: "/battery",
        effectiveValue: { kind: "strings", values: ["85"] },
        schemaVersion: 1
      })
    ]);

    expect(rows[0]).toEqual(["属性键", "驱动模块", "实例", "定位符", "生效值", "Schema 版本"]);
    expect(rows[1]?.[0]).toBe("gpio_int");
    expect(rows[1]?.[1]).toBe("gpio");
    expect(rows[1]?.[4]).toBe("<1>");
    expect(rows[1]?.[5]).toBe("3");
    expect(rows[2]?.[0]).toBe("temp_max");
  });

  it("serializes a real xlsx workbook with semantic cell values", () => {
    const buffer = serializeProjectParametersWorkbook([sampleBinding()]);

    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);

    const rows = readWorkbookRows(buffer);
    expect(rows[0]).toContain("属性键");
    expect(rows[0]).toContain("生效值");
    expect(rows.map((row) => row[0])).toEqual(["属性键", "gpio_int"]);
  });

  it("returns a buffer when returnBuffer is set", () => {
    const buffer = exportProjectParametersAsExcel([sampleBinding()], "AUR", { returnBuffer: true });
    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.byteLength).toBeGreaterThan(0);
  });
});
