import { defineConfig } from "vitest/config";

// Bootstrap tests own their PostgreSQL cluster. Do not load server globalSetup:
// it provisions migration fixtures from ambient TEST_DATABASE_URL/DATABASE_URL.
// Invoke exact selectors. Cutover imports require an independently owned target
// supplied explicitly by the caller; this config never provisions a default DB.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "server/shared/database/runtimeConnection*.test.ts",
      "server/modules/agent/xiaoze/durableCheckpointer.test.ts",
      "server/modules/logs/workerRunner.test.ts",
      "server/modules/parameter-catalog-api/productionWire*.test.ts",
      "server/config/env.test.ts",
      "server/modules/catalog-cutover/archive/*.test.ts",
      "server/modules/parameter-bindings/cutoverImport/*.test.ts",
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
