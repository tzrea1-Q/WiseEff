import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";
import { runReviewedRelocationRecord, type RuntimeTopologyRelocation } from "./runtimeTopologyRelocation";

export const seedDriverPositionRecordPath = "scripts/fixtures/parameter-catalog-allowlist/seed-driver-owner-position-relocation.json";
export const seedDriverQueryRecordPath = "scripts/fixtures/parameter-catalog-allowlist/seed-driver-owner-query-relocation.json";

// PR #894: independently reviewed exact owner-query and position identities.
const records = [
  { recordPath: seedDriverPositionRecordPath, recordSha256: "47908781431317f8c0a61d50d4c3d8deaf21ec09990788d6d0e92bf5d713c345", pairs: 50, rewritten: false },
  { recordPath: seedDriverQueryRecordPath, recordSha256: "73271be0b26fca47e5811695590084059007c6d8b488ad7679e8da2e2b2e484c", pairs: 11, rewritten: true },
] as const;

export async function applyReviewedSeedDriverLookupRelocation(
  repoRoot: string, fixture: BoundaryViolationFixture, allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[], existingRelocations: readonly RuntimeTopologyRelocation[] = [],
) {
  let violations = [...discovered];
  const relocations: RuntimeTopologyRelocation[] = [];
  for (const record of records) {
    const result = await runReviewedRelocationRecord(repoRoot, fixture, allowances, violations,
      [...existingRelocations, ...relocations], {
        recordPath: record.recordPath, recordSha256: record.recordSha256,
        files: [{ file: "server/modules/parameter-specs/repository.ts", pairs: record.pairs }],
        totalPairs: record.pairs, rejectAllowanceGrowth: true,
        requireStableStructuralAnchor: true, requireStableByteOrder: true,
        requireIdenticalSlice: !record.rewritten, requireUnchangedEvidence: !record.rewritten,
      });
    violations = result.violations;
    relocations.push(...result.relocations);
  }
  return { violations, relocations };
}
