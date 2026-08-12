import { defineConfig } from "vitest/config";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const isNestedWorktree = /[\\/]\.worktrees[\\/]/.test(projectRoot);
const siblingWorktreeExclude = isNestedWorktree ? [] : [".worktrees/**"];
// Transactional fixtures run in per-worker databases cloned from a migrations template
// (server/testing/testDatabase.ts), so workers no longer serialize on a cluster lock.
const defaultMaxWorkers = Math.min(4, Math.max(1, Math.floor(os.cpus().length / 2) || 1));

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts"],
    exclude: ["node_modules/**", ...siblingWorktreeExclude],
    setupFiles: ["./server/testing/vitest.setup.ts"],
    // Pre-builds the PG template database so no suite pays the build in its test budget.
    globalSetup: ["./server/testing/globalSetup.ts"],
    passWithNoTests: true,
    // Migration / temp-DB integration cases routinely exceed Vitest's 5s default under CI load.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
    // Worker count balances per-worker database clones against connection pressure;
    // override with VITEST_SERVER_MAX_WORKERS when profiling.
    maxWorkers: process.env.VITEST_SERVER_MAX_WORKERS
      ? Number(process.env.VITEST_SERVER_MAX_WORKERS)
      : defaultMaxWorkers,
    fileParallelism: true
  }
});
