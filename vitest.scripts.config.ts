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
    // System function/parameter ACL negatives require their own owned PG16
    // cluster. The mandatory upgrade-components job runs this exact suite.
    exclude: ["node_modules/**", ...siblingWorktreeExclude,
      "ops/self-hosted/scripts/parameter-catalog-upgrade/deploymentAuthority.integration.test.ts"],
    passWithNoTests: true,
    // Ancestry walks in rehearsal source-lock tests exceed Vitest's 5s default on Hosted.
    testTimeout: 60_000,
  }
});
