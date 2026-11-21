import { describe, expect, it } from "vitest";
import { dtsValuesEquivalent } from "./dtsValueEquality";
import { buildBindingCompareOverview } from "./bindingProjectComparison";

describe("dtsValuesEquivalent", () => {
  it("ignores layout, comments and integer spelling", () => {
    expect(dtsValuesEquivalent("<\n\t4350 0x10 /* a */\n>", "<4350 16>")).toBe(true);
    expect(dtsValuesEquivalent('"a",\n\t"b"', '"a", "b"')).toBe(true);
  });

  it("keeps real differences and cell grouping", () => {
    expect(dtsValuesEquivalent("<1 2>", "<1 3>")).toBe(false);
    expect(dtsValuesEquivalent("<1>, <2>", "<1 2>")).toBe(false);
    expect(dtsValuesEquivalent("<1 2", "<1  2")).toBe(false);
  });

  it("groups formatting-only differences as the same value", () => {
    const row = (bindingId: string, rawValue: string, isBase = false) => ({
      bindingId, comparisonKey: bindingId, projectId: bindingId, projectName: bindingId, rawValue,
      valueState: "present" as const, isBase, isTarget: false,
    });
    const overview = buildBindingCompareOverview(
      [row("base", "<1 2>", true), row("p1", "<\n\t0x1 2 /* x */\n>"), row("p2", "<1 3>")] as never,
      "<1 2>",
    );
    expect(overview.groups.map((group) => [group.kind, group.projects.map((project) => project.bindingId)])).toEqual([
      ["same", ["p1"]],
      ["changed", ["p2"]],
    ]);
  });
});
