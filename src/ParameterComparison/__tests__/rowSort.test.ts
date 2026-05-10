import { describe, expect, it } from "vitest";
import { sortComparisonRows } from "../utils/rowSort";
import type { ComparisonRow } from "../types";

const row = (overrides: Partial<ComparisonRow>): ComparisonRow => ({
  key: overrides.key ?? "k",
  module: "M",
  description: "",
  baseValue: "1",
  targetValue: "1",
  baseNumeric: 1,
  targetNumeric: 1,
  unit: "",
  status: "synced",
  risk: "Low",
  ...overrides
});

describe("sortComparisonRows", () => {
  it("places drift rows before synced rows", () => {
    const sorted = sortComparisonRows([
      row({ key: "synced", status: "synced", risk: "High" }),
      row({ key: "drift", status: "drift", risk: "Low", baseNumeric: 10, targetNumeric: 11 })
    ]);

    expect(sorted.map((item) => item.key)).toEqual(["drift", "synced"]);
  });

  it("orders drift rows by risk High > Medium > Low", () => {
    const sorted = sortComparisonRows([
      row({ key: "low", status: "drift", risk: "Low", baseNumeric: 10, targetNumeric: 11 }),
      row({ key: "high", status: "drift", risk: "High", baseNumeric: 10, targetNumeric: 11 }),
      row({ key: "medium", status: "drift", risk: "Medium", baseNumeric: 10, targetNumeric: 11 })
    ]);

    expect(sorted.map((item) => item.key)).toEqual(["high", "medium", "low"]);
  });

  it("orders same-risk drift rows by absolute percentage delta descending", () => {
    const sorted = sortComparisonRows([
      row({ key: "small", status: "drift", risk: "Medium", baseNumeric: 100, targetNumeric: 110 }),
      row({ key: "large", status: "drift", risk: "Medium", baseNumeric: 100, targetNumeric: 140 }),
      row({ key: "negative", status: "drift", risk: "Medium", baseNumeric: 100, targetNumeric: 70 })
    ]);

    expect(sorted.map((item) => item.key)).toEqual(["large", "negative", "small"]);
  });

  it("does not mutate the input rows", () => {
    const rows = [
      row({ key: "synced", status: "synced" }),
      row({ key: "drift", status: "drift", baseNumeric: 1, targetNumeric: 2 })
    ];

    sortComparisonRows(rows);

    expect(rows.map((item) => item.key)).toEqual(["synced", "drift"]);
  });
});
