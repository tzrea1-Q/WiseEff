import { defineConfig } from "vitest/config";
import { assertOwnedUpgradeTestTarget } from "./scripts/upgrade-test-target";

// OID 10 credentials are cluster-wide: only this exact file uses the fresh cluster.
assertOwnedUpgradeTestTarget();
export default defineConfig({ test: {
  environment: "node",
  include: ["server/modules/catalog-cutover/retirement/bootstrapCredentialFence.integration.test.ts"],
  passWithNoTests: false,
  maxWorkers: 1,
  fileParallelism: false,
} });
