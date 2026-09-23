import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";
import {
  runReviewedRelocationRecord,
  type RelocationOutcome,
  type RuntimeTopologyRelocation,
} from "./runtimeTopologyRelocation";

export const issue901RoutesTestRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/issue-901-routes-test-relocation.json";

export async function applyReviewedIssue901RoutesTestRelocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  existingRelocations: readonly RuntimeTopologyRelocation[] = [],
): Promise<RelocationOutcome> {
  return runReviewedRelocationRecord(repoRoot, fixture, allowances, discovered, existingRelocations, {
    recordPath: issue901RoutesTestRelocationRecordPath,
    recordSha256: "fd0be6712cead339a84545e3594a2d5fd51c8d09a0950c26754e5586f497201e",
    files: [{ file: "server/modules/parameters/routes.test.ts", pairs: 5 }],
    totalPairs: 5,
    rejectAllowanceGrowth: true,
    requireStableStructuralAnchor: true,
    requireStableByteOrder: true,
    requireIdenticalSlice: true,
    requireUnchangedEvidence: true,
  });
}
