import { defineConfig } from "vitest/config";
import { assertOwnedUpgradeTestTarget } from "./scripts/upgrade-test-target";

assertOwnedUpgradeTestTarget();
export default defineConfig({ test: {
  environment: "node", passWithNoTests: false, maxWorkers: 1, fileParallelism: false,
  include: ["ops/self-hosted/scripts/parameter-catalog-upgrade/runtimeRoleSource.integration.test.ts"],
} });
