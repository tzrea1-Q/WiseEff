/**
 * Issue #859 occurrence identity decision (fifth reviewed relocation record).
 *
 * `#859` ("index DTS draft and writeback versions") shifted the byte positions of
 * 59 already allow-listed legacy Catalog occurrences in three owner-path files
 * without changing their raw SQL slices: it inserted imports and helpers above
 * them. No new debt is granted here and no cross-file identity moves.
 *
 * The frozen S0-ID fixture, its digest, the trusted base and the six retained
 * removals are unchanged. This module only registers the independently reviewed
 * 59-pair map for the shared relocation runner, which aliases each observed HEAD
 * occurrence back to the identity the baseline already carries.
 */

import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";
import {
  runReviewedRelocationRecord,
  type RelocationConfig,
  type RuntimeTopologyRelocation,
} from "./runtimeTopologyRelocation";

const reviewedRecordSha256 = "3820ca839394df51fa317198f67ac7f9c4f1cead3c5d378119b51334f6271a65";

export const editServiceVersionIndexRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/edit-service-version-index-relocation.json";

const editServiceVersionIndexConfig: RelocationConfig = {
  recordPath: editServiceVersionIndexRelocationRecordPath,
  recordSha256: reviewedRecordSha256,
  files: [
    { file: "server/modules/parameter-topology/editService.ts", pairs: 26 },
    { file: "server/modules/parameter-topology/editService.test.ts", pairs: 28 },
    { file: "server/modules/parameter-topology/overlayWriteback.ts", pairs: 5 },
  ],
  totalPairs: 59,
  rejectAllowanceGrowth: true,
  // #859 only inserted imports, a version column and helpers above unchanged text, so
  // every occurrence keeps the structural anchor that identifies its legacy debt. The
  // record must restate that anchor, which is what makes a slice-identical swap fail
  // closed instead of passing as an exact identity decision.
  requireStableStructuralAnchor: true,
};

/** Validate the reviewed 59-pair identity map before granting any alias. */
export async function applyReviewedEditServiceVersionIndexRelocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  existingRelocations: readonly RuntimeTopologyRelocation[] = [],
) {
  return runReviewedRelocationRecord(
    repoRoot,
    fixture,
    allowances,
    discovered,
    existingRelocations,
    editServiceVersionIndexConfig,
  );
}
