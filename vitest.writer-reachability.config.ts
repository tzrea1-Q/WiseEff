import { defineConfig } from "vitest/config";
import { assertOwnedUpgradeTestTarget } from "./scripts/upgrade-test-target";

assertOwnedUpgradeTestTarget();
export default defineConfig({ test: {
  environment: "node", include: ["server/modules/release-verification/gates/postgres/writerReachability.integration.test.ts"],
  passWithNoTests: false, maxWorkers: 1, fileParallelism: false,
} });
