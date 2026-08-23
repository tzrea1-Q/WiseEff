import {
  existsSync,
  cpSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

import {
  initializeNestedRuntimeManifest,
  recordNestedRuntimeProcessLaunching,
  recordNestedRuntimeProgress,
  recordNestedRuntimeProvisioning,
  recordNestedRuntimeStart,
} from "../e2e/acceptance/helpers/nestedRuntimeManifest";
import type { OwnedLocalAcceptanceRuntimeDescriptorV1 } from "../e2e/acceptance/helpers/ownedRuntimeDescriptor";
import {
  persistGate0ExactValuesForRescan,
  scanGate0ArtifactTree,
} from "./gate0-artifact-sanitizer";
import { finalizeGate0UploadSnapshot } from "./finalize-gate0-upload";
import {
  initializeGate0ProvisioningJournal,
  recordGate0ProvisioningProcessStarted,
} from "./gate0-provisioning-journal";
import {
  listGate0OwnedProcessLaunches,
  readGate0SupervisedProcessIdentity,
  spawnGate0SupervisedProcess,
} from "./gate0-process-launch-supervisor";
import { stopOwnedProcessGroup } from "./owned-process-group";
import { captureExactOwnedDirectoryChain } from "./exact-owned-object-root";
import {
  readProcessStartIdentity,
  type ProcessStartIdentity,
} from "./process-start-identity";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    // Fixtures live below the OS temp directory and never contain user data.
    rmSync(root, { force: true, recursive: true });
  }
});

describe("Gate0 immutable upload finalization", () => {
  it("takes over a pre-rename provisioning stage after the real owner is SIGKILLed", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wiseeff-gate0-stage-crash-"));
    roots.push(root);
    const runsRoot = path.join(root, "acceptance-runtime-runs");
    const runId = "full-stage-crash";
    const runRoot = path.join(runsRoot, runId);
    const uploadRoot = path.join(root, "acceptance-runtime-upload.zip");
    mkdirSync(runsRoot);
    const fixturePath = path.join(import.meta.dirname, "fixtures/gate0-provisioning-stage-owner.ts");
    const owner = spawn(
      process.execPath,
      ["--import", import.meta.resolve("tsx"), fixturePath, runRoot, runId, "5".repeat(40)],
      { cwd: process.cwd(), detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] },
    );
    await waitForJsonLine(owner, (value) => value.state === "staged");
    expect(readdirSync(runsRoot)).toEqual([]);
    process.kill(owner.pid!, "SIGKILL");
    await new Promise<void>((resolve) => owner.once("exit", () => resolve()));

    const result = await finalizeGate0UploadSnapshot({ runsRoot, uploadRoot });

    expect(result.writersStopped).toBe(0);
    expect(existsSync(path.join(runRoot, "runtime-provisioning.json"))).toBe(true);
    expect(existsSync(uploadRoot)).toBe(true);
  }, 15_000);

  it("stops manifest-owned writers before freezing a sanitized upload snapshot", async () => {
    const fixture = createNestedFixture("freeze");
    const secret = "opaque-detached-writer-secret-" + "a".repeat(64);
    const liveLog = path.join(fixture.runRoot, "api.log");
    writeFileSync(liveLog, `before-finalize=${secret}\n`, "utf8");
    persistGate0ExactValuesForRescan(fixture.runsRoot, [secret]);

    const alive = new Set([fixture.apiPid, fixture.frontendPid]);
    const signals: Array<[number, NodeJS.Signals]> = [];
    const result = await finalizeGate0UploadSnapshot({
      runsRoot: fixture.runsRoot,
      uploadRoot: fixture.uploadRoot,
      stopOptions: {
        processGroupExists: (pid) => alive.has(pid),
        readProcessIdentity: (pid) => fixture.identities.get(pid),
        signalProcessGroup(pid, signal) {
          signals.push([pid, signal]);
          alive.delete(pid);
        },
        wait: async () => undefined,
        terminateGraceMs: 0,
        verifyGraceMs: 0,
      },
    });

    expect(signals).toEqual([
      [fixture.apiPid, "SIGTERM"],
      [fixture.frontendPid, "SIGTERM"],
    ]);
    expect(result.scan.violations).toEqual([]);
    const archiveBefore = readFileSync(fixture.uploadRoot);
    const zipBefore = await JSZip.loadAsync(archiveBefore);
    expect(await zipBefore.file(`${fixture.runId}/api.log`)?.async("string"))
      .toBe("before-finalize=[REDACTED]\n");
    expect(statSync(fixture.uploadRoot).mode & 0o222).toBe(0);

    writeFileSync(liveLog, `after-freeze=${secret}\n`, "utf8");
    const zipAfter = await JSZip.loadAsync(readFileSync(fixture.uploadRoot));
    expect(await zipAfter.file(`${fixture.runId}/api.log`)?.async("string"))
      .toBe("before-finalize=[REDACTED]\n");
    expect(readFileSync(fixture.uploadRoot)).toEqual(archiveBefore);
    const rescanRoot = path.join(fixture.root, "archive-rescan");
    mkdirSync(rescanRoot);
    cpSync(fixture.uploadRoot, path.join(rescanRoot, "upload.zip"));
    expect((await scanGate0ArtifactTree(rescanRoot, undefined, [secret])).violations).toEqual([]);
    expect(existsSync(path.join(fixture.runRoot, "object-store"))).toBe(true);

    persistGate0ExactValuesForRescan(fixture.runsRoot, [secret]);
    await finalizeGate0UploadSnapshot({
      runsRoot: fixture.runsRoot,
      uploadRoot: fixture.uploadRoot,
      stopOptions: { processGroupExists: () => false },
    });
    expect(readFileSync(fixture.uploadRoot)).toEqual(archiveBefore);
    expect(existsSync(path.join(fixture.runsRoot, ".gate0-exact-values.v1.enc.json"))).toBe(false);
  });

  it("fails closed without signaling or publishing when a persisted writer identity changed", async () => {
    const fixture = createNestedFixture("reused");
    const signals: Array<[number, NodeJS.Signals]> = [];
    const reusedIdentity: ProcessStartIdentity = {
      startToken: "reused-start-token",
      commandSha256: "f".repeat(64),
    };

    await expect(finalizeGate0UploadSnapshot({
      runsRoot: fixture.runsRoot,
      uploadRoot: fixture.uploadRoot,
      stopOptions: {
        processGroupExists: () => true,
        readProcessIdentity: (pid) => pid === fixture.apiPid ? fixture.identities.get(pid) : reusedIdentity,
        signalProcessGroup(pid, signal) {
          signals.push([pid, signal]);
        },
        wait: async () => undefined,
        terminateGraceMs: 0,
        verifyGraceMs: 0,
      },
    })).rejects.toThrow(/process-start identity|refusing signal/i);

    expect(signals).toEqual([]);
    expect(existsSync(fixture.uploadRoot)).toBe(false);
    expect(existsSync(path.join(fixture.runRoot, "object-store"))).toBe(true);
  });

  it("takes over a registered API after a pre-descriptor owner crash and treats frontend as not-started", async () => {
    const fixture = createNestedFixture("pre_descriptor");
    const descriptorPath = path.join(fixture.runRoot, "runtime.json");
    const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")) as OwnedLocalAcceptanceRuntimeDescriptorV1;
    const manifestPath = path.join(fixture.runRoot, "nested-runtime-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { children: unknown[] };
    manifest.children = [];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    unlinkSync(descriptorPath);
    const journalPath = initializeGate0ProvisioningJournal(fixture.runRoot, {
      run: {
        id: fixture.runId,
        sourceCommit: descriptor.run.sourceCommit,
        worktreeRoot: descriptor.run.worktreeRoot,
        ownerPid: descriptor.run.ownerPid,
        ownerProcessIdentity: descriptor.run.ownerProcessIdentity,
        createdAt: descriptor.run.createdAt,
        state: "provisioning",
      },
      resources: {
        databaseName: descriptor.database.name,
        runRoot: fixture.runRoot,
        objectStoreRoot: descriptor.objectStore.root,
        nestedRuntimeManifest: manifestPath,
      },
    });
    recordGate0ProvisioningProcessStarted(
      journalPath,
      "api",
      "owned API runtime",
      descriptor.processes.api.pid,
      descriptor.processes.api.processIdentity,
    );
    const signals: number[] = [];
    let apiAlive = true;

    await finalizeGate0UploadSnapshot({
      runsRoot: fixture.runsRoot,
      uploadRoot: fixture.uploadRoot,
      stopOptions: {
        processGroupExists: (pid) => pid === descriptor.processes.api.pid && apiAlive,
        readProcessIdentity: (pid) => pid === descriptor.processes.api.pid
          ? descriptor.processes.api.processIdentity
          : undefined,
        signalProcessGroup(pid) { signals.push(pid); apiAlive = false; },
        wait: async () => undefined,
        terminateGraceMs: 0,
        verifyGraceMs: 0,
      },
    });

    expect(signals).toEqual([descriptor.processes.api.pid]);
    expect(existsSync(fixture.uploadRoot)).toBe(true);
    expect(existsSync(descriptor.objectStore.root)).toBe(true);
  });

  it("recovers a supervised partial API after the real owner is SIGKILLed", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wiseeff-gate0-upload-real-crash-"));
    roots.push(root);
    const runsRoot = path.join(root, "acceptance-runtime-runs");
    const runId = "full-partial-sigkill";
    const runRoot = path.join(runsRoot, runId);
    const uploadRoot = path.join(root, "acceptance-runtime-upload.zip");
    mkdirSync(runsRoot);
    const fixturePath = path.join(import.meta.dirname, "fixtures/gate0-partial-provision-owner.ts");
    const owner = spawn(
      process.execPath,
      ["--import", import.meta.resolve("tsx"), fixturePath, runRoot, runId, "2".repeat(40)],
      { cwd: process.cwd(), detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] },
    );
    const ready = await new Promise<{ apiPid: number }>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      owner.stdout!.on("data", (chunk) => {
        stdout += String(chunk);
        const line = stdout.split("\n").find((entry) => entry.trim().startsWith("{"));
        if (line) resolve(JSON.parse(line) as { apiPid: number });
      });
      owner.stderr!.on("data", (chunk) => { stderr += String(chunk); });
      owner.once("exit", (code) => reject(new Error(`partial owner exited ${code}: ${stderr}`)));
    });
    await expect(waitForProcessState(ready.apiPid, true)).resolves.toBeUndefined();
    process.kill(owner.pid!, "SIGKILL");
    await new Promise<void>((resolve) => owner.once("exit", () => resolve()));

    const result = await finalizeGate0UploadSnapshot({
      runsRoot,
      uploadRoot,
      stopOptions: { terminateGraceMs: 100, verifyGraceMs: 100 },
    });

    expect(result.writersStopped).toBeGreaterThanOrEqual(1);
    expect(processExists(ready.apiPid)).toBe(false);
    expect(existsSync(path.join(runRoot, "object-store"))).toBe(true);
    expect(existsSync(uploadRoot)).toBe(true);
  }, 15_000);

  it("runs a supervised Node entry in the exact persisted launcher PID", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wiseeff-gate0-node-entry-"));
    roots.push(root);
    const runRoot = path.join(root, "run");
    const entryPath = path.join(root, "listener.mjs");
    const readyPath = path.join(root, "listener.json");
    mkdirSync(runRoot);
    writeFileSync(entryPath, [
      'import { writeFileSync } from "node:fs";',
      'import { createServer } from "node:net";',
      'const server = createServer();',
      'server.listen(0, "127.0.0.1", () => {',
      '  writeFileSync(process.argv[2], JSON.stringify({ pid: process.pid, port: server.address().port }));',
      '});',
    ].join("\n"), "utf8");
    const launcher = spawnGate0SupervisedProcess({
      supervision: {
        runRoot,
        runId: "node-entry-pid",
        sourceCommit: "3".repeat(40),
        label: "root:node-entry-pid:api",
        nodeEntry: { entry: entryPath, args: [readyPath] },
      },
      cwd: root,
      command: "unused",
      args: [],
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let launcherStderr = "";
    launcher.stderr?.on("data", (chunk) => { launcherStderr += String(chunk); });
    const pid = launcher.pid!;
    const identity = readGate0SupervisedProcessIdentity(launcher);
    expect(identity).toBeDefined();
    expect(identity).toEqual(listGate0OwnedProcessLaunches(runRoot)[0]?.launcherProcessIdentity);
    try {
      await waitForFile(readyPath).catch((error) => {
        throw new Error(`${String(error)}; launcher stderr: ${launcherStderr}`);
      });
      const ready = JSON.parse(readFileSync(readyPath, "utf8")) as { pid: number; port: number };
      expect(ready.pid).toBe(pid);
      expect(ready.port).toBeGreaterThan(0);
      expect(await readProcessIdentityEventually(pid)).toEqual(identity);
    } finally {
      await stopOwnedProcessGroup(launcher, {
        expectedProcessIdentity: identity,
        terminateGraceMs: 100,
        verifyGraceMs: 100,
      });
    }
    await expect(waitForProcessState(pid, false)).resolves.toBeUndefined();
  }, 15_000);

  it("kills a launcher that misses the identity-publication deadline before it can claim late", async () => {
    const fixture = createNestedFixture("delayed_launch_timeout");
    const descriptorPath = path.join(fixture.runRoot, "runtime.json");
    const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")) as OwnedLocalAcceptanceRuntimeDescriptorV1;
    descriptor.phases.visual = { status: "launching", startedAt: new Date().toISOString() };
    writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
    const pidPath = path.join(fixture.root, "delayed-launcher.pid");
    const preloaderPath = path.join(fixture.root, "delay-launcher.mjs");
    writeFileSync(preloaderPath, [
      'import { writeFileSync } from "node:fs";',
      `writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
      "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 12000);",
    ].join("\n"), "utf8");

    expect(() => spawnGate0SupervisedProcess({
      supervision: {
        runRoot: fixture.runRoot,
        runId: fixture.runId,
        sourceCommit: descriptor.run.sourceCommit,
        label: `root:${fixture.runId}:visual`,
      },
      cwd: fixture.root,
      command: "unused",
      args: [],
      env: {
        ...process.env,
        NODE_OPTIONS: [
          process.env.NODE_OPTIONS,
          `--import=${pathToFileURL(preloaderPath).href}`,
        ].filter(Boolean).join(" "),
      },
      stdio: "ignore",
    })).toThrow(/identity publication timed out/i);

    await waitForFile(pidPath);
    const launcherPid = Number(readFileSync(pidPath, "utf8"));
    await expect(waitForProcessState(launcherPid, false)).resolves.toBeUndefined();
    expect(listGate0OwnedProcessLaunches(fixture.runRoot)).toMatchObject([{ state: "aborted" }]);

    await expect(finalizeGate0UploadSnapshot({
      runsRoot: fixture.runsRoot,
      uploadRoot: fixture.uploadRoot,
      stopOptions: { processGroupExists: () => false },
    })).resolves.toBeDefined();
    expect(existsSync(fixture.uploadRoot)).toBe(true);
  }, 15_000);

  it("rejects a launch ledger that claims a different PID without trusting it as aborted", async () => {
    const fixture = createNestedFixture("mismatched_launch_claim");
    const descriptorPath = path.join(fixture.runRoot, "runtime.json");
    const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")) as OwnedLocalAcceptanceRuntimeDescriptorV1;
    descriptor.phases.visual = { status: "launching", startedAt: new Date().toISOString() };
    writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
    const pidPath = path.join(fixture.root, "mismatched-launcher.pid");
    const preloaderPath = path.join(fixture.root, "mismatch-launcher.mjs");
    writeFileSync(preloaderPath, [
      'import { readFileSync, renameSync, writeFileSync } from "node:fs";',
      `writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
      'const recordPath = process.env.WISEEFF_GATE0_LAUNCH_RECORD;',
      'const record = JSON.parse(readFileSync(recordPath, "utf8"));',
      'const candidate = `${recordPath}.forged.tmp`;',
      'writeFileSync(candidate, `${JSON.stringify({ ...record, state: "claimed", launcherPid: 999999998, launcherProcessIdentity: { startToken: "forged-start", commandSha256: "f".repeat(64) } }, null, 2)}\\n`, { mode: 0o600, flush: true });',
      'renameSync(candidate, recordPath);',
    ].join("\n"), "utf8");

    expect(() => spawnGate0SupervisedProcess({
      supervision: {
        runRoot: fixture.runRoot,
        runId: fixture.runId,
        sourceCommit: descriptor.run.sourceCommit,
        label: `root:${fixture.runId}:visual`,
      },
      cwd: fixture.root,
      command: "unused",
      args: [],
      env: {
        ...process.env,
        NODE_OPTIONS: [
          process.env.NODE_OPTIONS,
          `--import=${pathToFileURL(preloaderPath).href}`,
        ].filter(Boolean).join(" "),
      },
      stdio: "ignore",
    })).toThrow(/handshake.*rollback|different launcher PID/i);

    await waitForFile(pidPath);
    const launcherPid = Number(readFileSync(pidPath, "utf8"));
    await expect(waitForProcessState(launcherPid, false)).resolves.toBeUndefined();
    expect(listGate0OwnedProcessLaunches(fixture.runRoot)).toMatchObject([{ state: "rejected" }]);
    await expect(finalizeGate0UploadSnapshot({
      runsRoot: fixture.runsRoot,
      uploadRoot: fixture.uploadRoot,
      stopOptions: { processGroupExists: () => false },
    })).rejects.toThrow(/rejected.*refusing upload/i);
    expect(existsSync(fixture.uploadRoot)).toBe(false);
  });

  it("publishes nothing for an unresolved nested spawn handshake", async () => {
    const fixture = createNestedFixture("nested_launch_gap");
    const manifestPath = path.join(fixture.runRoot, "nested-runtime-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      children: Array<Record<string, unknown>>;
    };
    manifest.children[0]!.state = "provisioning";
    delete manifest.children[0]!.apiPid;
    delete manifest.children[0]!.frontendPid;
    delete manifest.children[0]!.apiProcessIdentity;
    delete manifest.children[0]!.frontendProcessIdentity;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const signals: number[] = [];

    await expect(finalizeGate0UploadSnapshot({
      runsRoot: fixture.runsRoot,
      uploadRoot: fixture.uploadRoot,
      stopOptions: {
        processGroupExists: () => false,
        signalProcessGroup(pid) { signals.push(pid); },
      },
    })).rejects.toThrow(/unresolved writer identity/i);

    expect(signals).toEqual([]);
    expect(existsSync(fixture.uploadRoot)).toBe(false);
  });

  it("does not publish a complete nested manifest candidate while its owner is alive", async () => {
    const fixture = createNestedFixture("live_manifest_candidate");
    const manifestPath = path.join(fixture.runRoot, "nested-runtime-manifest.json");
    const descriptorPath = path.join(fixture.runRoot, "runtime.json");
    const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")) as OwnedLocalAcceptanceRuntimeDescriptorV1;
    descriptor.run.ownerPid = process.pid;
    descriptor.run.ownerProcessIdentity = await readProcessIdentityEventually(process.pid);
    writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
    unlinkSync(manifestPath);
    const candidatePath = `${manifestPath}.${process.pid}.01234567-89ab-4cde-8f01-23456789abcd.tmp`;
    writeFileSync(candidatePath, `${JSON.stringify({
      version: 1,
      kind: "wiseeff-gate0-nested-runtime-manifest",
      parentRunId: fixture.runId,
      sourceCommit: "1".repeat(40),
      children: [],
      updatedAt: "2026-08-23T00:00:00.000Z",
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

    await expect(finalizeGate0UploadSnapshot({
      runsRoot: fixture.runsRoot,
      uploadRoot: fixture.uploadRoot,
      stopOptions: {
        processGroupExists: (pid) => pid === process.pid,
        readProcessIdentity: readProcessStartIdentity,
      },
    })).rejects.toThrow(/owner.*still alive/i);

    expect(existsSync(manifestPath)).toBe(false);
    expect(existsSync(candidatePath)).toBe(true);
    expect(existsSync(fixture.uploadRoot)).toBe(false);
  });

  it("preserves a malformed nested manifest and refuses publication without echoing its bytes", async () => {
    const fixture = createNestedFixture("malformed_nested_manifest");
    const manifestPath = path.join(fixture.runRoot, "nested-runtime-manifest.json");
    const opaque = `opaque-malformed-${"a".repeat(64)}`;
    const malformed = `{"partial":"${opaque}`;
    writeFileSync(manifestPath, malformed, "utf8");

    let failure = "";
    try {
      await finalizeGate0UploadSnapshot({
        runsRoot: fixture.runsRoot,
        uploadRoot: fixture.uploadRoot,
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    expect(failure).toMatch(/nested runtime manifest is malformed/i);
    expect(failure).not.toContain(opaque);
    expect(readFileSync(manifestPath, "utf8")).toBe(malformed);
    expect(existsSync(fixture.uploadRoot)).toBe(false);
  });

  it("refuses a valid-JSON but structurally partial nested manifest before signaling or publication", async () => {
    const fixture = createNestedFixture("partial_nested_manifest");
    const manifestPath = path.join(fixture.runRoot, "nested-runtime-manifest.json");
    const sentinel = path.join(fixture.runRoot, "object-store", "must-retain.txt");
    writeFileSync(sentinel, "retained\n", "utf8");
    writeFileSync(manifestPath, `${JSON.stringify({
      version: 1,
      kind: "wiseeff-gate0-nested-runtime-manifest",
      parentRunId: fixture.runId,
      sourceCommit: "1".repeat(40),
      children: [{
        id: "wiseeff_acceptance_disposable_partial",
        apiProcessState: "not-started",
        frontendProcessState: "not-started",
      }],
    }, null, 2)}\n`, "utf8");
    const signals: number[] = [];

    await expect(finalizeGate0UploadSnapshot({
      runsRoot: fixture.runsRoot,
      uploadRoot: fixture.uploadRoot,
      stopOptions: {
        processGroupExists: () => false,
        signalProcessGroup: (pid) => { signals.push(pid); },
      },
    })).rejects.toThrow(/nested runtime manifest identity is invalid/i);

    expect(signals).toEqual([]);
    expect(existsSync(fixture.uploadRoot)).toBe(false);
    expect(readFileSync(sentinel, "utf8")).toBe("retained\n");
  });

  it("refuses a structurally complete but semantically impossible nested manifest", async () => {
    const fixture = createNestedFixture("impossible_nested_manifest");
    const manifestPath = path.join(fixture.runRoot, "nested-runtime-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      children: Array<Record<string, unknown>>;
    };
    const child = manifest.children[0]!;
    child.state = "cleaned";
    child.databaseName = "unsafe";
    child.objectStoreRoot = "/tmp/outside-owned-run";
    child.apiUrl = "https://external.example/api";
    child.frontendUrl = "http://external.example/ui";
    child.apiProcessState = "not-started";
    child.frontendProcessState = "not-started";
    delete child.apiPid;
    delete child.frontendPid;
    delete child.apiProcessIdentity;
    delete child.frontendProcessIdentity;
    child.completedAt = "2026-08-23T00:01:00.000Z";
    child.cleanup = {
      apiProcess: { status: "stopped" },
      frontendProcess: { status: "failed" },
      database: { status: "retained" },
      objectStore: { status: "failed" },
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const sentinel = path.join(fixture.runRoot, "object-store", "must-retain.txt");
    writeFileSync(sentinel, "retained\n", "utf8");
    const signals: number[] = [];

    await expect(finalizeGate0UploadSnapshot({
      runsRoot: fixture.runsRoot,
      uploadRoot: fixture.uploadRoot,
      stopOptions: {
        processGroupExists: () => false,
        signalProcessGroup: (pid) => { signals.push(pid); },
      },
    })).rejects.toThrow(/nested runtime manifest identity is invalid/i);

    expect(signals).toEqual([]);
    expect(existsSync(fixture.uploadRoot)).toBe(false);
    expect(readFileSync(sentinel, "utf8")).toBe("retained\n");
  });

  it("stops a registered partial nested API and treats its frontend as not-started", async () => {
    const fixture = createNestedFixture("nested_partial");
    const manifestPath = path.join(fixture.runRoot, "nested-runtime-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      children: Array<Record<string, unknown>>;
    };
    manifest.children[0]!.state = "provisioning";
    manifest.children[0]!.frontendProcessState = "not-started";
    delete manifest.children[0]!.frontendPid;
    delete manifest.children[0]!.frontendProcessIdentity;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    let apiAlive = true;
    const signals: number[] = [];

    await finalizeGate0UploadSnapshot({
      runsRoot: fixture.runsRoot,
      uploadRoot: fixture.uploadRoot,
      stopOptions: {
        processGroupExists: (pid) => pid === fixture.apiPid && apiAlive,
        readProcessIdentity: (pid) => fixture.identities.get(pid),
        signalProcessGroup(pid) { signals.push(pid); apiAlive = false; },
        wait: async () => undefined,
        terminateGraceMs: 0,
        verifyGraceMs: 0,
      },
    });

    expect(signals).toEqual([fixture.apiPid]);
    expect(existsSync(fixture.uploadRoot)).toBe(true);
    expect(existsSync(path.join(fixture.runRoot, "object-store"))).toBe(true);
  });

  it("stops an active phase before re-reading late nested and root writers", async () => {
    const fixture = createNestedFixture("phase");
    const root = writeRootDescriptorFixture(fixture);
    const lateApiPid = 41_101;
    const lateFrontendPid = 41_102;
    const lateApiIdentity = processIdentity("late-api", "c");
    const lateFrontendIdentity = processIdentity("late-frontend", "d");
    const alive = new Set([
      root.phasePid,
      root.apiPid,
      root.frontendPid,
      fixture.apiPid,
      fixture.frontendPid,
    ]);
    const identities = new Map(root.identities);
    for (const [pid, identity] of fixture.identities) identities.set(pid, identity);
    const signals: number[] = [];
    let registeredLate = false;

    await finalizeGate0UploadSnapshot({
      runsRoot: fixture.runsRoot,
      uploadRoot: fixture.uploadRoot,
      stopOptions: {
        processGroupExists: (pid) => pid === root.ownerPid ? false : alive.has(pid),
        readProcessIdentity: (pid) => identities.get(pid),
        signalProcessGroup(pid) {
          signals.push(pid);
          alive.delete(pid);
          if (pid === root.phasePid && !registeredLate) {
            registeredLate = true;
            identities.set(lateApiPid, lateApiIdentity);
            identities.set(lateFrontendPid, lateFrontendIdentity);
            alive.add(lateApiPid);
            alive.add(lateFrontendPid);
            recordNestedRuntimeStart(path.join(fixture.runRoot, "nested-runtime-manifest.json"), {
              id: "wiseeff_acceptance_disposable_late",
              databaseName: "wiseeff_acceptance_disposable_late",
              markerPurpose: "td-042-post-cutover",
              migrationRunId: "late-migration",
              objectStoreRoot: path.join(
                realpathSync(fixture.runRoot),
                "nested-object-store",
                "wiseeff_acceptance_disposable_late",
              ),
              apiUrl: "http://127.0.0.1:18711",
              frontendUrl: "http://127.0.0.1:5211",
              apiPid: lateApiPid,
              frontendPid: lateFrontendPid,
              apiProcessIdentity: { ...lateApiIdentity, pid: lateApiPid, port: 18_711 },
              frontendProcessIdentity: { ...lateFrontendIdentity, pid: lateFrontendPid, port: 5_211 },
            });
          }
        },
        wait: async () => undefined,
        terminateGraceMs: 0,
        verifyGraceMs: 0,
      },
    });

    expect(signals[0]).toBe(root.phasePid);
    expect(signals).toEqual(expect.arrayContaining([
      root.apiPid,
      root.frontendPid,
      fixture.apiPid,
      fixture.frontendPid,
      lateApiPid,
      lateFrontendPid,
    ]));
  });

  it("stops a supervised launching phase before discovering its late nested writer", async () => {
    const fixture = createNestedFixture("phase_launch_late_nested");
    const phaseEntry = path.join(fixture.root, "phase-entry.mjs");
    writeFileSync(phaseEntry, "setInterval(() => {}, 1000);\n", "utf8");
    const descriptorPath = path.join(fixture.runRoot, "runtime.json");
    const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")) as OwnedLocalAcceptanceRuntimeDescriptorV1;
    descriptor.phases.visual = { status: "launching", startedAt: new Date().toISOString() };
    writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
    const phase = spawnGate0SupervisedProcess({
      supervision: {
        runRoot: fixture.runRoot,
        runId: fixture.runId,
        sourceCommit: descriptor.run.sourceCommit,
        label: `root:${fixture.runId}:visual`,
        nodeEntry: { entry: phaseEntry, args: [] },
      },
      cwd: process.cwd(),
      command: "unused",
      args: [],
      env: process.env,
      stdio: "ignore",
    });
    const phasePid = phase.pid!;
    const phaseLaunch = listGate0OwnedProcessLaunches(fixture.runRoot)
      .find((launch) => launch.label === `root:${fixture.runId}:visual`);
    if (!phaseLaunch?.launcherProcessIdentity) {
      throw new Error("Test phase did not persist its exact launcher identity.");
    }
    expect(phaseLaunch.launcherPid).toBe(phasePid);
    const phaseIdentity = phaseLaunch.launcherProcessIdentity;
    const lateApiPid = 43_101;
    const lateApiIdentity = processIdentity("launching-late-api", "6");
    const alive = new Set([phasePid]);
    const identities = new Map<number, ProcessStartIdentity>([[phasePid, phaseIdentity]]);
    const signals: number[] = [];
    let registeredLate = false;

    try {
      await finalizeGate0UploadSnapshot({
        runsRoot: fixture.runsRoot,
        uploadRoot: fixture.uploadRoot,
        stopOptions: {
          processGroupExists: (pid) => alive.has(pid),
          readProcessIdentity: (pid) => identities.get(pid),
          signalProcessGroup(pid, signal) {
            signals.push(pid);
            alive.delete(pid);
            if (pid === phasePid && !registeredLate) {
              registeredLate = true;
              alive.add(lateApiPid);
              identities.set(lateApiPid, lateApiIdentity);
              const manifestPath = path.join(fixture.runRoot, "nested-runtime-manifest.json");
              recordNestedRuntimeProvisioning(manifestPath, {
                id: "wiseeff_acceptance_disposable_launching_late",
                databaseName: "wiseeff_acceptance_disposable_launching_late",
                markerPurpose: "td-042-post-cutover",
                objectStoreRoot: path.join(
                  realpathSync(fixture.runRoot),
                  "nested-object-store",
                  "wiseeff_acceptance_disposable_launching_late",
                ),
                apiUrl: "http://127.0.0.1:18721",
                frontendUrl: "http://127.0.0.1:5221",
              });
              recordNestedRuntimeProcessLaunching(
                manifestPath,
                "wiseeff_acceptance_disposable_launching_late",
                "api",
              );
              recordNestedRuntimeProgress(manifestPath, "wiseeff_acceptance_disposable_launching_late", {
                migrationRunId: "launching-late-migration",
                apiPid: lateApiPid,
                apiProcessIdentity: { ...lateApiIdentity, pid: lateApiPid, port: 18_721 },
              });
            }
            if (pid === phasePid) {
              phase.kill(signal);
            }
          },
          wait: async () => undefined,
          terminateGraceMs: 0,
          verifyGraceMs: 0,
        },
      });
    } finally {
      if (phase.exitCode === null && phase.signalCode === null) {
        phase.kill("SIGKILL");
        await Promise.race([
          new Promise<void>((resolve) => phase.once("exit", () => resolve())),
          new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
        ]);
      }
    }

    expect(signals[0]).toBe(phasePid);
    expect(signals).toContain(lateApiPid);
    expect(existsSync(fixture.uploadRoot)).toBe(true);
  });

  it("takes over a supervised phase when the owner dies before descriptor identity publication", async () => {
    const fixture = createNestedFixture("phase_launch_gap");
    const descriptorPath = path.join(fixture.runRoot, "runtime.json");
    const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")) as OwnedLocalAcceptanceRuntimeDescriptorV1;
    descriptor.phases.visual = { status: "launching", startedAt: new Date().toISOString() };
    writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
    const phase = spawnGate0SupervisedProcess({
      supervision: {
        runRoot: fixture.runRoot,
        runId: fixture.runId,
        sourceCommit: descriptor.run.sourceCommit,
        label: `root:${fixture.runId}:visual`,
      },
      cwd: process.cwd(),
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      env: process.env,
      stdio: "ignore",
    });
    expect(phase.pid).toBeTypeOf("number");
    const [launch] = listGate0OwnedProcessLaunches(fixture.runRoot);
    expect(await readProcessIdentityEventually(phase.pid!)).toEqual(launch?.launcherProcessIdentity);

    await finalizeGate0UploadSnapshot({
      runsRoot: fixture.runsRoot,
      uploadRoot: fixture.uploadRoot,
      stopOptions: { terminateGraceMs: 100, verifyGraceMs: 100 },
    });

    expect(processExists(phase.pid!)).toBe(false);
    expect(existsSync(fixture.uploadRoot)).toBe(true);
  }, 15_000);

  it("rejects an undeclared supervised launch without signaling its process group", async () => {
    const fixture = createNestedFixture("undeclared_launch");
    const undeclaredEntry = path.join(fixture.root, "undeclared-entry.mjs");
    writeFileSync(undeclaredEntry, "setInterval(() => {}, 1000);\n", "utf8");
    const descriptor = JSON.parse(
      readFileSync(path.join(fixture.runRoot, "runtime.json"), "utf8"),
    ) as OwnedLocalAcceptanceRuntimeDescriptorV1;
    const undeclared = spawnGate0SupervisedProcess({
      supervision: {
        runRoot: fixture.runRoot,
        runId: fixture.runId,
        sourceCommit: descriptor.run.sourceCommit,
        label: `root:${fixture.runId}:visual`,
        nodeEntry: { entry: undeclaredEntry, args: [] },
      },
      cwd: process.cwd(),
      command: "unused",
      args: [],
      env: process.env,
      stdio: "ignore",
    });
    try {
      await expect(finalizeGate0UploadSnapshot({
        runsRoot: fixture.runsRoot,
        uploadRoot: fixture.uploadRoot,
      })).rejects.toThrow(/no exact declared writer/i);
      expect(processExists(undeclared.pid!)).toBe(true);
      expect(existsSync(fixture.uploadRoot)).toBe(false);
    } finally {
      undeclared.kill("SIGTERM");
      await waitForProcessState(undeclared.pid!, false);
    }
  }, 15_000);

  it("publishes nothing while the exact recorded owner is still alive", async () => {
    const fixture = createNestedFixture("owner_live");
    const root = writeRootDescriptorFixture(fixture);
    const signals: number[] = [];

    await expect(finalizeGate0UploadSnapshot({
      runsRoot: fixture.runsRoot,
      uploadRoot: fixture.uploadRoot,
      stopOptions: {
        processGroupExists: () => true,
        readProcessIdentity: (pid) => root.identities.get(pid),
        signalProcessGroup(pid) { signals.push(pid); },
      },
    })).rejects.toThrow(/owner.*still alive/i);

    expect(signals).toEqual([]);
    expect(existsSync(fixture.uploadRoot)).toBe(false);
  });

  it("fails closed when an interrupted phase launch has no durable writer identity", async () => {
    const fixture = createNestedFixture("launch_gap");
    const root = writeRootDescriptorFixture(fixture);
    const descriptorPath = path.join(fixture.runRoot, "runtime.json");
    const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")) as OwnedLocalAcceptanceRuntimeDescriptorV1;
    descriptor.phases.visual = { status: "launching", startedAt: "2026-08-23T00:00:00.000Z" };
    writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
    const signals: number[] = [];

    await expect(finalizeGate0UploadSnapshot({
      runsRoot: fixture.runsRoot,
      uploadRoot: fixture.uploadRoot,
      stopOptions: {
        processGroupExists: (pid) => pid !== root.ownerPid,
        readProcessIdentity: (pid) => root.identities.get(pid),
        signalProcessGroup(pid) { signals.push(pid); },
      },
    })).rejects.toThrow(/launch.*process-start identity/i);

    expect(signals).toEqual([]);
    expect(existsSync(fixture.uploadRoot)).toBe(false);
  });

  it("runs in a fresh process and carries crash-persisted opaque context into the ZIP", async () => {
    const fixture = createNestedFixture("fresh");
    const secret = `fresh-owner-crash-${"6".repeat(64)}`;
    writeFileSync(path.join(fixture.runRoot, "api.log"), `opaque=${secret}\n`, "utf8");
    persistGate0ExactValuesForRescan(fixture.runsRoot, [secret]);
    const script = pathToFileURL(path.join(process.cwd(), "scripts/finalize-gate0-upload.ts")).href;

    const child = spawnSync(process.execPath, [
      "--import",
      "tsx",
      path.join(process.cwd(), "scripts/finalize-gate0-upload.ts"),
      "--root",
      fixture.runsRoot,
      "--output",
      fixture.uploadRoot,
    ], { cwd: process.cwd(), encoding: "utf8" });

    expect(child.status, `${child.stdout}\n${child.stderr}\n${script}`).toBe(0);
    const zip = await JSZip.loadAsync(readFileSync(fixture.uploadRoot));
    expect(await zip.file(`${fixture.runId}/api.log`)?.async("string")).toBe("opaque=[REDACTED]\n");
    expect(Object.keys(zip.files).some((name) => name.includes("gate0-exact-values"))).toBe(false);
  });

  it("rejects a read-only ZIP that is not bound to the current canonical runs", async () => {
    const fixture = createNestedFixture("stale_archive");
    const secret = `current-run-only-${"5".repeat(64)}`;
    writeFileSync(path.join(fixture.runRoot, "api.log"), secret, "utf8");
    persistGate0ExactValuesForRescan(fixture.runsRoot, [secret]);
    const stale = new JSZip();
    stale.file("gate0-upload-snapshot.json", JSON.stringify({
      version: 1,
      kind: "wiseeff-gate0-immutable-upload-snapshot",
      runs: [{ runId: "stale", sourceCommit: "0".repeat(40) }],
    }));
    writeFileSync(fixture.uploadRoot, await stale.generateAsync({ type: "nodebuffer" }), { mode: 0o444 });
    chmodSync(fixture.uploadRoot, 0o444);

    await expect(finalizeGate0UploadSnapshot({
      runsRoot: fixture.runsRoot,
      uploadRoot: fixture.uploadRoot,
      stopOptions: { processGroupExists: () => false },
    })).rejects.toThrow(/snapshot identity is invalid/i);

    expect(existsSync(path.join(fixture.runsRoot, ".gate0-exact-values.v1.enc.json"))).toBe(true);
  });
});

function createNestedFixture(suffix: string) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), `wiseeff-gate0-upload-${suffix}-`)));
  roots.push(root);
  const runsRoot = path.join(root, "acceptance-runtime-runs");
  const uploadRoot = path.join(root, "acceptance-runtime-upload.zip");
  const runId = `full-${suffix}`;
  const runRoot = path.join(runsRoot, runId);
  const objectStoreRoot = path.join(runRoot, "object-store");
  mkdirSync(objectStoreRoot, { recursive: true });
  const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
  initializeNestedRuntimeManifest(manifestPath, {
    parentRunId: runId,
    sourceCommit: "1".repeat(40),
  });
  const apiPid = 41_001;
  const frontendPid = 41_002;
  const apiIdentity = { pid: apiPid, port: 18_701, startToken: "api-start", commandSha256: "a".repeat(64) };
  const frontendIdentity = {
    pid: frontendPid,
    port: 5_201,
    startToken: "frontend-start",
    commandSha256: "b".repeat(64),
  };
  const nestedDatabaseName = `wiseeff_acceptance_disposable_${suffix}`;
  const nestedObjectStoreRoot = path.join(realpathSync(runRoot), "nested-object-store", nestedDatabaseName);
  mkdirSync(nestedObjectStoreRoot, { recursive: true });
  recordNestedRuntimeStart(manifestPath, {
    id: nestedDatabaseName,
    databaseName: nestedDatabaseName,
    markerPurpose: "td-042-post-cutover",
    migrationRunId: `${suffix}-migration`,
    objectStoreRoot: nestedObjectStoreRoot,
    apiUrl: "http://127.0.0.1:18701",
    frontendUrl: "http://127.0.0.1:5201",
    apiPid,
    frontendPid,
    apiProcessIdentity: apiIdentity,
    frontendProcessIdentity: frontendIdentity,
  });
  const fixture = {
    root,
    runsRoot,
    uploadRoot,
    runId,
    runRoot,
    apiPid,
    frontendPid,
    identities: new Map<number, ProcessStartIdentity>([
      [apiPid, apiIdentity],
      [frontendPid, frontendIdentity],
    ]),
  };
  writeRootDescriptorFixture(fixture, { phaseRunning: false });
  return fixture;
}

function writeRootDescriptorFixture(
  fixture: {
    runRoot: string;
    runId: string;
  },
  options: { phaseRunning?: boolean } = {},
) {
  const ownerPid = 42_000;
  const phasePid = 42_001;
  const apiPid = 42_002;
  const frontendPid = 42_003;
  const ownerIdentity = processIdentity("owner", "e");
  const phaseIdentity = processIdentity("phase", "f");
  const apiIdentity = processIdentity("root-api", "8");
  const frontendIdentity = processIdentity("root-frontend", "9");
  const descriptorPath = path.join(fixture.runRoot, "runtime.json");
  const now = "2026-08-23T00:00:00.000Z";
  const descriptor: OwnedLocalAcceptanceRuntimeDescriptorV1 = {
    version: 1,
    kind: "wiseeff-owned-local-acceptance",
    run: {
      id: fixture.runId,
      sourceCommit: "1".repeat(40),
      worktreeRoot: realpathSync(path.dirname(path.dirname(fixture.runRoot))),
      sourceDirtyBefore: false,
      ownerPid,
      ownerProcessIdentity: ownerIdentity,
      createdAt: now,
      state: "running",
    },
    database: {
      name: "wiseeff_acceptance_full_phase",
      connection: { host: "127.0.0.1", port: 5432, user: "wiseeff", database: "wiseeff_acceptance_full_phase" },
      absentBeforeCreate: true,
      marker: {
        table: "wiseeff_acceptance_runtime_markers",
        purpose: "td-122-gate0",
        runId: fixture.runId,
        sourceCommit: "1".repeat(40),
      },
      migration: { command: "npm run db:migrate", appliedCount: 1, latest: "0115.sql", completedAt: now },
      seed: { command: "npm run db:seed:all", completedAt: now, sentinels: { organizations: 1 } },
    },
    objectStore: {
      mode: "local",
      root: realpathSync(path.join(fixture.runRoot, "object-store")),
      absentBeforeCreate: true,
      markerFile: path.join(
        realpathSync(path.join(fixture.runRoot, "object-store")),
        ".wiseeff-acceptance-owner.json",
      ),
      markerSha256: "7".repeat(64),
      directoryChain: captureExactOwnedDirectoryChain(
        realpathSync(path.dirname(path.dirname(fixture.runRoot))),
        realpathSync(path.join(fixture.runRoot, "object-store")),
      ),
    },
    endpoints: {
      api: { host: "127.0.0.1", port: 18_820, url: "http://127.0.0.1:18820", healthUrl: "http://127.0.0.1:18820/health/live" },
      frontend: { host: "127.0.0.1", port: 5_220, url: "http://127.0.0.1:5220" },
    },
    processes: {
      api: { pid: apiPid, processIdentity: apiIdentity, startedAt: now, command: "node server/index.ts", log: path.join(fixture.runRoot, "api.log") },
      frontend: { pid: frontendPid, processIdentity: frontendIdentity, startedAt: now, command: "vite", log: path.join(fixture.runRoot, "frontend.log") },
    },
    auth: { mode: "production", provider: "hmac", issuer: "wiseeff-phase", smokeSubject: "u-xu-yun" },
    runtime: {
      frontendMode: "api",
      xiaozeDeterministic: true,
      logAnalysisDeterministic: true,
      localWebhookAllowed: true,
      gatewayMode: "simulator",
      hdcAvailable: false,
    },
    phases: {
      visual: options.phaseRunning === false
        ? { status: "pending" }
        : { status: "running", startedAt: now, process: { pid: phasePid, processIdentity: phaseIdentity } },
      browser: { status: "pending" },
    },
    artifacts: {
      runRoot: fixture.runRoot,
      descriptor: descriptorPath,
      operationEvidenceRuntimeSnapshot: path.join(fixture.runRoot, "runtime-operation-evidence-snapshot.json"),
      failureInventory: path.join(fixture.runRoot, "failure-inventory.json"),
      sourceWorktreeOutputManifest: path.join(fixture.runRoot, "source-worktree-output-manifest.json"),
      nestedRuntimeManifest: path.join(fixture.runRoot, "nested-runtime-manifest.json"),
      runtimeLogs: [path.join(fixture.runRoot, "api.log"), path.join(fixture.runRoot, "frontend.log")],
    },
    cleanup: {
      policy: "success-only",
      status: "pending",
      exactDatabaseName: "wiseeff_acceptance_full_phase",
      exactObjectStoreRoot: realpathSync(path.join(fixture.runRoot, "object-store")),
      resources: {
        apiProcess: { status: "pending" },
        frontendProcess: { status: "pending" },
        database: { status: "pending" },
        objectStore: { status: "pending" },
        descriptor: { status: "pending" },
        artifacts: { status: "pending" },
      },
    },
  };
  writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
  return {
    ownerPid,
    phasePid,
    apiPid,
    frontendPid,
    identities: new Map<number, ProcessStartIdentity>([
      [ownerPid, ownerIdentity],
      [phasePid, phaseIdentity],
      [apiPid, apiIdentity],
      [frontendPid, frontendIdentity],
    ]),
  };
}

function processIdentity(startToken: string, digest: string): ProcessStartIdentity {
  return { startToken, commandSha256: digest.repeat(64) };
}

function processExists(pid: number) {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    throw error;
  }
}

async function waitForProcessState(pid: number, expected: boolean) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (processExists(pid) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Process group ${pid} did not become ${expected ? "present" : "absent"}.`);
}

async function waitForFile(filePath: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`File ${path.basename(filePath)} was not published.`);
}

async function readProcessIdentityEventually(pid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const identity = readProcessStartIdentity(pid);
    if (identity) return identity;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Process ${pid} identity did not become readable.`);
}

function waitForJsonLine(
  child: ReturnType<typeof spawn>,
  accept: (value: Record<string, unknown>) => boolean,
) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
      for (const line of stdout.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        const value = JSON.parse(line) as Record<string, unknown>;
        if (accept(value)) resolve(value);
      }
    });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("exit", (code) => reject(new Error(`fixture exited ${code}: ${stderr}`)));
  });
}
