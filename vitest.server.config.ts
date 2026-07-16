import { defineConfig } from "vitest/config";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const isNestedWorktree = /[\\/]\.worktrees[\\/]/.test(projectRoot);
const siblingWorktreeExclude = isNestedWorktree ? [] : [".worktrees/**"];
// Cap workers so shared-PG advisory-lock fixtures do not queue past suite budgets.
const defaultMaxWorkers = Math.min(2, Math.max(1, Math.floor(os.cpus().length / 2) || 1));

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts"],
    exclude: ["node_modules/**", ...siblingWorktreeExclude],
    setupFiles: ["./server/testing/vitest.setup.ts"],
    passWithNoTests: true,
    pool: "forks",
    // Shared Postgres transactional fixtures take an advisory lock; keep a modest
    // worker count so temp-DB suites still parallelize without thrashing connections.
    maxWorkers: process.env.VITEST_SERVER_MAX_WORKERS
      ? Number(process.env.VITEST_SERVER_MAX_WORKERS)
      : defaultMaxWorkers,
    fileParallelism: true,
    // Heavy migration/ingest suites + fixture lock queue need headroom above 60s.
    testTimeout: 180_000,
    hookTimeout: 180_000
  }
});
