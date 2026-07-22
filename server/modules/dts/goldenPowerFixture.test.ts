import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { resolveDts } from "./index";
import { buildDtsPowerSeed } from "../../../scripts/dts-power-seed";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const seedDir = join(root, "src/config/dts-seed");
const fixtureDir = join(root, "server/modules/dts/fixtures");

describe("golden power fixture", () => {
  it("locks the 58-node, 228-property aurora project-primary topology", async () => {
    const primarySource = await readFile(join(seedDir, "aurora-board.dts"), "utf8");
    const resolved = resolveDts(primarySource);

    expect(resolved.nodes).toHaveLength(58);

    const propertyCount = resolved.nodes.reduce((count, node) => count + node.properties.length, 0);
    expect(propertyCount).toBe(228);

    const phandleCount = resolved.nodes.reduce((count, node) => count + node.phandleRefs.length, 0);
    expect(phandleCount).toBe(18);

    const keyCounts = new Map<string, number>();
    for (const node of resolved.nodes) {
      for (const property of node.properties) {
        keyCounts.set(property.name, (keyCounts.get(property.name) ?? 0) + 1);
      }
    }
    const repeatedKeys = [...keyCounts.entries()].filter(([, count]) => count > 1);
    expect(repeatedKeys).toHaveLength(28);

    const gpioIntNodePaths = resolved.nodes
      .filter((node) => node.properties.some((property) => property.name === "gpio_int"))
      .map((node) => node.nodePath)
      .sort();
    expect(gpioIntNodePaths).toEqual(["amba/i2c@FDF5E000/sc8562@6E", "amba/i2c@FF24E000/mt5788@2B"]);
  });

  it("keeps synthetic scaffolding in fixtures and overlay fragments that resolve every label target", async () => {
    const baseFixture = await readFile(join(fixtureDir, "synthetic-power-base.dts"), "utf8");

    expect(baseFixture).toContain("gpio-controller");
    expect(baseFixture).toContain("#gpio-cells = <2>");
    expect(baseFixture).toContain("gic");

    const overlaySource = await readFile(join(seedDir, "aurora-power-overlay.dts"), "utf8");
    const overlayLabelTargets = [...overlaySource.matchAll(/^&([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm)].map(
      (match) => match[1]
    );
    const resolvedBase = resolveDts(baseFixture);
    const baseLabels = new Set(resolvedBase.nodes.flatMap((node) => node.labels));

    for (const label of overlayLabelTargets) {
      expect(baseLabels.has(label)).toBe(true);
    }
  });

  it("keeps the three seed projects differentiated by at least 15 properties", async () => {
    const primarySource = await readFile(join(seedDir, "aurora-board.dts"), "utf8");
    const seed = buildDtsPowerSeed(primarySource);

    const differentiated = seed.parameterLibrary.filter((parameter) => {
      const values = Object.values(parameter.values).map((value) => value.currentValue);
      return new Set(values).size > 1;
    });
    expect(differentiated.length).toBeGreaterThanOrEqual(15);
  });
});
