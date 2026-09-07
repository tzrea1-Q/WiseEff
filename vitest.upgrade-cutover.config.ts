import { defineConfig } from "vitest/config";
import { assertOwnedUpgradeTestTarget } from "./scripts/upgrade-test-target";

// Run before test collection or any migration harness. Never provisions a target.
assertOwnedUpgradeTestTarget();
export default defineConfig({ test: {
  environment: "node",
  include: [
    "server/modules/catalog-cutover/**/*.test.ts",
    "server/modules/parameter-bindings/cutoverImport/*.test.ts",
    "server/modules/catalog-kernel/security/catalogReader.integration.test.ts",
    "server/modules/release-verification/startup/reportConnection.integration.test.ts",
    "ops/self-hosted/scripts/parameter-catalog-upgrade/deploymentAuthority.integration.test.ts",
  ],
  testTimeout: 30000,
  hookTimeout: 30000,
  maxWorkers: 1,
} });
