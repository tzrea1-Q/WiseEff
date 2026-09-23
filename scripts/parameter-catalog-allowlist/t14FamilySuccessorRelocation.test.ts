import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scanParameterCatalogBoundaries } from "../check-parameter-catalog-boundaries";
import { loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import { runReviewedRelocationRecord } from "./runtimeTopologyRelocation";
import { t14FamilySuccessorRelocationConfig } from "./t14FamilySuccessorRelocation";
import type { BoundaryViolation } from "./schema";

const repoRoot = process.cwd();
const fixture = await loadBoundaryViolationFixture(repoRoot);
const allowances = (await loadAllowlistIndex(repoRoot)).entries;
const changedFiles = new Set([
  "server/modules/parameter-modules/repository.ts",
  "server/modules/parameter-modules/service.test.ts",
  "server/modules/agent/tools/actionTools.ts",
  "server/modules/debugging/repository.ts",
  "server/modules/dts-reload/repository.ts",
  "server/modules/dts-reload/service.test.ts",
  "server/modules/parameter-topology/writeLock.ts",
]);
const activeFiles = t14FamilySuccessorRelocationConfig.files
  .map((section) => section.file)
  .filter((file) => !changedFiles.has(file));
let discovered: BoundaryViolation[];

beforeAll(async () => {
  discovered = await scanParameterCatalogBoundaries(repoRoot, fixture.trustedBaseSha);
}, 60_000);

describe("T1.4 family historical record subset", () => {
  it("keeps all 203 unchanged-file destinations active", async () => {
    const result = await runReviewedRelocationRecord(
      repoRoot,
      fixture,
      allowances,
      discovered,
      [],
      { ...t14FamilySuccessorRelocationConfig, activeFiles },
    );

    expect(result.relocations).toHaveLength(203);
    expect(new Set(result.relocations.map((entry) => entry.id)).size).toBe(203);
    expect(new Set(result.relocations.map((entry) => entry.observed.id)).size).toBe(203);
    expect(result.relocations.every((entry) => !changedFiles.has(entry.observed.file))).toBe(true);
  });
});
