import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import type { ParameterRecord } from "../../mockData";
import {
  buildProjectParametersSheetRows,
  exportProjectParametersAsExcel,
  serializeProjectParametersWorkbook
} from "./exportProjectParametersExcel";

function sampleParameter(overrides: Partial<ParameterRecord> = {}): ParameterRecord {
  return {
    id: "sample-id",
    name: "fast_charge_current_limit_ma",
    description: "Fast charge limit",
    explanation: "Controls fast charge current",
    configFormat: "int32",
    module: "Charging Policy",
    projectId: "nebula",
    currentValue: "3200",
    recommendedValue: "4200",
    range: "1000-5000",
    unit: "mA",
    risk: "High",
    valueKind: "scalar",
    updatedAt: "2026-01-15T08:00:00.000Z",
    updatedAtTs: "2026-01-15T08:00:00.000Z",
    history: [],
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
  it("builds sheet rows with Chinese headers and localized update times", () => {
    const rows = buildProjectParametersSheetRows([
      sampleParameter(),
      sampleParameter({
        name: "battery_health_reserve_pct",
        risk: "Medium"
      })
    ]);

    expect(rows[0]).toEqual(["参数名称", "模块", "当前值", "推荐值", "范围 / 单位", "重要性", "更新时间"]);
    expect(rows[1]?.[0]).toBe("fast_charge_current_limit_ma");
    expect(rows[1]?.[5]).toBe("高");
    expect(rows[2]?.[5]).toBe("中");
    expect(rows[1]?.[6]).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("serializes a real xlsx workbook with readable Chinese cell values", () => {
    const buffer = serializeProjectParametersWorkbook([
      sampleParameter(),
      sampleParameter({
        name: "battery_health_reserve_pct",
        module: "Battery Safety",
        currentValue: "10",
        recommendedValue: "12",
        risk: "Medium",
        range: "5-20",
        unit: "%"
      })
    ]);

    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);

    const rows = readWorkbookRows(buffer);
    expect(rows[0]).toContain("参数名称");
    expect(rows[0]).toContain("推荐值");
    expect(rows.map((row) => row[0])).toEqual([
      "参数名称",
      "fast_charge_current_limit_ma",
      "battery_health_reserve_pct"
    ]);
    expect(rows[1]?.[5]).toBe("高");
    expect(rows[2]?.[5]).toBe("中");
  });

  it("preserves special characters in cell values without XML escaping artifacts", () => {
    const buffer = serializeProjectParametersWorkbook([
      sampleParameter({
        name: "param<1>&2",
        module: "Module & Policy",
        currentValue: "1<2",
        recommendedValue: "3>4",
        range: "<0-100>",
        unit: "mA"
      })
    ]);

    const rows = readWorkbookRows(buffer);
    expect(rows[1]).toEqual([
      "param<1>&2",
      "Module & Policy",
      "1<2",
      "3>4",
      "<0-100> mA",
      "高",
      expect.stringMatching(/^\d{2}-\d{2} \d{2}:\d{2}$/)
    ]);
  });

  it("returns workbook bytes when returnBuffer is enabled", () => {
    const buffer = exportProjectParametersAsExcel([sampleParameter()], "nebula", { returnBuffer: true });

    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(readWorkbookRows(buffer as Uint8Array)[1]?.[0]).toBe("fast_charge_current_limit_ma");
  });
});
