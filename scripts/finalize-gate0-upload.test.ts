import {
  existsSync,
  cpSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

import {
  initializeNestedRuntimeManifest,
  recordNestedRuntimeStart,
} from "../e2e/acceptance/helpers/nestedRuntimeManifest";
import type { OwnedLocalAcceptanceRuntimeDescriptorV1 } from "../e2e/acceptance/helpers/ownedRuntimeDescriptor";
import {
  persistGate0ExactValuesForRescan,
  scanGate0ArtifactTree,
} from "./gate0-artifact-sanitizer";
import { finalizeGate0UploadSnapshot } from "./finalize-gate0-upload";
import type { ProcessStartIdentity } from "./process-start-identity";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    // Fixtures live below the OS temp directory and never contain user data.
    rmSync(root, { force: true, recursive: true });
  }
});

describe("Gate0 immutable upload finalization", () => {
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

  it("publishes nothing for a pre-descriptor owner crash", async () => {
    const fixture = createNestedFixture("pre_descriptor");
    unlinkSync(path.join(fixture.runRoot, "runtime.json"));
    const signals: number[] = [];

    await expect(finalizeGate0UploadSnapshot({
      runsRoot: fixture.runsRoot,
      uploadRoot: fixture.uploadRoot,
      stopOptions: {
        processGroupExists: () => true,
        signalProcessGroup(pid) { signals.push(pid); },
      },
    })).rejects.toThrow(/lacks a complete owned runtime descriptor/i);

    expect(signals).toEqual([]);
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
              objectStoreRoot: path.join(fixture.runRoot, "object-store", "late"),
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
  const root = mkdtempSync(path.join(os.tmpdir(), `wiseeff-gate0-upload-${suffix}-`));
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
  recordNestedRuntimeStart(manifestPath, {
    id: `wiseeff_acceptance_disposable_${suffix}`,
    databaseName: `wiseeff_acceptance_disposable_${suffix}`,
    markerPurpose: "td-042-post-cutover",
    migrationRunId: `${suffix}-migration`,
    objectStoreRoot,
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
      worktreeRoot: process.cwd(),
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
      root: path.join(fixture.runRoot, "object-store"),
      absentBeforeCreate: true,
      markerFile: path.join(fixture.runRoot, "object-store", ".wiseeff-acceptance-owner.json"),
      markerSha256: "7".repeat(64),
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
      exactObjectStoreRoot: path.join(fixture.runRoot, "object-store"),
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
