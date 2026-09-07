import { defineConfig } from "vitest/config";
import serverConfig from "./vitest.server.config";
import { assertOwnedUpgradeTestTarget } from "./scripts/upgrade-test-target";

// The ordinary backend still collects this file. This narrow development route
// reuses the same fixtures, but never boots their default database without proof.
assertOwnedUpgradeTestTarget();
export default defineConfig({ ...serverConfig, test: {
  ...serverConfig.test,
  include: ["server/modules/release-verification/comparison/aggregateComparisonCorpus.integration.test.ts"],
  passWithNoTests: false,
  maxWorkers: 1,
  fileParallelism: false,
} });
