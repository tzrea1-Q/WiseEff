import { describe, expect, it } from "vitest";
import { requireRowActionVisibility } from "../e2e/quality/consistency-assertions";

const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 40, width: right - left, height: 40 });
const visibleRow = {
  dom: "catalog-actions", cell: rect(1280, 1398), row: rect(634, 1398),
  clip: { left: 634, right: 1398 }, scrollLeft: 0,
  actions: [{ dom: "button", rect: rect(1290, 1342) }],
  statuses: [{ dom: "lifecycle", rect: rect(1200, 1270) }]
};

describe("row action visibility at the standard PC viewport", () => {
  it("rejects the audited parameter action cell extending beyond its row", () => {
    expect(() => requireRowActionVisibility([
      { ...visibleRow, dom: "parameter-actions", cell: rect(1324.984375, 1428.984375), row: rect(500, 1415) }
    ], "/parameters?project=aurora"))
      .toThrow("/parameters?project=aurora: parameter-actions exceeds its row");
  });

  it("rejects the audited Catalog actions outside the initial table viewport even when they fit the row", () => {
    expect(() => requireRowActionVisibility([
      { ...visibleRow, cell: rect(1480, 1591.28125), row: rect(634, 1591.28125) }
    ], "/parameter-admin/specs"))
      .toThrow("/parameter-admin/specs: catalog-actions is clipped");
  });

  it.each([
    ["an action protruding from its cell", { actions: [{ dom: "edit", rect: rect(1380, 1412) }] }, "edit is clipped"],
    ["a clipped key status", { statuses: [{ dom: "lifecycle", rect: rect(1390, 1440) }] }, "lifecycle is clipped"],
    ["actions visible only after scrolling", { scrollLeft: 40 }, "requires horizontal scrolling"],
    ["an unmeasured action", { actions: [] }, "missing action or status measurements"],
    ["an unmeasured status", { statuses: [] }, "missing action or status measurements"]
  ])("rejects %s", (_description, overrides, message) => {
    expect(() => requireRowActionVisibility([{ ...visibleRow, ...overrides }], "/parameters"))
      .toThrow(`/parameters: ${message}`);
  });

  it("does not treat an empty table as visibility evidence", () => {
    expect(() => requireRowActionVisibility([], "/parameters"))
      .toThrow("/parameters: missing consistency measurements: rowActions");
  });

  it("accepts actions and status inside the initial scrollport with subpixel rounding", () => {
    expect(() => requireRowActionVisibility([
      { ...visibleRow, cell: rect(1280, 1398.5) }
    ], "/parameters")).not.toThrow();
  });
});
