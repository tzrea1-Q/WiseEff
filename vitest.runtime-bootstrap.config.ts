import { defineConfig } from "vitest/config";

// Bootstrap tests own their PostgreSQL cluster. Do not load server globalSetup:
// it provisions migration fixtures from ambient TEST_DATABASE_URL/DATABASE_URL.
// External-PG cutover tests use vitest.upgrade-cutover.config.ts instead.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "server/shared/database/runtimeConnection*.test.ts",
      "server/shared/database/migrationsExpectedInventory.test.ts",
      "server/testing/selfHostedUpgrade/database.test.ts",
      "server/modules/agent/xiaoze/durableCheckpointer.test.ts",
      "server/modules/logs/workerRunner.test.ts",
      "server/modules/logs/workerRunnerBootstrap.test.ts",
      "server/modules/parameter-catalog-api/productionWire*.test.ts",
      "server/config/env.test.ts",
      "server/modules/release-verification/startup/verifyStartup.test.ts",
      "server/modules/release-verification/startup/publishedStartup.test.ts",
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
