import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { scanParameterCatalogBoundaries } from "../check-parameter-catalog-boundaries";
import { loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import { applyReviewedIssue853DRelocation, verifyIssue853DInventory } from "./issue853DRelocation";

const root = process.cwd();
const fixture = await loadBoundaryViolationFixture(root);
const allowances = (await loadAllowlistIndex(root)).entries;
const discovered = await scanParameterCatalogBoundaries(root, fixture.trustedBaseSha);
const inventory = JSON.parse(await readFile(join(
  root, "scripts/fixtures/parameter-catalog-allowlist/issue-853-d-902-inventory.json",
), "utf8")) as { retiredIds: string[]; unmatchedNewIds: string[]; absentAtCombinedHead: string[] };

describe("Issue #853 D exact Catalog handoff", () => {
  it("keeps 19 exact pairs, 22 retirements, 23 unmatched observations, and five fixed-file aliases distinct", async () => {
    await expect(verifyIssue853DInventory(root, fixture, allowances, discovered)).resolves.toBeDefined();
    const result = await applyReviewedIssue853DRelocation(root, fixture, allowances, discovered, []);
    expect(result.relocations).toHaveLength(24);
    expect(new Set(result.relocations.map((pair) => pair.id)).size).toBe(24);
    expect(inventory.retiredIds).toHaveLength(22);
    expect(inventory.unmatchedNewIds).toHaveLength(23);
    expect(inventory.absentAtCombinedHead).toHaveLength(1);
    expect(inventory.unmatchedNewIds.filter((id) => discovered.some((entry) => entry.id === id))).toHaveLength(22);
  });

  it("rejects a retired source that reappears and a missing unmatched observation", async () => {
    const retired = fixture.violations.find((entry) => entry.id === inventory.retiredIds[0]);
    expect(retired).toBeDefined();
    await expect(verifyIssue853DInventory(root, fixture, allowances, [...discovered, retired!]))
      .rejects.toThrow("retired source");
    const present = inventory.unmatchedNewIds.find((id) => discovered.some((entry) => entry.id === id));
    expect(present).toBeDefined();
    await expect(verifyIssue853DInventory(root, fixture, allowances, discovered.filter((entry) => entry.id !== present)))
      .rejects.toThrow("unmatched new");
  });
});
