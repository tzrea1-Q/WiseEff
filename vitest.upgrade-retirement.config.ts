import { defineConfig } from "vitest/config";

if (!process.env.UPG_TEST_TARGET_RECEIPT || !process.env.TEST_DATABASE_URL) {
  throw new Error("owned-retirement-runner-required");
}
export default defineConfig({ test: {
  environment: "node",
  include: ["server/modules/catalog-cutover/retirement/loginFence.integration.test.ts", "scripts/retirement-endpoint-supervision.docker.test.ts"],
  passWithNoTests: false,
  maxWorkers: 1,
  fileParallelism: false,
} });
