import { defineConfig } from "vitest/config";
import { assertOwnedUpgradeTestTarget } from "../../../../scripts/upgrade-test-target";

assertOwnedUpgradeTestTarget();
export default defineConfig({ test: { environment: "node", maxWorkers: 1, fileParallelism: false,
  include: ["server/modules/catalog-cutover/retirement/legacySqlPrivilegeFence.integration.test.ts"], passWithNoTests: false,
} });
