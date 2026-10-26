import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveVitestMaxWorkers } from "./scripts/vitest-workers";
import { orderServerFiles } from "./scripts/server-shard-plan";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const isNestedWorktree = /[\\/]\.worktrees[\\/]/.test(projectRoot);
const siblingWorktreeExclude = isNestedWorktree ? [] : [".worktrees/**"];
class ServerDurationSequencer extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const relativeFile = (file: TestSpecification) => path.relative(projectRoot, file.moduleId).split(path.sep).join("/");
    const ranks = new Map(orderServerFiles(files.map(relativeFile)).map((file, index) => [file, index]));
    return [...files].sort((left, right) => ranks.get(relativeFile(left))! - ranks.get(relativeFile(right))!);
  }
}
// Transactional fixtures run in per-worker databases cloned from a migrations template
// (server/testing/testDatabase.ts), so workers no longer serialize on a cluster lock.

export default defineConfig({
  plugins: [{
    name: "test-cluster-role-migration-lease",
    enforce: "pre",
    resolveId(source, importer) {
      // Route test replay calls through the lease without editing frozen test blobs.
      if (importer?.split("?")[0]?.endsWith(".test.ts")
        && source.endsWith("/shared/database/migrations")) {
        return path.resolve(projectRoot, "server/testing/tempDatabase.ts");
      }
      if (importer && !importer.split("?")[0]?.endsWith("/testing/labRuntimeLogins.ts")
        && source.endsWith("/provisionRuntimeLogins")) {
        return path.resolve(projectRoot, "server/testing/labRuntimeLogins.ts");
      }
    },
  }],
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "src"),
      "@wiseeff/dto-schemas": path.resolve(projectRoot, "server/modules/contracts/dtoSchemas/index.ts"),
    },
  },
  test: {
    environment: "node",
    sequence: { sequencer: ServerDurationSequencer },
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
    maxWorkers: resolveVitestMaxWorkers("server"),
    fileParallelism: true
  }
});
