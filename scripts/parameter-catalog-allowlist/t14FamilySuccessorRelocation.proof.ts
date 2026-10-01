import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import { verifyHistoricalRelocationProof } from "./runtimeTopologyRelocation";
import { applyReviewedT14FamilySuccessorRelocation, t14FamilySuccessorRelocationConfig,
  verifyIssue1015KnowledgeSuccessor } from "./t14FamilySuccessorRelocation";
import type { BoundaryViolation } from "./schema";
import { historicalIssue913T14Allowances } from "./issue913T14Relocation";

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
  "server/modules/parameter-files/conflictService.test.ts",
  "server/modules/parameter-files/syncService.test.ts",
  // Six prior T1.4 destinations in this file now have exact #903 successors.
  "server/modules/knowledge/parameterReferences.ts",
]);
const activeFiles = t14FamilySuccessorRelocationConfig.files
  .map((section) => section.file)
  .filter((file) => !changedFiles.has(file));
let discovered: BoundaryViolation[];

/** Retain all unchanged-file assertions beside the same-base raw scan. */
export function registerT14FamilySuccessorRelocationProof(getRaw: () => readonly BoundaryViolation[], trustedBaseSha: string) {
  beforeAll(() => {
    expect(trustedBaseSha).toBe(fixture.trustedBaseSha);
    discovered = [...getRaw()];
  }, 60_000);

  describe("T1.4 family historical record subset", () => {
    it("authenticates all 193 historical destinations and the exact current retirement partition", async () => {
      const knowledge = await verifyIssue1015KnowledgeSuccessor(repoRoot, fixture, allowances);
      const historical = await verifyHistoricalRelocationProof(repoRoot, fixture,
        await historicalIssue913T14Allowances(repoRoot, fixture, allowances),
        { ...t14FamilySuccessorRelocationConfig, activeFiles },
        { commit: "097ad35625cc8ca2401f2cd028404f16a18a75ba", tree: "74b3df3635590d34738896e550e31eb9c8db0948" });
      expect(historical.pairs).toHaveLength(265);
      const historicalActive = historical.pairs.filter(({ old }) => activeFiles.includes(old.file));
      expect(historicalActive).toHaveLength(193);
      expect(new Set(historicalActive.map(({ old }) => old.id)).size).toBe(193);
      expect(new Set(historicalActive.map(({ new: next }) => next.id)).size).toBe(193);
      const result = await applyReviewedT14FamilySuccessorRelocation(
        repoRoot,
        fixture,
        allowances,
        discovered,
        [],
        activeFiles,
      );

      expect(result.relocations.length + knowledge.retired.length).toBe(193);
      expect(new Set(result.relocations.map((entry) => entry.id)).size + knowledge.retired.length).toBe(193);
      expect(new Set(result.relocations.map((entry) => entry.observed.id)).size + knowledge.retired.length).toBe(193);
      expect(result.relocations.every((entry) => !changedFiles.has(entry.observed.file))).toBe(true);
    });
  });
}
