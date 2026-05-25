import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts"],
    exclude: ["node_modules/**", ".worktrees/**"],
    passWithNoTests: true,
    pool: "threads"
  }
});
