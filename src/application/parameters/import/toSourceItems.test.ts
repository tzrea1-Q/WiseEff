import { describe, expect, it } from "vitest";
import { toImportSourceItem, toSourceItems } from "./toSourceItems";
import type { ReviewedImportRow } from "./types";

function buildRow(overrides: Partial<ReviewedImportRow> = {}): ReviewedImportRow {
  return {
    name: "test_param",
    module: "Charging Policy",
    sourceFormat: "json",
    rowId: "import-row-1",
    status: "approved",
    matchKey: "test_param::Charging Policy",
    ...overrides
  };
}

describe("toSourceItems", () => {
  it("includes only approved and new-confirmed rows", () => {
    const rows: ReviewedImportRow[] = [
      buildRow({ rowId: "r1", status: "approved" }),
      buildRow({ rowId: "r2", status: "new-confirmed", name: "new_param" }),
      buildRow({ rowId: "r3", status: "pending" }),
      buildRow({ rowId: "r4", status: "skipped" }),
      buildRow({ rowId: "r5", status: "conflict" }),
      buildRow({ rowId: "r6", status: "needs-module" })
    ];

    const items = toSourceItems(rows);

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.name)).toEqual(["test_param", "new_param"]);
  });

  it("fills api-required defaults for missing risk, unit, range, and values", () => {
    const items = toSourceItems([buildRow({ risk: undefined, unit: undefined, range: undefined })]);

    expect(items[0]).toEqual({
      name: "test_param",
      module: "Charging Policy",
      risk: "Medium",
      unit: "—",
      range: "—",
      currentValue: "—",
      recommendedValue: "—"
    });
  });

  it("mirrors a single provided value into both current and recommended fields", () => {
    expect(toImportSourceItem(buildRow({ currentValue: "3200" }))).toMatchObject({
      currentValue: "3200",
      recommendedValue: "3200"
    });
    expect(toImportSourceItem(buildRow({ recommendedValue: "3400" }))).toMatchObject({
      currentValue: "3400",
      recommendedValue: "3400"
    });
  });

  it("carries through provided optional fields without altering them", () => {
    const items = toSourceItems([
      buildRow({
        currentValue: "3200",
        recommendedValue: "3400",
        risk: "High",
        unit: "mA",
        range: "0 - 5000",
        description: "desc",
        explanation: "why",
        configFormat: "int"
      })
    ]);

    expect(items[0]).toEqual({
      name: "test_param",
      module: "Charging Policy",
      risk: "High",
      unit: "mA",
      range: "0 - 5000",
      currentValue: "3200",
      recommendedValue: "3400",
      description: "desc",
      explanation: "why",
      configFormat: "int"
    });
  });

  it("returns an empty array when no rows are eligible", () => {
    expect(toSourceItems([buildRow({ status: "pending" })])).toEqual([]);
  });
});
