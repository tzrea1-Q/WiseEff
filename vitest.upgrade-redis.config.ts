import { defineConfig } from "vitest/config";

if (!process.env.UPG_REDIS_TARGET_RECEIPT || !process.env.UPG_EXPECTED_DOCKER_DAEMON_ID) {
  throw new Error("owned-redis-runner-required");
}
export default defineConfig({ test: {
  environment: "node",
  include: ["server/modules/logs/logAnalysisQueueRuntime.redis.integration.test.ts"],
  maxWorkers: 1,
  testTimeout: 30000,
  hookTimeout: 30000,
} });
