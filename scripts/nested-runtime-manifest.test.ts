import { spawn } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OWNED_ACCEPTANCE_DESCRIPTOR_ENV,
  OWNED_ACCEPTANCE_PARENT_DESCRIPTOR_ENV,
} from "../e2e/acceptance/helpers/ownedRuntimeDescriptor";
import {
  OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV,
  initializeNestedRuntimeManifest,
  readNestedRuntimeManifest,
  recoverNestedRuntimeManifestPublication,
  recordNestedRuntimeFinish,
  recordNestedRuntimeProcessLaunching,
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
  stopManifestTrackedNestedProcesses,
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

function nestedObjectRoot(runRoot: string, databaseName: string) {
  return path.join(realpathSync(runRoot), "nested-object-store", databaseName);
}

afterEach(() => vi.unstubAllEnvs());

describe("Gate0 nested disposable runtime contract", () => {
  it("publishes the initial nested manifest only after a complete private candidate is durable", () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-manifest-atomic-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    let candidatePath = "";

    expect(() => initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-atomic-manifest",
      sourceCommit: "0123456789012345678901234567890123456789",
    }, {
      beforePublish(candidate) {
        candidatePath = candidate;
        expect(existsSync(manifestPath)).toBe(false);
        expect(readNestedRuntimeManifest(candidate)).toMatchObject({
          parentRunId: "full-atomic-manifest",
          sourceCommit: "0123456789012345678901234567890123456789",
          children: [],
        });
        throw new Error("simulated crash before atomic rename");
      },
    })).toThrow(/simulated crash/i);

    expect(existsSync(manifestPath)).toBe(false);
    expect(candidatePath).not.toBe("");
    expect(readdirSync(runRoot)).not.toContain("nested-runtime-manifest.json");
  });

  it("recovers one complete crash-persisted manifest candidate without accepting partial bytes", () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-manifest-recover-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    const candidatePath = `${manifestPath}.123.01234567-89ab-4cde-8f01-23456789abcd.tmp`;
    writeFileSync(candidatePath, `${JSON.stringify({
      version: 1,
      kind: "wiseeff-gate0-nested-runtime-manifest",
      parentRunId: "full-recover-manifest",
      sourceCommit: "0123456789012345678901234567890123456789",
      children: [],
      updatedAt: "2026-08-23T00:00:00.000Z",
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

    recoverNestedRuntimeManifestPublication(manifestPath, {
      parentRunId: "full-recover-manifest",
      sourceCommit: "0123456789012345678901234567890123456789",
    });

    expect(readNestedRuntimeManifest(manifestPath)).toMatchObject({
      parentRunId: "full-recover-manifest",
      sourceCommit: "0123456789012345678901234567890123456789",
      children: [],
    });
    expect(existsSync(candidatePath)).toBe(false);
  });

  it("finishes a hard-link publication interrupted after the canonical manifest became visible", () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-manifest-linked-recover-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    const candidatePath = `${manifestPath}.123.01234567-89ab-4cde-8f01-23456789abcd.tmp`;
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-linked-recover-manifest",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    linkSync(manifestPath, candidatePath);

    expect(recoverNestedRuntimeManifestPublication(manifestPath, {
      parentRunId: "full-linked-recover-manifest",
      sourceCommit: "0123456789012345678901234567890123456789",
    })).toBe(true);

    expect(readNestedRuntimeManifest(manifestPath).children).toEqual([]);
    expect(existsSync(candidatePath)).toBe(false);
  });

  it.each([
    {
      label: "completedAt without cleanup",
      mutate(child: Record<string, unknown>) {
        child.completedAt = "2026-08-23T00:01:00.000Z";
      },
    },
    {
      label: "cleanup without completedAt",
      mutate(child: Record<string, unknown>) {
        child.cleanup = {
          apiProcess: { status: "not-started" },
          frontendProcess: { status: "not-started" },
          database: { status: "retained" },
          objectStore: { status: "retained" },
        };
      },
    },
  ])("rejects a nonterminal child carrying $label", ({ mutate }) => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-manifest-nonterminal-terminal-fields-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    const databaseName = "wiseeff_acceptance_disposable_nonterminal_fields";
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-nonterminal-fields",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    recordNestedRuntimeProvisioning(manifestPath, {
      id: databaseName,
      databaseName,
      markerPurpose: "td-042-post-cutover",
      objectStoreRoot: nestedObjectRoot(runRoot, databaseName),
      apiUrl: "http://127.0.0.1:18731",
      frontendUrl: "http://127.0.0.1:5231",
    });
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      children: Array<Record<string, unknown>>;
    };
    mutate(manifest.children[0]!);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    expect(() => readNestedRuntimeManifest(manifestPath)).toThrow(/manifest identity is invalid/i);
  });

  it("never promotes an unpublished initial-manifest candidate that already claims a writer", () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-manifest-writer-candidate-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    const candidatePath = `${manifestPath}.123.01234567-89ab-4cde-8f01-23456789abcd.tmp`;
    const databaseName = "wiseeff_acceptance_disposable_candidate_writer";
    writeFileSync(candidatePath, `${JSON.stringify({
      version: 1,
      kind: "wiseeff-gate0-nested-runtime-manifest",
      parentRunId: "full-candidate-writer",
      sourceCommit: "0123456789012345678901234567890123456789",
      children: [{
        id: databaseName,
        state: "provisioning",
        databaseName,
        markerPurpose: "parameter-topology",
        objectStoreRoot: nestedObjectRoot(runRoot, databaseName),
        apiUrl: "http://127.0.0.1:19100",
        frontendUrl: "http://127.0.0.1:5190",
        apiProcessState: "running",
        frontendProcessState: "not-started",
        apiPid: 111,
        apiProcessIdentity: fakeProcessIdentity(111, 19_100),
        startedAt: "2026-08-23T00:00:00.000Z",
      }],
      updatedAt: "2026-08-23T00:00:00.000Z",
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

    expect(() => recoverNestedRuntimeManifestPublication(manifestPath, {
      parentRunId: "full-candidate-writer",
      sourceCommit: "0123456789012345678901234567890123456789",
    })).toThrow(/initial.*children|writer/i);

    expect(existsSync(manifestPath)).toBe(false);
    expect(existsSync(candidatePath)).toBe(true);
  });

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

  it("refuses recursive removal after the regular nested container is replaced", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-container-replaced-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    const databaseName = "wiseeff_acceptance_disposable_container_replaced";
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-container-replaced",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    const ownership = prepareNestedObjectStoreRoot(databaseName, manifestPath);
    const markerContent = readFileSync(ownership.markerPath, "utf8");
    const displaced = `${ownership.containerRoot}.displaced`;
    renameSync(ownership.containerRoot, displaced);
    mkdirSync(ownership.root, { recursive: true });
    writeFileSync(ownership.markerPath, markerContent, "utf8");
    const externalSentinel = path.join(ownership.root, "must-retain.txt");
    writeFileSync(externalSentinel, "external\n", "utf8");

    await expect(removeNestedObjectStoreRoot(ownership)).rejects.toThrow(/container|identity|owned object/i);

    expect(readFileSync(externalSentinel, "utf8")).toBe("external\n");
    expect(existsSync(path.join(displaced, databaseName))).toBe(true);
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
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_child"),
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
    vi.stubEnv(OWNED_ACCEPTANCE_PARENT_DESCRIPTOR_ENV, "/tmp/outer-parent-runtime.json");
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
    expect(process.env[OWNED_ACCEPTANCE_PARENT_DESCRIPTOR_ENV]).toBe("/tmp/root-owned-runtime.json");
    expect(process.env[OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV]).toBe(runtime.nestedRuntimeId);

    restoreProcessEnvFromDisposableRuntime(snapshot);
    expect(process.env[OWNED_ACCEPTANCE_DESCRIPTOR_ENV]).toBe("/tmp/root-owned-runtime.json");
    expect(process.env[OWNED_ACCEPTANCE_PARENT_DESCRIPTOR_ENV]).toBe("/tmp/outer-parent-runtime.json");
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
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_crash"),
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
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_reused_pid"),
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
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_partial"),
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

  it("never replaces a persisted process identity while a child is still provisioning", () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-immutable-identity-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    recordNestedRuntimeProvisioning(manifestPath, {
      id: "wiseeff_acceptance_disposable_immutable_identity",
      databaseName: "wiseeff_acceptance_disposable_immutable_identity",
      markerPurpose: "parameter-topology",
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_immutable_identity"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    });
    const original = fakeProcessIdentity(111, 19_100);
    const frontendOriginal = fakeProcessIdentity(222, 5_190);
    recordNestedRuntimeProgress(manifestPath, "wiseeff_acceptance_disposable_immutable_identity", {
      apiPid: original.pid,
      apiProcessIdentity: original,
      frontendPid: frontendOriginal.pid,
      frontendProcessIdentity: frontendOriginal,
    });

    for (const changedIdentity of [
      { ...original, startToken: "different-process-incarnation" },
      { ...original, commandSha256: "f".repeat(64) },
      { ...original, port: original.port + 1 },
    ]) {
      expect(() => recordNestedRuntimeProgress(
        manifestPath,
        "wiseeff_acceptance_disposable_immutable_identity",
        { apiPid: original.pid, apiProcessIdentity: changedIdentity },
      )).toThrow(/API process identity cannot change/i);
    }
    expect(readNestedRuntimeManifest(manifestPath).children[0]?.apiProcessIdentity).toEqual(original);

    expect(() => recordNestedRuntimeProgress(
      manifestPath,
      "wiseeff_acceptance_disposable_immutable_identity",
      {
        migrationRunId: "migration-immutable",
        apiPid: original.pid,
        apiProcessIdentity: original,
        frontendPid: frontendOriginal.pid,
        frontendProcessIdentity: { ...frontendOriginal, commandSha256: "e".repeat(64) },
        ready: true,
      },
    )).toThrow(/frontend process identity cannot change/i);
    expect(readNestedRuntimeManifest(manifestPath).children[0]).toMatchObject({
      state: "provisioning",
      apiProcessIdentity: original,
      frontendProcessIdentity: frontendOriginal,
    });

    recordNestedRuntimeProgress(manifestPath, "wiseeff_acceptance_disposable_immutable_identity", {
      migrationRunId: "migration-immutable",
      apiPid: original.pid,
      apiProcessIdentity: original,
      frontendPid: frontendOriginal.pid,
      frontendProcessIdentity: frontendOriginal,
      ready: true,
    });
    expect(readNestedRuntimeManifest(manifestPath).children[0]).toMatchObject({
      state: "running",
      apiProcessIdentity: original,
      frontendProcessIdentity: frontendOriginal,
    });
  });

  it("never signals a reused nested PID and uses the identity persisted in the manifest", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-disposable-pid-reuse-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    recordNestedRuntimeProvisioning(manifestPath, {
      id: "wiseeff_acceptance_disposable_pid_reuse",
      databaseName: "wiseeff_acceptance_disposable_pid_reuse",
      markerPurpose: "parameter-topology",
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_pid_reuse"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    });
    const identity = fakeProcessIdentity(111, 19_100);
    recordNestedRuntimeProgress(manifestPath, "wiseeff_acceptance_disposable_pid_reuse", {
      apiPid: 111,
      apiProcessIdentity: identity,
    });
    const signals: NodeJS.Signals[] = [];
    let identityReads = 0;

    const result = await stopManifestTrackedNestedProcesses({
      manifestPath,
      childId: "wiseeff_acceptance_disposable_pid_reuse",
      stopOptions: {
        processGroupExists: async () => true,
        readProcessIdentity: () => identityReads++ < 2
          ? identity
          : { startToken: "reused", commandSha256: "f".repeat(64) },
        signalProcessGroup: async (_pid, signal) => { signals.push(signal); },
        terminateGraceMs: 0,
        verifyGraceMs: 0,
        wait: async () => undefined,
      },
    });

    expect(result.apiProcess).toMatchObject({ status: "failed", reason: expect.stringMatching(/identity/i) });
    expect(signals).toEqual(["SIGTERM"]);
  });

  it("treats a proven-absent nested process as stopped without signaling its stale PID", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-disposable-pid-absent-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    recordNestedRuntimeProvisioning(manifestPath, {
      id: "wiseeff_acceptance_disposable_pid_absent",
      databaseName: "wiseeff_acceptance_disposable_pid_absent",
      markerPurpose: "parameter-topology",
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_pid_absent"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    });
    recordNestedRuntimeProgress(manifestPath, "wiseeff_acceptance_disposable_pid_absent", {
      apiPid: 111,
      apiProcessIdentity: fakeProcessIdentity(111, 19_100),
    });
    const signals: NodeJS.Signals[] = [];
    const removed: string[] = [];

    const result = await finalizeDisposableRuntimeResources({
      outcome: "success",
      retainFailureResources: true,
      stopProcesses: () => stopManifestTrackedNestedProcesses({
        manifestPath,
        childId: "wiseeff_acceptance_disposable_pid_absent",
        pidExists: () => false,
        portIsUnused: async (port) => port === 19_100,
        stopOptions: {
          processGroupExists: async () => true,
          readProcessIdentity: () => undefined,
          signalProcessGroup: async (_pid, signal) => { signals.push(signal); },
        },
      }),
      removeDatabase: async () => { removed.push("database"); },
      removeObjectStore: async () => { removed.push("object-store"); },
    });

    expect(result).toMatchObject({
      state: "cleaned",
      cleanup: {
        apiProcess: { status: "stopped" },
        database: { status: "removed" },
        objectStore: { status: "removed" },
      },
      errors: [],
    });
    expect(removed).toEqual(["database", "object-store"]);
    expect(signals).toEqual([]);
  });

  it("refuses a live reused nested PID even when the recorded listener port is unused", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-disposable-live-reuse-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    recordNestedRuntimeProvisioning(manifestPath, {
      id: "wiseeff_acceptance_disposable_live_reuse",
      databaseName: "wiseeff_acceptance_disposable_live_reuse",
      markerPurpose: "parameter-topology",
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_live_reuse"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    });
    recordNestedRuntimeProgress(manifestPath, "wiseeff_acceptance_disposable_live_reuse", {
      apiPid: 111,
      apiProcessIdentity: fakeProcessIdentity(111, 19_100),
    });
    const signals: NodeJS.Signals[] = [];

    const result = await stopManifestTrackedNestedProcesses({
      manifestPath,
      childId: "wiseeff_acceptance_disposable_live_reuse",
      pidExists: () => true,
      portIsUnused: async () => true,
      stopOptions: {
        processGroupExists: async () => true,
        readProcessIdentity: () => ({ startToken: "reused", commandSha256: "f".repeat(64) }),
        signalProcessGroup: async (_pid, signal) => { signals.push(signal); },
      },
    });

    expect(result.apiProcess).toMatchObject({ status: "failed", reason: expect.stringMatching(/identity/i) });
    expect(result.errors).toHaveLength(1);
    expect(signals).toEqual([]);
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
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_running"),
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
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_failed_kill"),
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
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_retry"),
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
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_partial_cleanup"),
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
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_after_stale_lock"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    });

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(readNestedRuntimeManifest(manifestPath).children[0]?.state).toBe("provisioning");
  });

  it("does not let a second stale waiter unlink the new live lock installed by the first", () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-stale-lock-aba-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    const lockPath = `${manifestPath}.lock`;
    writeFileSync(lockPath, JSON.stringify({ pid: 999_999_999, token: "stale-owner" }));
    const liveOwner = {
      pid: process.pid,
      token: "new-live-owner",
      parentRunId: "full-owned",
      processIdentity: readProcessStartIdentity(process.pid),
    };
    const kill = vi.spyOn(process, "kill").mockImplementationOnce(() => {
      unlinkSync(lockPath);
      writeFileSync(lockPath, JSON.stringify(liveOwner));
      throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    });

    expect(() => recordNestedRuntimeProvisioning(manifestPath, {
      id: "wiseeff_acceptance_disposable_aba_waiter",
      databaseName: "wiseeff_acceptance_disposable_aba_waiter",
      markerPurpose: "parameter-topology",
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_aba_waiter"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    })).toThrow(/lock is held by a live owner/i);

    expect(JSON.parse(readFileSync(lockPath, "utf8"))).toMatchObject({
      pid: process.pid,
      token: "new-live-owner",
    });
    expect(readNestedRuntimeManifest(manifestPath).children).toEqual([]);
    kill.mockRestore();
    unlinkSync(lockPath);
  }, 7_000);

  it("recovers the hard-link claim left behind when the stale-lock recoverer crashes", () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-recovery-crash-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    const lockPath = `${manifestPath}.lock`;
    const recoveryPath = `${lockPath}.recovery`;
    writeFileSync(lockPath, JSON.stringify({ pid: 999_999_999, token: "crashed-stale-owner" }));
    linkSync(lockPath, recoveryPath);
    writeFileSync(`${recoveryPath}.owner`, JSON.stringify({
      pid: 999_999_998,
      token: "crashed-recoverer",
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      observedLockOwner: { pid: 999_999_999, token: "crashed-stale-owner" },
    }));
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath, old, old);
    const startedAt = Date.now();

    recordNestedRuntimeProvisioning(manifestPath, {
      id: "wiseeff_acceptance_disposable_after_recovery_crash",
      databaseName: "wiseeff_acceptance_disposable_after_recovery_crash",
      markerPurpose: "parameter-topology",
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_after_recovery_crash"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    });

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(existsSync(recoveryPath)).toBe(false);
    expect(readNestedRuntimeManifest(manifestPath).children[0]?.state).toBe("provisioning");
  });

  it("recovers a reclaim hard-link left behind when recovery-owner reclamation crashes", () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-recovery-reclaim-crash-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    const lockPath = `${manifestPath}.lock`;
    const recoveryPath = `${lockPath}.recovery`;
    const recoveryOwnerPath = `${recoveryPath}.owner`;
    writeFileSync(lockPath, JSON.stringify({ pid: 999_999_999, token: "stale-owner" }));
    linkSync(lockPath, recoveryPath);
    writeFileSync(recoveryOwnerPath, JSON.stringify({
      pid: 999_999_998,
      token: "dead-recovery-owner",
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      observedLockOwner: { pid: 999_999_999, token: "stale-owner" },
    }));
    linkSync(recoveryOwnerPath, `${recoveryOwnerPath}.reclaim`);

    recordNestedRuntimeProvisioning(manifestPath, {
      id: "wiseeff_acceptance_disposable_after_reclaim_crash",
      databaseName: "wiseeff_acceptance_disposable_after_reclaim_crash",
      markerPurpose: "parameter-topology",
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_after_reclaim_crash"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    });

    expect(existsSync(`${recoveryOwnerPath}.reclaim`)).toBe(false);
    expect(readNestedRuntimeManifest(manifestPath).children[0]?.state).toBe("provisioning");
  });

  it("never steals a recovery claim from its still-live owner", () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-live-recovery-owner-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    const lockPath = `${manifestPath}.lock`;
    const recoveryPath = `${lockPath}.recovery`;
    writeFileSync(lockPath, JSON.stringify({ pid: 999_999_999, token: "stale-owner" }));
    linkSync(lockPath, recoveryPath);
    writeFileSync(`${recoveryPath}.owner`, JSON.stringify({
      pid: process.pid,
      token: "live-recovery-owner",
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      processIdentity: readProcessStartIdentity(process.pid),
      observedLockOwner: { pid: 999_999_999, token: "stale-owner" },
    }));

    expect(() => recordNestedRuntimeProvisioning(manifestPath, {
      id: "wiseeff_acceptance_disposable_live_recovery_owner",
      databaseName: "wiseeff_acceptance_disposable_live_recovery_owner",
      markerPurpose: "parameter-topology",
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_live_recovery_owner"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    })).toThrow(/lock is held by a live owner/i);

    expect(existsSync(lockPath)).toBe(true);
    expect(existsSync(recoveryPath)).toBe(true);
    expect(JSON.parse(readFileSync(`${recoveryPath}.owner`, "utf8"))).toMatchObject({
      pid: process.pid,
      token: "live-recovery-owner",
    });
  }, 7_000);

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
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_waiting_writer"),
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
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_original_writer"),
      apiUrl: "http://127.0.0.1:19101",
      frontendUrl: "http://127.0.0.1:5191",
    });
    recordNestedRuntimeProvisioning(manifestPath, {
      id: "wiseeff_acceptance_disposable_waiting_writer",
      databaseName: "wiseeff_acceptance_disposable_waiting_writer",
      markerPurpose: "parameter-topology",
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_waiting_writer"),
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
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_after_pid_reuse"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    });

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(readNestedRuntimeManifest(manifestPath).children[0]?.state).toBe("provisioning");
  });

  it("tracks a spawned child before synchronously publishing its PID to the parent manifest", async () => {
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
      objectStoreRoot: nestedObjectRoot(runRoot, "wiseeff_acceptance_disposable_spawn_handshake"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    });
    const tracked: number[] = [];

    const child = await startTrackedNestedRuntimeProcess({
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

  it("rolls back a tracked child with its captured identity when manifest PID publication fails", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-spawn-publish-failure-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    const childId = "wiseeff_acceptance_disposable_spawn_publish_failure";
    recordNestedRuntimeProvisioning(manifestPath, {
      id: childId,
      databaseName: childId,
      markerPurpose: "parameter-topology",
      objectStoreRoot: nestedObjectRoot(runRoot, childId),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    });
    const capturedIdentity = { startToken: "captured-process-start", commandSha256: "a".repeat(64) };
    const tracked: number[] = [];
    const signals: NodeJS.Signals[] = [];
    let probes = 0;

    await expect(startTrackedNestedRuntimeProcess({
      manifestPath,
      childId,
      process: "api",
      port: 0,
      spawn: () => ({ pid: 111 } as never),
      track: (child) => { tracked.push(child.pid!); },
      readProcessIdentity: () => capturedIdentity,
      rollbackStopOptions: {
        processGroupExists: async () => probes++ === 0,
        readProcessIdentity: () => capturedIdentity,
        signalProcessGroup: async (_pid, signal) => { signals.push(signal); },
        terminateGraceMs: 0,
        wait: async () => undefined,
      },
    })).rejects.toThrow(/process identity is invalid/i);

    expect(tracked).toEqual([111]);
    expect(signals).toEqual(["SIGTERM"]);
    expect(readNestedRuntimeManifest(manifestPath).children[0]).not.toHaveProperty("apiPid");
  });

  it("durably republishes the captured identity when publish and local rollback both fail", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-spawn-double-failure-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    const childId = "wiseeff_acceptance_disposable_spawn_double_failure";
    recordNestedRuntimeProvisioning(manifestPath, {
      id: childId,
      databaseName: childId,
      markerPurpose: "parameter-topology",
      objectStoreRoot: nestedObjectRoot(runRoot, childId),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    });
    const capturedIdentity = { startToken: "captured-process-start", commandSha256: "b".repeat(64) };
    let publishAttempts = 0;

    await expect(startTrackedNestedRuntimeProcess({
      manifestPath,
      childId,
      process: "api",
      port: 19_100,
      spawn: () => ({ pid: 111 } as never),
      track: () => undefined,
      readProcessIdentity: () => capturedIdentity,
      recordProgress: (...args) => {
        if (publishAttempts++ === 0) throw new Error("synthetic first manifest publish failure");
        return recordNestedRuntimeProgress(...args);
      },
      rollbackStopOptions: {
        processGroupExists: async () => true,
        readProcessIdentity: () => capturedIdentity,
        signalProcessGroup: async () => { throw new Error("synthetic EPERM rollback failure"); },
      },
    })).rejects.toThrow(/publish and exact-identity rollback both failed/i);

    expect(publishAttempts).toBe(2);
    expect(readNestedRuntimeManifest(manifestPath).children[0]).toMatchObject({
      apiPid: 111,
      apiProcessIdentity: { pid: 111, port: 19_100, ...capturedIdentity },
    });
  });

  it("keeps a missing-identity handshake cleanup terminally retryable instead of claiming not-started", async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-missing-handshake-identity-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    const childId = "wiseeff_acceptance_disposable_missing_handshake_identity";
    recordNestedRuntimeProvisioning(manifestPath, {
      id: childId,
      databaseName: childId,
      markerPurpose: "parameter-topology",
      objectStoreRoot: nestedObjectRoot(runRoot, childId),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
    });
    recordNestedRuntimeProcessLaunching(manifestPath, childId, "api");
    recordNestedRuntimeFinish(manifestPath, childId, "cleanup-failed", {
      apiProcess: { status: "failed", reason: "process identity capture failed" },
      frontendProcess: { status: "not-started" },
      database: { status: "retained", reason: "startup failed" },
      objectStore: { status: "retained", reason: "startup failed" },
    });

    await expect(finalizeRunningNestedRuntimesAfterFailure(manifestPath, "retry unresolved handshake"))
      .rejects.toThrow(/finalizations did not settle/i);
    expect(readNestedRuntimeManifest(manifestPath).children[0]).toMatchObject({
      state: "cleanup-failed",
      cleanup: { apiProcess: { status: "failed", reason: "process identity capture failed" } },
    });
  });
});
