import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";
import {
  runReviewedRelocationRecord,
  type RelocationOutcome,
  type RuntimeTopologyRelocation,
} from "./runtimeTopologyRelocation";

export const t14FamilySuccessorRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/t14-t22-family-successor-relocation.json";

const recordSha256 = "caab30775516a556dc0c64292d801b02cf07fec1f9b0ec29cd8d319575218497";

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
      { file: "server/modules/parameter-specs/routes.ts", pairs: 63 },
      { file: "server/modules/parameter-topology/writeLock.ts", pairs: 4 },
    ],
    totalPairs: 155,
    rejectAllowanceGrowth: true,
    requireStableStructuralAnchor: true,
    requireStableByteOrder: true,
  });
}
