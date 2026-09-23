import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { scanParameterCatalogBoundaries } from "../check-parameter-catalog-boundaries";
import { loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import { applyReviewedDebuggingTransferRelocation } from "./debuggingTransferRelocation";
import {
  applyReviewedIssue853CCatalogSplitRelocation,
  applyReviewedIssue853CRepositoryRelocation,
  applyReviewedIssue853CRouteRelocation,
  issue853CActionRetiredSourceIds,
  verifyIssue853CActionRetirement,
} from "./issue853CRelocation";
import { applyReviewedIssue913T14Relocation } from "./issue913T14Relocation";
import type { BoundaryViolation } from "./schema";

const root = process.cwd();
const fixture = await loadBoundaryViolationFixture(root);
const allowances = (await loadAllowlistIndex(root)).entries;
const recordRoot = "scripts/fixtures/parameter-catalog-allowlist";
const loadRecord = async (name: string) => JSON.parse(await readFile(join(root, recordRoot, name), "utf8")) as {
  files: Array<{ file: string; pairs: Array<{ old: BoundaryViolation; new: BoundaryViolation }> }>;
};
let discovered: BoundaryViolation[];

beforeAll(async () => {
  discovered = await scanParameterCatalogBoundaries(root, fixture.trustedBaseSha);
}, 60_000);

describe("Issue #853 C fixed Catalog successor and retirement", () => {
  it("proves complete old history, 2 action retirements, and exact 2+4+10 successors", async () => {
    await verifyIssue853CActionRetirement(root, fixture, allowances, discovered);
    const transfer = await applyReviewedDebuggingTransferRelocation(root, fixture, allowances, discovered);
    expect(transfer.relocations).toEqual([]);
    const routes = await applyReviewedIssue853CRouteRelocation(root, fixture, allowances, transfer.violations, []);
    const split = await applyReviewedIssue853CCatalogSplitRelocation(
      root, fixture, allowances, routes.violations, routes.relocations,
    );
    const t14 = await applyReviewedIssue913T14Relocation(
      root, fixture, allowances, split.violations, [...routes.relocations, ...split.relocations],
    );
    const repository = await applyReviewedIssue853CRepositoryRelocation(
      root, fixture, allowances, t14.violations,
      [...routes.relocations, ...split.relocations, ...t14.relocations],
    );

    const expected = await Promise.all([
      "debugging-transfer-relocation.json",
      "t14-t22-family-successor-relocation.json",
      "t14-rewritten-slice-successor-relocation.json",
    ].map(loadRecord));
    const sourceIds = (file: string) => expected.flatMap((record) =>
      record.files.filter((section) => section.file === file)
        .flatMap((section) => section.pairs.map((pair) => pair.old.id)),
    ).sort();
    expect(routes.relocations.map((entry) => entry.id).sort())
      .toEqual(sourceIds("server/modules/debugging/routes.ts"));
    expect(split.relocations.map((entry) => entry.id).sort())
      .toEqual(fixture.violations.filter((entry) =>
        entry.file === "server/modules/debugging/catalogSplitRepository.ts",
      ).map((entry) => entry.id).sort());
    expect(repository.relocations.map((entry) => entry.id).sort())
      .toEqual(sourceIds("server/modules/debugging/repository.ts"));
    expect(repository.relocations).toHaveLength(10);
    expect(new Set(repository.relocations.map((entry) => entry.observed.id)).size).toBe(10);
    expect(repository.relocations.find((entry) => entry.observed.line === 1545)?.id)
      .toBe("S12-DBG:legacy-parameter-spec-identifier:a5e1b6afd58d3283:d04c3e6e27ce871b");
    expect(repository.relocations.find((entry) => entry.observed.line === 1582)?.id)
      .toBe("S12-DBG:legacy-parameter-spec-identifier:a5e1b6afd58d3283:ef72fb98f48f038f");
    expect(issue853CActionRetiredSourceIds.every((id) =>
      !allowances.some((entry) => entry.id === id)
      && !discovered.some((entry) => entry.id === id),
    )).toBe(true);
  });

  it("rejects a revived action observation or allowance", async () => {
    const old = fixture.violations.find((entry) => entry.id === issue853CActionRetiredSourceIds[0])!;
    await expect(verifyIssue853CActionRetirement(root, fixture, allowances, [...discovered, old]))
      .rejects.toThrow("exact 2-to-0 partition");
    await expect(verifyIssue853CActionRetirement(root, fixture, [
      ...allowances, { id: old.id, rule: old.rule, file: old.file, reason: old.reason },
    ], discovered)).rejects.toThrow("exact 2-to-0 partition");
  });

  it("rejects a changed route destination even when the old source still exists", async () => {
    const route = discovered.find((entry) => entry.file === "server/modules/debugging/routes.ts")!;
    const changed = discovered.map((entry) => entry === route ? { ...entry, byteStart: entry.byteStart + 1 } : entry);
    await expect(applyReviewedIssue853CRouteRelocation(root, fixture, allowances, changed, []))
      .rejects.toThrow("exact destination occurrence");
  });
});
