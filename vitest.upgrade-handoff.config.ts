import { defineConfig } from "vitest/config";
import { assertOwnedUpgradeTestTarget } from "./scripts/upgrade-test-target";

// Enable the real Compose case only after the runner's actual owned target has
// been verified. The generic scripts route intentionally does not enable it.
assertOwnedUpgradeTestTarget();
process.env.UPG_HANDOFF_DOCKER_TEST = "1";

export default defineConfig({ test: {
  environment: "node",
  include: ["ops/self-hosted/scripts/parameter-catalog-upgrade/handoff.test.ts"],
  passWithNoTests: false,
  maxWorkers: 1,
  fileParallelism: false,
} });
