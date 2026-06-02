import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("quality visual masks", () => {
  it("masks dynamic parameter table rows only for the parameters workbench screenshot", () => {
    const helpers = readFileSync("e2e/quality/helpers.ts", "utf8");
    const visualSpec = readFileSync("e2e/quality/visual.quality.spec.ts", "utf8");

    expect(helpers).toContain(".parameters-table-grid tbody");
    expect(helpers).toMatch(/routePath\s*===\s*"\/parameters"/);
    expect(visualSpec).toContain("stableMasks(page, route.path)");
  });
});
