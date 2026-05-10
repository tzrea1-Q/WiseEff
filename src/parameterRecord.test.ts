import { describe, expect, it } from "vitest";
import { initialState } from "./mockData";

describe("ParameterRecord", () => {
  it("每条记录都有可排序的 ISO 时间戳 updatedAtTs", () => {
    expect(initialState.parameters.length).toBeGreaterThan(0);
    for (const param of initialState.parameters) {
      expect(param.updatedAtTs).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const ts = Date.parse(param.updatedAtTs);
      expect(Number.isNaN(ts)).toBe(false);
    }
  });

  it("updatedAtTs 与 updatedAt 文案同步（新字段不影响旧展示）", () => {
    const sample = initialState.parameters[0];
    expect(typeof sample.updatedAt).toBe("string");
    expect(sample.updatedAt.length).toBeGreaterThan(0);
  });
});
