import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";
import {
  runReviewedRelocationRecord,
  type RelocationOutcome,
  type RuntimeTopologyRelocation,
} from "./runtimeTopologyRelocation";

export const t14RewrittenSliceSuccessorRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/t14-rewritten-slice-successor-relocation.json";

const recordSha256 = "9b31f536cdda8ecc9dd4ec0050f6d7344667123e2e2888000546c9635049da4e";

export async function applyReviewedT14RewrittenSliceSuccessorRelocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  existingRelocations: readonly RuntimeTopologyRelocation[] = [],
): Promise<RelocationOutcome> {
  return runReviewedRelocationRecord(repoRoot, fixture, allowances, discovered, existingRelocations, {
    recordPath: t14RewrittenSliceSuccessorRelocationRecordPath,
    recordSha256,
    files: [
      { file: "server/modules/debugging/repository.ts", pairs: 1 },
      { file: "server/modules/dts-reload/behaviouralVerify.ts", pairs: 3 },
      { file: "server/modules/dts-reload/repository.ts", pairs: 14 },
      { file: "server/modules/knowledge/parameterReferences.ts", pairs: 9 },
      { file: "server/modules/logs/analyzer/tools/dbToolBackends.ts", pairs: 5 },
      { file: "server/modules/parameter-files/syncIdentity.ts", pairs: 4 },
      { file: "server/modules/parameter-files/writebackService.ts", pairs: 3 },
      { file: "server/modules/parameter-modules/repository.ts", pairs: 7 },
      { file: "server/modules/parameter-modules/service.test.ts", pairs: 5 },
    ],
    totalPairs: 51,
    rejectAllowanceGrowth: true,
    requireStableStructuralAnchor: true,
    requireStableByteOrder: true,
    requireIdenticalSlice: false,
    requireUnchangedEvidence: false,
  });
}
