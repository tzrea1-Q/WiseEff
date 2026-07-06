import { describe, expect, it } from "vitest";
import { normalizeRow } from "./normalizeRow";

describe("normalizeRow", () => {
  it("normalizes Chinese risk labels to High/Medium/Low", () => {
    expect(normalizeRow({ name: "param_a", risk: "高" }, "spreadsheet")?.risk).toBe("High");
    expect(normalizeRow({ name: "param_b", risk: "中" }, "spreadsheet")?.risk).toBe("Medium");
    expect(normalizeRow({ name: "param_c", risk: "低" }, "spreadsheet")?.risk).toBe("Low");
  });

  it("accepts English risk labels unchanged", () => {
    expect(normalizeRow({ name: "param_a", risk: "High" }, "json")?.risk).toBe("High");
    expect(normalizeRow({ name: "param_b", risk: "Medium" }, "json")?.risk).toBe("Medium");
    expect(normalizeRow({ name: "param_c", risk: "Low" }, "json")?.risk).toBe("Low");
  });

  it("normalizes valueKind aliases including Chinese labels", () => {
    expect(normalizeRow({ name: "scalar_param", valueKind: "scalar" }, "spreadsheet")?.valueKind).toBe(
      "scalar"
    );
    expect(normalizeRow({ name: "complex_param", valueKind: "complex" }, "spreadsheet")?.valueKind).toBe(
      "complex"
    );
    expect(normalizeRow({ name: "cn_scalar", valueKind: "标量" }, "spreadsheet")?.valueKind).toBe("scalar");
    expect(normalizeRow({ name: "cn_complex", valueKind: "复杂" }, "spreadsheet")?.valueKind).toBe("complex");
  });

  it("returns null when name is missing or empty", () => {
    expect(normalizeRow({}, "spreadsheet")).toBeNull();
    expect(normalizeRow({ name: "" }, "spreadsheet")).toBeNull();
    expect(normalizeRow({ name: "   " }, "spreadsheet")).toBeNull();
  });

  it("allows empty module for DTS-style rows", () => {
    const row = normalizeRow({ name: "dts_param", module: "" }, "dts-fragment", "line:42");
    expect(row).toEqual({
      name: "dts_param",
      module: "",
      sourceFormat: "dts-fragment",
      sourceLocation: "line:42"
    });
  });

  it("trims name and module and preserves optional fields", () => {
    const row = normalizeRow(
      {
        name: "  fast_charge_current_limit_ma  ",
        module: " Charging Policy ",
        currentValue: "3200",
        range: "2500 - 4500",
        unit: "mA",
        risk: "高",
        valueKind: "标量"
      },
      "spreadsheet",
      "row:2"
    );
    expect(row).toMatchObject({
      name: "fast_charge_current_limit_ma",
      module: "Charging Policy",
      currentValue: "3200",
      range: "2500 - 4500",
      unit: "mA",
      risk: "High",
      valueKind: "scalar",
      sourceFormat: "spreadsheet",
      sourceLocation: "row:2"
    });
  });
});
