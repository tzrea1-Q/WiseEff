import { describe, expect, it } from "vitest";
import { scanParameterCatalogBoundaries } from "../check-parameter-catalog-boundaries";
import { loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import { applyReviewedIssue901RoutesTestRelocation } from "./issue901RouteTestRelocation";

const expectedPairs = [
  [
    "S12-PRJ:legacy-parameter-spec-identifier:cf84fb6f809d352e:6e2633524ae56a3d",
    "S12-PRJ:legacy-parameter-spec-identifier:cf84fb6f809d352e:6ad659a707bb2254",
  ],
  [
    "S12-PRJ:legacy-parameter-spec-identifier:d8c97f4c2a94cf43:9e1a87c53fc70694",
    "S12-PRJ:legacy-parameter-spec-identifier:d8c97f4c2a94cf43:65df3b7158034d65",
  ],
  [
    "S12-PRJ:legacy-parameter-spec-identifier:cf84fb6f809d352e:53867564c3eacd0b",
    "S12-PRJ:legacy-parameter-spec-identifier:cf84fb6f809d352e:352a7ff7b9bcfe6d",
  ],
  [
    "S12-PRJ:legacy-parameter-spec-identifier:d8c97f4c2a94cf43:25aa16170296f39f",
    "S12-PRJ:legacy-parameter-spec-identifier:d8c97f4c2a94cf43:624a44f63d456a11",
  ],
  [
    "S12-PRJ:legacy-parameter-spec-identifier:3599f5b664ecd6f0:54d5f47ab66dc394",
    "S12-PRJ:legacy-parameter-spec-identifier:3599f5b664ecd6f0:a10cd6a66e549726",
  ],
];

describe("Issue #901 route test relocation", () => {
  it("maps only the five existing parameterSpecId occurrences shifted by the new test", async () => {
    const repoRoot = process.cwd();
    const [fixture, allowlist] = await Promise.all([
      loadBoundaryViolationFixture(repoRoot),
      loadAllowlistIndex(repoRoot),
    ]);
    const discovered = await scanParameterCatalogBoundaries(repoRoot, fixture.trustedBaseSha);
    const result = await applyReviewedIssue901RoutesTestRelocation(
      repoRoot,
      fixture,
      allowlist.entries,
      discovered,
    );

    expect(result.relocations.map(({ id, observed }) => [id, observed.id])).toEqual(expectedPairs);
    expect(result.relocations.every(({ id, observed }) => id !== observed.id)).toBe(true);
  }, 120_000);
});
