import { defineConfig } from "vitest/config";
import path from "node:path";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const isNestedWorktree = /[\\/]\.worktrees[\\/]/.test(projectRoot);
const siblingWorktreeExclude = isNestedWorktree ? [] : [".worktrees/**"];

if (process.env.CI === "true") {
  let cpuQuota = "unavailable";
  try { cpuQuota = readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim(); } catch { /* CPU quota diagnostics are unavailable. */ }
  console.info(`[scripts scheduling] node=${process.version} availableParallelism=${availableParallelism()} configuredMaxWorkers=1 cpu.max=${cpuQuota}`);
}

// Ops/governance script tests are pure Node behavior tests; they do not need jsdom or the
// React Testing Library setup that `npm test` applies.
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/**/*.test.ts", "ops/**/*.test.ts"],
    exclude: ["node_modules/**", ...siblingWorktreeExclude],
    passWithNoTests: true,
    // ponytail: serialize script files to avoid competing full-tree proof scans;
    // if throughput becomes limiting, isolate the scan suites in a Vitest project.
    maxWorkers: 1,
    // Ancestry walks in rehearsal source-lock tests exceed Vitest's 5s default on Hosted.
    testTimeout: 60_000,
  }
});
