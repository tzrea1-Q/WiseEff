import { defineConfig } from "vitest/config";
import { assertOwnedUpgradeTestTarget } from "./scripts/upgrade-test-target";

// The admitted parent owns the daemon; each drill creates separate stores.
assertOwnedUpgradeTestTarget();
export default defineConfig({ test: {
  environment: "node",
  include: ["scripts/rehearse-upgrade-recovery.test.ts"],
  passWithNoTests: false,
  maxWorkers: 1,
  fileParallelism: false,
} });
