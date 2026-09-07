type CleanupStage = "reader-pool" | "reader-role" | "admin-pool" | "database";

/** Test-only cleanup: dependencies settle in order; all stages are attempted. */
export async function cleanupPersistedReviewFixture(
  stages: ReadonlyArray<readonly [CleanupStage, () => Promise<unknown>]>,
) {
  let firstFailure: Error | undefined;
  for (const [stage, cleanup] of stages) {
    try { await cleanup(); }
    catch { firstFailure ??= new Error(`review-fixture-cleanup-failed:${stage}`); }
  }
  if (firstFailure) throw firstFailure;
}
