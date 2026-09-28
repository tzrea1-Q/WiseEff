import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";
import {
  runReviewedRelocationRecord,
  type RelocationConfig,
  type RelocationOutcome,
  type RuntimeTopologyRelocation,
} from "./runtimeTopologyRelocation";

export const t14RewrittenSliceSuccessorRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/t14-rewritten-slice-successor-relocation.json";

const recordSha256 = "56216b0d2463f74a764159e86caf5fa3ab50d3f0e957b66362a840d2294b86a7";

export const t14RewrittenSliceSuccessorRelocationConfig: RelocationConfig = {
  recordPath: t14RewrittenSliceSuccessorRelocationRecordPath,
  recordSha256,
  files: [
    { file: "e2e/acceptance/xiaoze-action.acceptance.spec.ts", pairs: 2 },
    { file: "server/modules/debugging/repository.ts", pairs: 1 },
    { file: "server/modules/dts-reload/behaviouralVerify.ts", pairs: 3 },
    { file: "server/modules/dts-reload/repository.ts", pairs: 14 },
    { file: "server/modules/knowledge/parameterReferences.ts", pairs: 9 },
    { file: "server/modules/logs/analyzer/tools/dbToolBackends.ts", pairs: 5 },
    { file: "server/modules/parameter-files/syncIdentity.ts", pairs: 4 },
    { file: "server/modules/parameter-files/writebackService.ts", pairs: 3 },
    { file: "server/modules/parameter-modules/repository.ts", pairs: 7 },
    { file: "server/modules/parameter-modules/service.test.ts", pairs: 5 },
    { file: "server/modules/parameter-topology/writeLock.ts", pairs: 4 },
  ],
  totalPairs: 57,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
  requireIdenticalSlice: false,
  requireUnchangedEvidence: false,
};

export async function applyReviewedT14RewrittenSliceSuccessorRelocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  existingRelocations: readonly RuntimeTopologyRelocation[] = [],
): Promise<RelocationOutcome> {
  return runReviewedRelocationRecord(
    repoRoot,
    fixture,
    allowances,
    discovered,
    existingRelocations,
    t14RewrittenSliceSuccessorRelocationConfig,
  );
}
