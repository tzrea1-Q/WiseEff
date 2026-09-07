import { defineConfig } from "vitest/config";

// Every database fixture validates the owned PG16 receipt before connecting.
// Parent registers this exact file in the mandatory owned component runner.
export default defineConfig({ test: {
  environment: "node", include: ["server/modules/catalog-cutover/retirement/loginFence.integration.test.ts"], maxWorkers: 1,
} });
