import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";
import {
  runReviewedRelocationRecord,
  verifyHistoricalRelocationProof,
  type RelocationConfig,
  type RuntimeTopologyRelocation,
} from "./runtimeTopologyRelocation";

export const issue900DashboardRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/issue-900-dashboard-relocation.json";

const issue900Provenance = {
  commit: "411d9f4c828ecffa0c074b1aa93314eae88abfca",
  tree: "751f5ad3e8ef1668d632cf12a5ca0fbe9026b338",
};

const files = [
  { file: "server/modules/parameters/lifecycleRanking.integration.test.ts", pairs: 14 },
  { file: "server/modules/parameters/dashboard/postCutoverDashboard.integration.test.ts", pairs: 1 },
  { file: "server/modules/parameters/dashboard/repository.ts", pairs: 3 },
] as const;

const baseConfig: RelocationConfig = {
  recordPath: issue900DashboardRelocationRecordPath,
  recordSha256: "741ad73987c9904064a8ef2937c8ac95f34247e55029dd3e49d374cdd02ffbdb",
  files,
  totalPairs: 18,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
};

const exactConfig: RelocationConfig = {
  ...baseConfig,
  activeFiles: [files[0].file, files[1].file],
};

const rewrittenConfig: RelocationConfig = {
  ...baseConfig,
  activeFiles: [files[2].file],
  requireIdenticalSlice: false,
  requireUnchangedEvidence: false,
};

const historyConfig: RelocationConfig = {
  ...baseConfig,
  requireIdenticalSlice: false,
  requireUnchangedEvidence: false,
};

export async function applyReviewedIssue900DashboardRelocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  existingRelocations: readonly RuntimeTopologyRelocation[] = [],
) {
  const exact = await runReviewedRelocationRecord(
    repoRoot,
    fixture,
    allowances,
    discovered,
    existingRelocations,
    exactConfig,
  );
  const rewritten = await runReviewedRelocationRecord(
    repoRoot,
    fixture,
    allowances,
    exact.violations,
    [...existingRelocations, ...exact.relocations],
    rewrittenConfig,
  );
  return {
    violations: rewritten.violations,
    relocations: [...exact.relocations, ...rewritten.relocations],
  };
}

export function verifyHistoricalIssue900DashboardRelocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
) {
  return verifyHistoricalRelocationProof(repoRoot, fixture, allowances, historyConfig, issue900Provenance);
}
