import {
  isTestDatabaseAvailable,
  setupTestDatabaseRun,
  teardownTestDatabaseRun
} from "./testDatabase";

/**
 * Vitest global setup for the server suite: pre-build the migrations-fingerprinted
 * template database once per run (so no suite pays the build inside its own test
 * timeout budget), reap orphaned worker databases from crashed runs, and drop this
 * run's worker databases on teardown.
 */
export default async function setup(): Promise<(() => Promise<void>) | void> {
  if (!(await isTestDatabaseAvailable())) {
    return;
  }
  await setupTestDatabaseRun();
  return async () => {
    await teardownTestDatabaseRun();
  };
}
