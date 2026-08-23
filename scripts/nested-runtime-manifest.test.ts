import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OWNED_ACCEPTANCE_DESCRIPTOR_ENV } from "../e2e/acceptance/helpers/ownedRuntimeDescriptor";
import {
  OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV,
  initializeNestedRuntimeManifest,
  readNestedRuntimeManifest,
  recordNestedRuntimeFinish,
  recordNestedRuntimeProgress,
  recordNestedRuntimeProvisioning,
  recordNestedRuntimeStart,
} from "../e2e/acceptance/helpers/nestedRuntimeManifest";
import {
  applyDisposableRuntimeEnv,
  captureProcessEnvForDisposableRuntime,
  restoreProcessEnvFromDisposableRuntime,
} from "../e2e/acceptance/helpers/semanticBindingFixture";
import type { DisposablePostCutoverRuntime } from "../e2e/acceptance/helpers/disposablePostCutoverRuntime";
import {
  disposableRuntimeOutcomeFromTestInfo,
  finalizeDisposableRuntimeResources,
  startTrackedNestedRuntimeProcess,
} from "../e2e/acceptance/helpers/disposablePostCutoverRuntime";
import {
  assertNestedRuntimesCleanedForSuccess,
  finalizeRunningNestedRuntimesAfterFailure,
} from "./owned-local-acceptance-runtime";

afterEach(() => vi.unstubAllEnvs());

describe("Gate0 nested disposable runtime contract", () => {
  it("removes exact child resources only after a successful Playwright phase", async () => {
    const removed: string[] = [];

    const result = await finalizeDisposableRuntimeResources({
      outcome: "success",
      retainFailureResources: true,
      stopProcesses: async () => ({
        apiProcess: { status: "stopped" },
        frontendProcess: { status: "stopped" },
        errors: [],
      }),
      removeDatabase: async () => { removed.push("database"); },
      removeObjectStore: async () => { removed.push("object-store"); },
    });

    expect(removed).toEqual(["database", "object-store"]);
    expect(result).toMatchObject({
      state: "cleaned",
      cleanup: {
        database: { status: "removed" },
        objectStore: { status: "removed" },
      },
      errors: [],
    });
  });

  it("stops children but retains exact child resources after an unexpected Playwright failure", async () => {
    const removed: string[] = [];

    const result = await finalizeDisposableRuntimeResources({
      outcome: "failure",
      retainFailureResources: true,
      stopProcesses: async () => ({
        apiProcess: { status: "stopped" },
        frontendProcess: { status: "stopped" },
        errors: [],
      }),
      removeDatabase: async () => { removed.push("database"); },
      removeObjectStore: async () => { removed.push("object-store"); },
    });

    expect(removed).toEqual([]);
    expect(result).toMatchObject({
      state: "failed-retained",
      cleanup: {
        apiProcess: { status: "stopped" },
        frontendProcess: { status: "stopped" },
        database: { status: "retained" },
        objectStore: { status: "retained" },
      },
      errors: [],
    });
    expect(disposableRuntimeOutcomeFromTestInfo({ status: "failed", expectedStatus: "passed" })).toBe("failure");
    expect(disposableRuntimeOutcomeFromTestInfo({ status: "passed", expectedStatus: "passed" })).toBe("success");
  });

  it("records secret-free child resources and exact lifecycle in the parent run manifest", () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-runtime-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    recordNestedRuntimeStart(manifestPath, {
      id: "wiseeff_acceptance_disposable_child",
      databaseName: "wiseeff_acceptance_disposable_child",
      markerPurpose: "parameter-topology",
      migrationRunId: "migration-child",
      objectStoreRoot: path.join(runRoot, "object-child"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
      apiPid: 111,
      frontendPid: 222,
    });
    recordNestedRuntimeFinish(manifestPath, "wiseeff_acceptance_disposable_child", "cleaned", {
      apiProcess: { status: "stopped" },
      frontendProcess: { status: "stopped" },
      database: { status: "removed" },
      objectStore: { status: "removed" },
    });

    const raw = readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(raw) as { children: Array<Record<string, unknown>> };
    expect(raw).not.toContain("postgres://");
    expect(raw).not.toContain("auth-secret");
    expect(manifest.children).toContainEqual(
      expect.objectContaining({
        id: "wiseeff_acceptance_disposable_child",
        state: "cleaned",
        databaseName: "wiseeff_acceptance_disposable_child",
        apiPid: 111,
        frontendPid: 222,
        cleanup: {
          apiProcess: { status: "stopped" },
          frontendProcess: { status: "stopped" },
          database: { status: "removed" },
          objectStore: { status: "removed" },
        },
      }),
    );
    expect(() => assertNestedRuntimesCleanedForSuccess(manifestPath)).not.toThrow();
  });

  it("unsets only the root descriptor during child runtime use and restores it afterward", () => {
    vi.stubEnv(OWNED_ACCEPTANCE_DESCRIPTOR_ENV, "/tmp/root-owned-runtime.json");
    vi.stubEnv(OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV, "parent-scope");
    const snapshot = captureProcessEnvForDisposableRuntime();
    const runtime = {
      databaseUrl: "postgres://child-runtime",
      databaseName: "wiseeff_acceptance_disposable_child",
      migrationRunId: "migration-child",
      markerPurpose: "parameter-topology",
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
      authIssuer: "child-issuer",
      authSecret: "child-secret",
      nestedRuntimeId: "wiseeff_acceptance_disposable_child",
      dispose: async () => undefined,
    } satisfies DisposablePostCutoverRuntime;

    applyDisposableRuntimeEnv(runtime);
    expect(process.env[OWNED_ACCEPTANCE_DESCRIPTOR_ENV]).toBeUndefined();
    expect(process.env[OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV]).toBe(runtime.nestedRuntimeId);

    restoreProcessEnvFromDisposableRuntime(snapshot);
    expect(process.env[OWNED_ACCEPTANCE_DESCRIPTOR_ENV]).toBe("/tmp/root-owned-runtime.json");
    expect(process.env[OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV]).toBe("parent-scope");
  });

  it("takes over running detached child groups after a worker crash and leaves no process orphan", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-worker-crash-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    const api = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], {
      detached: process.platform !== "win32",
      stdio: "ignore",
    });
    const frontend = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], {
      detached: process.platform !== "win32",
      stdio: "ignore",
    });
    await Promise.all([api, frontend].map((child) => new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    })));
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    recordNestedRuntimeStart(manifestPath, {
      id: "wiseeff_acceptance_disposable_crash",
      databaseName: "wiseeff_acceptance_disposable_crash",
      markerPurpose: "parameter-topology",
      migrationRunId: "migration-crash",
      objectStoreRoot: path.join(runRoot, "object-crash"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
      apiPid: api.pid!,
      frontendPid: frontend.pid!,
    });

    await finalizeRunningNestedRuntimesAfterFailure(manifestPath, "Gate0 browser worker crashed.", {
      terminateGraceMs: 25,
      verifyGraceMs: 250,
    });

    expect(() => process.kill(api.pid!, 0)).toThrow();
    expect(() => process.kill(frontend.pid!, 0)).toThrow();
    expect(readNestedRuntimeManifest(manifestPath).children[0]).toMatchObject({
      state: "failed-retained",
      cleanup: {
        apiProcess: { status: "stopped" },
        frontendProcess: { status: "stopped" },
        database: { status: "retained", reason: "Gate0 browser worker crashed." },
        objectStore: { status: "retained", reason: "Gate0 browser worker crashed." },
      },
    });
  });

  it("takes over a partially provisioned child as soon as its first detached PID is known", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-provisioning-crash-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    const api = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], {
      detached: process.platform !== "win32",
      stdio: "ignore",
    });
    await new Promise<void>((resolve, reject) => {
      api.once("spawn", resolve);
      api.once("error", reject);
    });
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    recordNestedRuntimeProvisioning(manifestPath, {
      id: "wiseeff_acceptance_disposable_partial",
      databaseName: "wiseeff_acceptance_disposable_partial",
      markerPurpose: "parameter-topology",
      objectStoreRoot: path.join(runRoot, "object-partial"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    });
    recordNestedRuntimeProgress(manifestPath, "wiseeff_acceptance_disposable_partial", {
      migrationRunId: "migration-partial",
      apiPid: api.pid!,
    });

    expect(readNestedRuntimeManifest(manifestPath).children[0]).toMatchObject({
      state: "provisioning",
      migrationRunId: "migration-partial",
      apiPid: api.pid,
    });
    expect(readNestedRuntimeManifest(manifestPath).children[0]?.frontendPid).toBeUndefined();

    await finalizeRunningNestedRuntimesAfterFailure(manifestPath, "Gate0 browser worker crashed.", {
      terminateGraceMs: 25,
      verifyGraceMs: 250,
    });

    expect(() => process.kill(api.pid!, 0)).toThrow();
    expect(readNestedRuntimeManifest(manifestPath).children[0]).toMatchObject({
      state: "failed-retained",
      cleanup: {
        apiProcess: { status: "stopped" },
        frontendProcess: { status: "not-started" },
        database: { status: "retained", reason: "Gate0 browser worker crashed." },
        objectStore: { status: "retained", reason: "Gate0 browser worker crashed." },
      },
    });
  });

  it("cannot declare success while a nested child is running or terminally failed", () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-success-check-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    recordNestedRuntimeStart(manifestPath, {
      id: "wiseeff_acceptance_disposable_running",
      databaseName: "wiseeff_acceptance_disposable_running",
      markerPurpose: "parameter-topology",
      migrationRunId: "migration-running",
      objectStoreRoot: path.join(runRoot, "object-running"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
      apiPid: 111,
      frontendPid: 222,
    });

    expect(() => assertNestedRuntimesCleanedForSuccess(manifestPath)).toThrow(/not clean.*running/i);
    recordNestedRuntimeFinish(manifestPath, "wiseeff_acceptance_disposable_running", "failed-retained", {
      apiProcess: { status: "stopped" },
      frontendProcess: { status: "stopped" },
      database: { status: "retained" },
      objectStore: { status: "retained" },
    });
    expect(() => assertNestedRuntimesCleanedForSuccess(manifestPath)).toThrow(/not clean.*failed-retained/i);
  });

  it("records an exact child process cleanup failure and never marks the child cleaned", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-failed-kill-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    recordNestedRuntimeStart(manifestPath, {
      id: "wiseeff_acceptance_disposable_failed_kill",
      databaseName: "wiseeff_acceptance_disposable_failed_kill",
      markerPurpose: "parameter-topology",
      migrationRunId: "migration-failed-kill",
      objectStoreRoot: path.join(runRoot, "object-failed-kill"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
      apiPid: 111,
      frontendPid: 222,
    });

    await expect(finalizeRunningNestedRuntimesAfterFailure(
      manifestPath,
      "Gate0 owner timeout.",
      {
        stopProcessGroup: async (pid) => {
          if (pid === 111) throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
        },
      },
    )).rejects.toThrow(/nested runtime finalizations did not settle/i);
    expect(readNestedRuntimeManifest(manifestPath).children[0]).toMatchObject({
      state: "cleanup-failed",
      cleanup: {
        apiProcess: { status: "failed", reason: "operation not permitted" },
        frontendProcess: { status: "stopped" },
        database: { status: "retained", reason: "Gate0 owner timeout." },
        objectStore: { status: "retained", reason: "Gate0 owner timeout." },
      },
    });
    await finalizeRunningNestedRuntimesAfterFailure(
      manifestPath,
      "Gate0 owner timeout.",
      { stopProcessGroup: async () => undefined },
    );
    expect(readNestedRuntimeManifest(manifestPath).children[0]).toMatchObject({
      state: "failed-retained",
      cleanup: {
        apiProcess: { status: "stopped" },
        frontendProcess: { status: "stopped" },
      },
    });
  });

  it("retries a prior cleanup-failed child and closes it as failed-retained after the transient stop error clears", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-retry-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    recordNestedRuntimeStart(manifestPath, {
      id: "wiseeff_acceptance_disposable_retry",
      databaseName: "wiseeff_acceptance_disposable_retry",
      markerPurpose: "parameter-topology",
      migrationRunId: "migration-retry",
      objectStoreRoot: path.join(runRoot, "object-retry"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
      apiPid: 111,
      frontendPid: 222,
    });
    recordNestedRuntimeFinish(manifestPath, "wiseeff_acceptance_disposable_retry", "cleanup-failed", {
      apiProcess: { status: "failed", reason: "transient stop failure" },
      frontendProcess: { status: "stopped" },
      database: { status: "retained", reason: "failure evidence" },
      objectStore: { status: "retained", reason: "failure evidence" },
    });
    const retried: number[] = [];

    await finalizeRunningNestedRuntimesAfterFailure(manifestPath, "Gate0 failure evidence retained.", {
      stopProcessGroup: async (pid) => { retried.push(pid); },
    });

    expect(retried).toEqual([111]);
    expect(readNestedRuntimeManifest(manifestPath).children[0]).toMatchObject({
      state: "failed-retained",
      cleanup: {
        apiProcess: { status: "stopped" },
        frontendProcess: { status: "stopped" },
        database: { status: "retained" },
        objectStore: { status: "retained" },
      },
    });
  });

  it("does not relabel partially removed child resources as retained", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-partial-cleanup-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    recordNestedRuntimeStart(manifestPath, {
      id: "wiseeff_acceptance_disposable_partial_cleanup",
      databaseName: "wiseeff_acceptance_disposable_partial_cleanup",
      markerPurpose: "parameter-topology",
      migrationRunId: "migration-partial-cleanup",
      objectStoreRoot: path.join(runRoot, "object"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
      apiPid: 111,
      frontendPid: 222,
    });
    recordNestedRuntimeFinish(manifestPath, "wiseeff_acceptance_disposable_partial_cleanup", "cleanup-failed", {
      apiProcess: { status: "stopped" },
      frontendProcess: { status: "stopped" },
      database: { status: "removed" },
      objectStore: { status: "failed", reason: "filesystem busy" },
    });

    await expect(finalizeRunningNestedRuntimesAfterFailure(
      manifestPath,
      "Gate0 failure evidence retained.",
      { stopProcessGroup: async () => undefined },
    )).rejects.toThrow(/nested runtime finalizations did not settle/i);

    expect(readNestedRuntimeManifest(manifestPath).children[0]).toMatchObject({
      state: "cleanup-failed",
      cleanup: {
        database: { status: "removed" },
        objectStore: { status: "failed", reason: "filesystem busy" },
      },
    });
  });

  it("recovers a stale dead-owner manifest lock instead of waiting five seconds", () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-stale-lock-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    const lockPath = `${manifestPath}.lock`;
    writeFileSync(lockPath, JSON.stringify({ pid: 999_999_999, token: "stale-owner" }));
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath, old, old);
    const startedAt = Date.now();

    recordNestedRuntimeProvisioning(manifestPath, {
      id: "wiseeff_acceptance_disposable_after_stale_lock",
      databaseName: "wiseeff_acceptance_disposable_after_stale_lock",
      markerPurpose: "parameter-topology",
      objectStoreRoot: path.join(runRoot, "object"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    });

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(readNestedRuntimeManifest(manifestPath).children[0]?.state).toBe("provisioning");
  });

  it("tracks a spawned child before synchronously publishing its PID to the parent manifest", () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-spawn-handshake-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    recordNestedRuntimeProvisioning(manifestPath, {
      id: "wiseeff_acceptance_disposable_spawn_handshake",
      databaseName: "wiseeff_acceptance_disposable_spawn_handshake",
      markerPurpose: "parameter-topology",
      objectStoreRoot: path.join(runRoot, "object"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    });
    const tracked: number[] = [];

    const child = startTrackedNestedRuntimeProcess({
      manifestPath,
      childId: "wiseeff_acceptance_disposable_spawn_handshake",
      process: "api",
      spawn: () => ({ pid: 333 } as ReturnType<typeof spawn>),
      track: (started) => { tracked.push(started.pid!); },
    });

    expect(child.pid).toBe(333);
    expect(tracked).toEqual([333]);
    expect(readNestedRuntimeManifest(manifestPath).children[0]?.apiPid).toBe(333);
  });
});
