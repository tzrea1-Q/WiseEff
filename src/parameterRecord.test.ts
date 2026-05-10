import { describe, expect, it } from "vitest";
import { initialState } from "./mockData";

function getUpdatedAtTimestamp(updatedAt: string) {
  const parameter = initialState.parameters.find((param) => param.updatedAt === updatedAt);
  expect(parameter).toBeDefined();
  return Date.parse(parameter?.updatedAtTs ?? "");
}

describe("ParameterRecord", () => {
  it("每条记录都有可排序的 ISO 时间戳 updatedAtTs", () => {
    expect(initialState.parameters.length).toBeGreaterThan(0);
    const timestamps = initialState.parameters.map((param) => param.updatedAtTs);
    expect(new Set(timestamps).size).toBe(timestamps.length);

    for (const param of initialState.parameters) {
      expect(param.updatedAtTs).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const ts = Date.parse(param.updatedAtTs);
      expect(Number.isNaN(ts)).toBe(false);
      expect(new Date(ts).toISOString()).toBe(param.updatedAtTs);
    }
  });

  it("updatedAtTs 与 updatedAt 文案同步（新字段不影响旧展示）", () => {
    for (const param of initialState.parameters) {
      expect(typeof param.updatedAt).toBe("string");
      expect(param.updatedAt.length).toBeGreaterThan(0);
    }
  });

  it("updatedAtTs 遵循 updatedAt 文案的相对新旧顺序", () => {
    expect(getUpdatedAtTimestamp("45 分钟前")).toBeGreaterThan(getUpdatedAtTimestamp("1 小时前"));
    expect(getUpdatedAtTimestamp("今天 16:20")).toBeGreaterThan(getUpdatedAtTimestamp("今天 13:44"));
    expect(getUpdatedAtTimestamp("1 天前")).toBeGreaterThan(getUpdatedAtTimestamp("2 天前"));
    expect(getUpdatedAtTimestamp("昨天 18:04")).toBeGreaterThan(getUpdatedAtTimestamp("昨天 17:20"));
  });
});
