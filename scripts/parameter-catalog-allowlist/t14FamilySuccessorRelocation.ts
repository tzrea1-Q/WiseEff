import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";
import {
  runReviewedRelocationRecord,
  type RelocationOutcome,
  type RuntimeTopologyRelocation,
} from "./runtimeTopologyRelocation";

export const t14FamilySuccessorRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/t14-t22-family-successor-relocation.json";

const recordSha256 = "6e55b1378acf6f4439392ae53971092a996c12b41fe358fa31622f052e7f4cf2";

export async function applyReviewedT14FamilySuccessorRelocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  existingRelocations: readonly RuntimeTopologyRelocation[] = [],
): Promise<RelocationOutcome> {
  return runReviewedRelocationRecord(repoRoot, fixture, allowances, discovered, existingRelocations, {
    recordPath: t14FamilySuccessorRelocationRecordPath,
    recordSha256,
    files: [
      { file: "e2e/acceptance/knowledge.acceptance.spec.ts", pairs: 13 },
      { file: "server/modules/agent/tools/actionTools.ts", pairs: 2 },
      { file: "server/modules/debugging/repository.ts", pairs: 9 },
      { file: "server/modules/dts-reload/repository.ts", pairs: 4 },
      { file: "server/modules/dts-reload/service.test.ts", pairs: 6 },
      { file: "server/modules/knowledge/parameterReferences.ts", pairs: 6 },
      { file: "server/modules/logs/analyzer/tools/dbToolBackends.ts", pairs: 2 },
      { file: "server/modules/parameter-files/conflictService.test.ts", pairs: 3 },
      { file: "server/modules/parameter-files/syncIdentity.ts", pairs: 2 },
      { file: "server/modules/parameter-files/syncService.test.ts", pairs: 1 },
      { file: "server/modules/parameter-modules/recomputeDryRun.integration.test.ts", pairs: 3 },
      { file: "server/modules/parameter-modules/repository.ts", pairs: 13 },
      { file: "server/modules/parameter-modules/service.test.ts", pairs: 24 },
      { file: "server/modules/parameter-specs/definitionVerification.ts", pairs: 41 },
      { file: "server/modules/parameter-specs/effectiveDefinition.integration.test.ts", pairs: 69 },
      { file: "server/modules/parameter-specs/routes.ts", pairs: 63 },
      { file: "server/modules/parameter-topology/writeLock.ts", pairs: 4 },
    ],
    totalPairs: 265,
    rejectAllowanceGrowth: true,
    requireStableStructuralAnchor: true,
    requireStableByteOrder: true,
  });
}
