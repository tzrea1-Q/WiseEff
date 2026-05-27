import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const isNestedWorktree = /[\\/]\.worktrees[\\/]/.test(projectRoot);
const siblingWorktreeExclude = isNestedWorktree ? [] : [".worktrees/**"];

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts"],
    exclude: ["node_modules/**", ...siblingWorktreeExclude],
    passWithNoTests: true,
    pool: "threads"
  }
});
