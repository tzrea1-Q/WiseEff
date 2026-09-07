import { defineConfig } from "vitest/config";

// Pure contract checks: no ambient PostgreSQL/global setup. Real SQL cases use
// the repository's independently admitted upgrade-component lane.
export default defineConfig({ test: {
  environment: "node",
  include: ["server/modules/catalog-cutover/activation/*.test.ts"],
  exclude: ["**/*.integration.test.ts"],
  maxWorkers: 1,
} });
