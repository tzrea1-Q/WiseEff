import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const isNestedWorktree = /[\\/]\.worktrees[\\/]/.test(projectRoot);
const siblingWorktreeExclude = isNestedWorktree ? [] : [".worktrees/**"];

// Ops/governance script tests are pure Node behavior tests; they do not need jsdom or the
// React Testing Library setup that `npm test` applies.
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/**/*.test.ts", "ops/**/*.test.ts"],
    exclude: ["node_modules/**", ...siblingWorktreeExclude],
    passWithNoTests: true
  }
});
