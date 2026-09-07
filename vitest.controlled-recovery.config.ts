import { defineConfig } from "vitest/config";
import { assertOwnedUpgradeTestTarget } from "./scripts/upgrade-test-target";

// Each adapter scenario creates its own source, package and destination stores.
assertOwnedUpgradeTestTarget();
export default defineConfig({ test: {
  environment: "node",
  include: ["ops/self-hosted/storage/controlledRecovery.docker.integration.test.ts"],
  passWithNoTests: false,
  maxWorkers: 1,
  fileParallelism: false,
} });
