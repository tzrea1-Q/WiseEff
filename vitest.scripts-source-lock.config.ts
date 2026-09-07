import { defineConfig } from "vitest/config";

// npm test:scripts and the owned scripts runner execute this entire file before
// parallel suites. Preserve frozen assertions, ancestry and the same deadline.
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/wayfinder/parameter-catalog-rehearsal-source-lock.test.ts"],
    passWithNoTests: false,
    testTimeout: 60_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
