import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "idle" as "idle" | "identity-failure" | "publish-rollback-republish-failure",
  spawnCount: 0,
  stopCalls: 0,
  restartPublishAttempts: 0,
  identities: new Map<number, { startToken: string; commandSha256: string }>(),
}));

vi.mock("pg", () => ({
  default: {
    Client: class {
      private readonly databaseName: string;

      constructor(options: { connectionString: string }) {
        this.databaseName = new URL(options.connectionString).pathname.slice(1);
      }

      async connect() {}
      async end() {}
      async query(text: string, values: unknown[] = []) {
        if (/information_schema\.columns/iu.test(text)) {
          return { rows: [{ is_nullable: "YES" }], rowCount: 1 };
        }
        if (/select current_database\(\)/iu.test(text)) {
          return {
            rows: [{
              database_name: this.databaseName,
              purpose: values[0],
              marker_migration_run_id: "migration-test",
              cutover_migration_run_id: "migration-test",
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }
    },
  },
}));

vi.mock("../server/shared/database/migrations", () => ({
  applyMigrations: vi.fn(async () => undefined),
}));

vi.mock("../server/modules/auth/baselineCatalog", () => ({
  seedBaselinePlatformRoles: vi.fn(async () => undefined),
}));

vi.mock("../server/modules/parameter-topology/migration", () => ({
  migrateParameterIdentities: vi.fn(async () => ({ blockers: [], migrationRunId: "migration-test" })),
  applyParameterIdentityCutover: vi.fn(async () => undefined),
}));

vi.mock("../scripts/process-start-identity", () => ({
  readProcessStartIdentity(pid: number) {
    if (state.mode === "identity-failure" && pid === 41_003) return undefined;
    return state.identities.get(pid);
  },
  sameProcessStartIdentity(expected: { startToken: string; commandSha256: string }, current: { startToken: string; commandSha256: string } | undefined) {
    return current !== undefined && expected.startToken === current.startToken && expected.commandSha256 === current.commandSha256;
  },
}));

vi.mock("../scripts/gate0-process-launch-supervisor", () => ({
  readGate0SupervisedProcessIdentity(child: FakeChild) {
    if (!child.identityAvailable) return undefined;
    return child.identity;
  },
  spawnGate0SupervisedProcess(input: { supervision: { label: string } }) {
    state.spawnCount += 1;
    const pid = 41_000 + state.spawnCount;
    const identity = {
      startToken: `restart-test-${pid}`,
      commandSha256: String.fromCharCode(97 + state.spawnCount).repeat(64),
    };
    state.identities.set(pid, identity);
    return new FakeChild(pid, identity, !(state.mode === "identity-failure" && state.spawnCount === 3));
  },
}));

vi.mock("../scripts/owned-process-group", async () => {
  const actual = await vi.importActual<typeof import("../scripts/owned-process-group")>("../scripts/owned-process-group");
  return {
    ...actual,
    async stopOwnedProcessGroup(...args: Parameters<typeof actual.stopOwnedProcessGroup>) {
      state.stopCalls += 1;
      if (state.mode === "publish-rollback-republish-failure" && state.stopCalls === 2) {
        throw new Error("synthetic replacement rollback failure");
      }
      return actual.stopOwnedProcessGroup(args[0], {
        ...args[1],
        processGroupExists: (pid) => state.identities.has(pid),
        signalProcessGroup: (pid) => { state.identities.delete(pid); },
        wait: async () => undefined,
        terminateGraceMs: 0,
        verifyGraceMs: 0,
      });
    },
  };
});

vi.mock("../e2e/acceptance/helpers/nestedRuntimeManifest", async () => {
  const actual = await vi.importActual<typeof import("../e2e/acceptance/helpers/nestedRuntimeManifest")>(
    "../e2e/acceptance/helpers/nestedRuntimeManifest",
  );
  return {
    ...actual,
    recordNestedRuntimeApiRestart(...args: Parameters<typeof actual.recordNestedRuntimeApiRestart>) {
      state.restartPublishAttempts += 1;
      if (
        state.mode === "publish-rollback-republish-failure" ||
        (state.mode === "idle" && state.restartPublishAttempts === 1)
      ) {
        throw new Error("synthetic replacement manifest publication failure");
      }
      return actual.recordNestedRuntimeApiRestart(...args);
    },
  };
});

import {
  startDisposablePostCutoverRuntime,
} from "../e2e/acceptance/helpers/disposablePostCutoverRuntime";
import {
  OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV,
  initializeNestedRuntimeManifest,
  readNestedRuntimeManifest,
} from "../e2e/acceptance/helpers/nestedRuntimeManifest";

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  readonly stdout = null;
  readonly stderr = null;

  constructor(
    readonly pid: number,
    readonly identity: { startToken: string; commandSha256: string },
    readonly identityAvailable: boolean,
  ) {
    super();
  }

  kill() {
    this.exitCode = 0;
    this.emit("close", 0);
    return true;
  }
}

const roots: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
  state.mode = "idle";
  state.spawnCount = 0;
  state.stopCalls = 0;
  state.restartPublishAttempts = 0;
  state.identities.clear();
});

describe("disposable runtime restart failure closure", () => {
  it("latches identity capture failure through dispose and blocks a second restart", async () => {
    state.mode = "identity-failure";
    const runtime = await startFixture();

    await expect(runtime.restartApi()).rejects.toThrow(/identity capture failed/i);
    await expect(runtime.restartApi()).rejects.toThrow(/blocked by an unresolved previous restart failure/i);
    await expect(runtime.dispose("success")).rejects.toThrow(/cleanup failed/i);
    assertRetainedRestartFailure(runtime.databaseName);
  });

  it("latches publish, rollback, and republish failure through dispose and blocks a second restart", async () => {
    state.mode = "publish-rollback-republish-failure";
    const runtime = await startFixture();

    await expect(runtime.restartApi()).rejects.toThrow(/publish and exact-identity rollback both failed/i);
    await expect(runtime.restartApi()).rejects.toThrow(/blocked by an unresolved previous restart failure/i);
    await expect(runtime.dispose("success")).rejects.toThrow(/cleanup failed/i);
    expect(state.restartPublishAttempts).toBe(2);
    assertRetainedRestartFailure(runtime.databaseName);
  });
});

async function startFixture() {
  globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 }));
  const root = mkdtempSync(path.join(tmpdir(), "wiseeff-disposable-restart-failure-"));
  roots.push(root);
  const manifestPath = path.join(root, "nested-runtime-manifest.json");
  mkdirSync(root, { recursive: true });
  initializeNestedRuntimeManifest(manifestPath, {
    parentRunId: "full-disposable-restart-failure",
    sourceCommit: "0".repeat(40),
  });
  vi.stubEnv(OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV, manifestPath);
  return startDisposablePostCutoverRuntime(
    "postgres://owner:password@127.0.0.1:55438/postgres",
    { label: "restart-failure", apiPort: 19_150, frontendPort: 5_195 },
  );
}

function assertRetainedRestartFailure(databaseName: string) {
  const manifest = readNestedRuntimeManifest(
    path.join(roots[0]!, "nested-runtime-manifest.json"),
  );
  const child = manifest.children.find((entry) => entry.databaseName === databaseName);
  expect(child).toMatchObject({
    state: "cleanup-failed",
    cleanup: {
      apiProcess: { status: "failed" },
      database: { status: "retained" },
      objectStore: { status: "retained" },
    },
  });
}
