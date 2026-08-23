import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const pgState = vi.hoisted(() => ({
  mode: "idle" as "idle" | "foreign-existing" | "migration-failure",
  queries: [] as string[],
}));

vi.mock("pg", () => ({
  default: {
    Client: class {
      async connect() {}
      async end() {}
      async query(text: string) {
        pgState.queries.push(text);
        if (/^create database /iu.test(text)) {
          if (pgState.mode === "foreign-existing") throw new Error("database already exists");
          return { rows: [], rowCount: 0 };
        }
        if (/^drop database /iu.test(text)) return { rows: [], rowCount: 0 };
        if (pgState.mode === "migration-failure") throw new Error("synthetic migration failure");
        return { rows: [], rowCount: 0 };
      }
    },
  },
}));

import {
  allocateLoopbackPort,
  afterNestedProcessesStop,
  assertDisposableDatabaseIdentity,
  buildDisposableDatabaseName,
  startDisposablePostCutoverRuntime,
} from "../e2e/acceptance/helpers/disposablePostCutoverRuntime";
import {
  OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV,
  initializeNestedRuntimeManifest,
  readNestedRuntimeManifest,
} from "../e2e/acceptance/helpers/nestedRuntimeManifest";

afterEach(() => {
  pgState.mode = "idle";
  pgState.queries.length = 0;
  vi.unstubAllEnvs();
});

describe("disposable post-cutover acceptance database safety", () => {
  it("allocates a loopback runtime port instead of relying on a shared fixed port", async () => {
    const port = await allocateLoopbackPort({ min: 5_190, max: 5_199 });
    expect(port).toBeGreaterThanOrEqual(5_190);
    expect(port).toBeLessThanOrEqual(5_199);
    expect(port).not.toBe(18_888);
    expect(port).not.toBe(5_174);
  });

  it("uses the dedicated destructive-test database prefix", () => {
    const databaseName = buildDisposableDatabaseName("parameter_topology_round6");
    expect(databaseName).toMatch(
      /^wiseeff_acceptance_disposable_[a-z0-9_]+$/,
    );
    expect(databaseName.length).toBeLessThanOrEqual(63);
  });

  it("rejects shared database names and migration marker mismatches", () => {
    expect(() =>
      assertDisposableDatabaseIdentity({
        databaseName: "wiseeff",
        markerPurpose: "parameter-topology",
        markerMigrationRunId: "run-1",
        cutoverMigrationRunId: "run-1",
        expectedMigrationRunId: "run-1",
      }),
    ).toThrow(/disposable database name/i);

    expect(() =>
      assertDisposableDatabaseIdentity({
        databaseName: "wiseeff_acceptance_disposable_round6_abc",
        markerPurpose: "parameter-topology",
        markerMigrationRunId: "run-other",
        cutoverMigrationRunId: "run-1",
        expectedMigrationRunId: "run-1",
      }),
    ).toThrow(/migration run marker/i);
  });

  it("accepts only an exact test marker and cutover run match", () => {
    expect(() =>
      assertDisposableDatabaseIdentity({
        databaseName: "wiseeff_acceptance_disposable_round6_abc",
        markerPurpose: "parameter-topology",
        markerMigrationRunId: "run-1",
        cutoverMigrationRunId: "run-1",
        expectedMigrationRunId: "run-1",
      }),
    ).not.toThrow();
  });

  it("rejects a marker purpose other than the expected one", () => {
    expect(() =>
      assertDisposableDatabaseIdentity({
        databaseName: "wiseeff_acceptance_disposable_round6_abc",
        markerPurpose: "xiaoze-action",
        markerMigrationRunId: "run-1",
        cutoverMigrationRunId: "run-1",
        expectedMigrationRunId: "run-1",
      }),
    ).toThrow(/parameter-topology test-only marker/i);
  });

  it("accepts a custom marker purpose when the caller expects it", () => {
    expect(() =>
      assertDisposableDatabaseIdentity(
        {
          databaseName: "wiseeff_acceptance_disposable_round6_abc",
          markerPurpose: "xiaoze-action",
          markerMigrationRunId: "run-1",
          cutoverMigrationRunId: "run-1",
          expectedMigrationRunId: "run-1",
        },
        "xiaoze-action",
      ),
    ).not.toThrow();
  });

  it("never deletes nested database or object evidence after process cleanup fails", async () => {
    let resourceCleanupCalls = 0;

    await expect(afterNestedProcessesStop(
      [new Error("operation not permitted")],
      async () => { resourceCleanupCalls += 1; },
    )).rejects.toThrow(/retained for parent takeover/i);

    expect(resourceCleanupCalls).toBe(0);
  });

  it("never drops a foreign same-name database when CREATE reports that it already exists", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-disposable-foreign-database-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-foreign-database",
      sourceCommit: "0".repeat(40),
    });
    vi.stubEnv(OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV, manifestPath);
    pgState.mode = "foreign-existing";

    await expect(startDisposablePostCutoverRuntime(
      "postgres://owner:password@127.0.0.1:5432/postgres",
      { label: "foreign", apiPort: 19_100, frontendPort: 5_190 },
    )).rejects.toThrow(/already exists/i);

    expect(pgState.queries.some((query) => /^create database /iu.test(query))).toBe(true);
    expect(pgState.queries.some((query) => /^drop database /iu.test(query))).toBe(false);
  });

  it("retains a Gate0 nested database, object root, and manifest record after startup fails", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-disposable-startup-failure-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-startup-failure",
      sourceCommit: "0".repeat(40),
    });
    vi.stubEnv(OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV, manifestPath);
    pgState.mode = "migration-failure";

    await expect(startDisposablePostCutoverRuntime(
      "postgres://owner:password@127.0.0.1:5432/postgres",
      { label: "retained", apiPort: 19_101, frontendPort: 5_191 },
    )).rejects.toThrow(/migration failure/i);

    const child = readNestedRuntimeManifest(manifestPath).children[0]!;
    expect(child).toMatchObject({
      state: "failed-retained",
      cleanup: {
        apiProcess: { status: "not-started" },
        frontendProcess: { status: "not-started" },
        database: { status: "retained" },
        objectStore: { status: "retained" },
      },
    });
    expect(existsSync(child.objectStoreRoot)).toBe(true);
    expect(pgState.queries.some((query) => /^drop database /iu.test(query))).toBe(false);
  });
});
