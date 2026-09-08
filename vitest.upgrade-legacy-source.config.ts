import { defineConfig } from "vitest/config";
import { assertOwnedUpgradeTestTarget } from "./scripts/upgrade-test-target";

// This source-only fixture requires the independently pinned retained old image.
// No ambient database or opt-in flag can replace the runner's owned receipt.
assertOwnedUpgradeTestTarget();
process.env.UPG_HANDOFF_DOCKER_TEST = "1";

export default defineConfig({ test: {
  environment: "node",
  include: ["ops/self-hosted/scripts/parameter-catalog-upgrade/handoffLegacySource.integration.test.ts"],
  passWithNoTests: false,
  maxWorkers: 1,
  fileParallelism: false,
} });
