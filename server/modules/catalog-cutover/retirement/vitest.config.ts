import { defineConfig } from "vitest/config";

export default defineConfig({ test: {
  environment: "node",
  include: ["server/modules/catalog-cutover/retirement/*.test.ts", "ops/self-hosted/scripts/parameter-catalog-upgrade/legacyWriterRetirement.test.ts"],
  exclude: ["**/*.integration.test.ts"], maxWorkers: 1,
} });
