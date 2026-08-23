import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
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
  prepareNestedObjectStoreRoot,
  removeNestedObjectStoreRoot,
  startTrackedNestedRuntimeProcess,
} from "../e2e/acceptance/helpers/disposablePostCutoverRuntime";
import {
  assertNestedRuntimesCleanedForSuccess,
  finalizeRunningNestedRuntimesAfterFailure,
} from "./owned-local-acceptance-runtime";
import { readProcessStartIdentity } from "./process-start-identity";

const fakeProcessIdentity = (pid: number, port: number) => ({
  pid,
  port,
  startToken: `test-start:${pid}`,
  commandSha256: String(pid).padStart(64, "0"),
});

function realProcessIdentity(pid: number, port: number) {
  const identity = readProcessStartIdentity(pid);
  if (!identity) throw new Error(`Test process ${pid} identity is unavailable.`);
  return { pid, port, ...identity };
}

afterEach(() => vi.unstubAllEnvs());

describe("Gate0 nested disposable runtime contract", () => {
  it("exposes a stable process-start identity and returns no identity for a missing PID", () => {
    const identity = readProcessStartIdentity(process.pid);
    expect(identity?.startToken).toMatch(process.platform === "linux"
      ? /^linux-start-ticks:\d+$/u
      : new RegExp(`^${process.platform}-lstart:.+`, "u"));
    expect(identity?.commandSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(readProcessStartIdentity(999_999_999)).toBeUndefined();
  });

  it("owns nested object data below the parent run and refuses a symlink takeover before recursive removal", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-object-owned-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    const databaseName = "wiseeff_acceptance_disposable_object_owned";
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });

    const ownership = prepareNestedObjectStoreRoot(databaseName, manifestPath);
    expect(ownership.root).toBe(path.join(realpathSync(runRoot), "nested-object-store", databaseName));
    expect(readFileSync(ownership.markerPath, "utf8")).toContain(databaseName);

    const outside = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-object-outside-"));
    writeFileSync(path.join(outside, "must-retain.txt"), "retained\n");
    rmSync(ownership.root, { recursive: true });
    mkdirSync(path.dirname(ownership.root), { recursive: true });
    symlinkSync(outside, ownership.root);

    await expect(removeNestedObjectStoreRoot(ownership)).rejects.toThrow(/symbolic link|owned object/i);
    expect(existsSync(path.join(outside, "must-retain.txt"))).toBe(true);
  });

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
      apiProcessIdentity: fakeProcessIdentity(111, 19_100),
      frontendProcessIdentity: fakeProcessIdentity(222, 5_190),
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
      apiProcessIdentity: realProcessIdentity(api.pid!, 19_100),
      frontendProcessIdentity: realProcessIdentity(frontend.pid!, 5_190),
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

  it("refuses to signal a live reused PID when its persisted process-start identity does not match", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-pid-reuse-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], {
      detached: process.platform !== "win32",
      stdio: "ignore",
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    const current = realProcessIdentity(child.pid!, 19_100);
    recordNestedRuntimeProvisioning(manifestPath, {
      id: "wiseeff_acceptance_disposable_reused_pid",
      databaseName: "wiseeff_acceptance_disposable_reused_pid",
      markerPurpose: "parameter-topology",
      objectStoreRoot: path.join(runRoot, "object-reused"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    });
    recordNestedRuntimeProgress(manifestPath, "wiseeff_acceptance_disposable_reused_pid", {
      apiPid: child.pid!,
      apiProcessIdentity: { ...current, startToken: "prior-process-incarnation" },
    });
    const signaled: number[] = [];

    await expect(finalizeRunningNestedRuntimesAfterFailure(
      manifestPath,
      "Gate0 worker crashed.",
      { stopProcessGroup: async (pid) => { signaled.push(pid); } },
    )).rejects.toThrow(/finalizations did not settle/i);

    expect(signaled).toEqual([]);
    expect(readNestedRuntimeManifest(manifestPath).children[0]).toMatchObject({
      state: "cleanup-failed",
      cleanup: {
        apiProcess: { status: "failed", reason: expect.stringMatching(/identity.*refusing signal/i) },
        frontendProcess: { status: "not-started" },
        database: { status: "retained" },
        objectStore: { status: "retained" },
      },
    });

    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("close", resolve));
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
      apiProcessIdentity: realProcessIdentity(api.pid!, 19_100),
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
      apiProcessIdentity: fakeProcessIdentity(111, 19_100),
      frontendProcessIdentity: fakeProcessIdentity(222, 5_190),
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
      apiProcessIdentity: fakeProcessIdentity(111, 19_100),
      frontendProcessIdentity: fakeProcessIdentity(222, 5_190),
    });

    await expect(finalizeRunningNestedRuntimesAfterFailure(
      manifestPath,
      "Gate0 owner timeout.",
      {
        stopProcessGroup: async (pid) => {
          if (pid === 111) throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
        },
        verifyProcessIdentity: async () => true,
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
      { stopProcessGroup: async () => undefined, verifyProcessIdentity: async () => true },
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
      apiProcessIdentity: fakeProcessIdentity(111, 19_100),
      frontendProcessIdentity: fakeProcessIdentity(222, 5_190),
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
      verifyProcessIdentity: async () => true,
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
      apiProcessIdentity: fakeProcessIdentity(111, 19_100),
      frontendProcessIdentity: fakeProcessIdentity(222, 5_190),
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
      { stopProcessGroup: async () => undefined, verifyProcessIdentity: async () => true },
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

  it("never steals an aged manifest lock from its still-live owner", () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-live-lock-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    const lockPath = `${manifestPath}.lock`;
    writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      token: "paused-live-owner",
      parentRunId: "full-owned",
    }));
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath, old, old);

    expect(() => recordNestedRuntimeProvisioning(manifestPath, {
      id: "wiseeff_acceptance_disposable_waiting_writer",
      databaseName: "wiseeff_acceptance_disposable_waiting_writer",
      markerPurpose: "parameter-topology",
      objectStoreRoot: path.join(runRoot, "object-waiting"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    })).toThrow(/exist|lock/i);

    expect(JSON.parse(readFileSync(lockPath, "utf8"))).toMatchObject({
      pid: process.pid,
      token: "paused-live-owner",
    });
    expect(readNestedRuntimeManifest(manifestPath).children).toEqual([]);

    // Once the original owner releases the lock, its state and the waiting
    // writer's retry serialize instead of either writer publishing a stale copy.
    unlinkSync(lockPath);
    recordNestedRuntimeProvisioning(manifestPath, {
      id: "wiseeff_acceptance_disposable_original_writer",
      databaseName: "wiseeff_acceptance_disposable_original_writer",
      markerPurpose: "parameter-topology",
      objectStoreRoot: path.join(runRoot, "object-original"),
      apiUrl: "http://127.0.0.1:19101",
      frontendUrl: "http://127.0.0.1:5191",
    });
    recordNestedRuntimeProvisioning(manifestPath, {
      id: "wiseeff_acceptance_disposable_waiting_writer",
      databaseName: "wiseeff_acceptance_disposable_waiting_writer",
      markerPurpose: "parameter-topology",
      objectStoreRoot: path.join(runRoot, "object-waiting"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    });
    expect(readNestedRuntimeManifest(manifestPath).children.map((child) => child.id)).toEqual([
      "wiseeff_acceptance_disposable_original_writer",
      "wiseeff_acceptance_disposable_waiting_writer",
    ]);
  }, 7_000);

  it("recovers a lock whose PID was reused by a different process identity", () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-reused-pid-lock-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    writeFileSync(`${manifestPath}.lock`, JSON.stringify({
      pid: process.pid,
      token: "dead-process-incarnation",
      parentRunId: "full-owned",
      processIdentity: {
        startToken: "prior-process-incarnation",
        commandSha256: "f".repeat(64),
      },
    }));
    const startedAt = Date.now();

    recordNestedRuntimeProvisioning(manifestPath, {
      id: "wiseeff_acceptance_disposable_after_pid_reuse",
      databaseName: "wiseeff_acceptance_disposable_after_pid_reuse",
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
      port: 19_100,
      spawn: () => spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], {
        detached: process.platform !== "win32",
        stdio: "ignore",
      }),
      track: (started) => { tracked.push(started.pid!); },
    });

    expect(child.pid).toBeTypeOf("number");
    expect(tracked).toEqual([child.pid]);
    expect(readNestedRuntimeManifest(manifestPath).children[0]?.apiPid).toBe(child.pid);
    child.kill("SIGTERM");
  });
});
