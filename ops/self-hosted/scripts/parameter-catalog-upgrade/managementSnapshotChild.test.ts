import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { existsSync, readFileSync, watch } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";

const seams = vi.hoisted(() => ({ command: vi.fn(), git: vi.fn(), spawn: vi.fn(), record: {} as Record<string, unknown>, artifact: {} as Record<string, unknown>, assertLock: vi.fn(), verifyStoppedHandoff: vi.fn(), openConfiguration: vi.fn(), closeIntentFails: false }));
vi.mock("node:fs/promises", async original => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
    const handle = await fs.open(...args), close = handle.close.bind(handle);
    if (String(args[0]).endsWith("-intent.json")) handle.close = async () => { await close(); if (seams.closeIntentFails) throw new Error("private-close-canary"); };
    return handle;
  } };
});
vi.mock("node:child_process", async original => {
  const native = await original<typeof import("node:child_process")>();
  return { ...native, spawnSync: (...args: unknown[]) => seams.git(...args),
    spawn: (...args: unknown[]) => seams.spawn(native.spawn, ...args) };
});
vi.mock("../../../../scripts/isolated-upgrade-docker", () => ({ createIsolatedUpgradeDocker: () => ({ command: seams.command, daemonId: "owned", endpoint: "unix:///var/run/docker.sock" }) }));
vi.mock("./applicationArtifactCustody", () => ({ reopenApplicationArtifactSelection: async () => ({ observe: async () => structuredClone(seams.artifact) }) }));
vi.mock("./handoff", async original => ({ ...await original<typeof import("./handoff")>(),
  assertHostOperationLockForJournal: (...args: unknown[]) => seams.assertLock(...args),
  verifyStoppedHandoff: (...args: unknown[]) => seams.verifyStoppedHandoff(...args),
  openHandoffRuntimeConfigurationLease: (...args: unknown[]) => seams.openConfiguration(...args) }));
vi.mock("./journal", async original => ({ ...await original<typeof import("./journal")>(), loadUpgradeJournal: () => ({ ok: true, value: { record: seams.record } }) }));

const owner = await import("./managementSnapshotChild").catch(() => ({}));
beforeEach(() => { vi.clearAllMocks(); seams.closeIntentFails = false; seams.assertLock.mockResolvedValue(undefined);
  seams.verifyStoppedHandoff.mockImplementation(async (handoff: { observation: unknown }) => handoff.observation); });

// Command/owner doubles only. This exercises the real create/register/inspect
// control flow and private resource records, not a real candidate or database.
async function fixture() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "management-child-test-")));
  const ids = Array.from({ length: 7 }, (_, n) => String(n + 1).repeat(64));
  const networkId = "8".repeat(64), containerId = "9".repeat(64), imageId = `sha256:${"a".repeat(64)}`;
  const runId = "b".repeat(24), sha = "c".repeat(40);
  const source = { checkout: directory, sha, composeFile: path.join(directory, "compose.yaml"), project: "owned",
    applications: (["api", "worker", "web"] as const).map((service, n) => ({ service, containerId: ids[n]!, imageId, imageReference: imageId })),
    stores: (["postgres", "minio", "redis"] as const).map((service, n) => ({ service, containerId: ids[n + 3]!, volumeName: `owned-${service}`, destination: "/data" })) };
  seams.record = { runId: "original-artifact-host-run" }; seams.artifact = { loadedImageId: imageId, receiptDigest: `sha256:${"d".repeat(64)}` };
  let actual: any, present = false, mutate: ((actual: any) => void) | undefined;
  seams.git.mockImplementation((_bin: string, args: string[]) => ({ status: 0, stdout: Buffer.from(args.includes("status") ? "" : args.includes("ls-tree") ?
    `100644 blob ${sha}\tserver/migrations/0001.sql\0` : args.some(a => a.endsWith("managementSnapshotChild.ts")) ?
      readFileSync(fileURLToPath(new URL("./managementSnapshotChild.ts", import.meta.url)), "utf8") : args.includes("show") ? "select 1;" : sha) }));
  seams.command.mockImplementation((args: string[]) => {
    if (args[0] === "image") return Buffer.from(JSON.stringify([{ Config: { Env: ["PATH=/usr/local/bin:/usr/bin:/bin"] } }]));
    if (args[0] === "network") return Buffer.from(JSON.stringify([{ Id: networkId, Driver: "bridge", Internal: true,
      Options: { "com.docker.network.bridge.enable_ip_masquerade": "false" }, Labels: { "wiseeff.controlled-recovery-run": runId },
      Containers: Object.fromEntries(ids.map(id => [id, {}])) }]));
    if (args[0] === "ps") return Buffer.from(args.some(a => a.startsWith("name=")) ? present ? containerId : "" : ids.join("\n"));
    if (args[0] === "create") {
      const label = args.filter((_, n) => args[n - 1] === "--label");
      actual = { Id: containerId, Name: `/${args[args.indexOf("--name") + 1]}`, Image: imageId,
        Config: { Env: [...args.filter((_, n) => args[n - 1] === "--env"), "PATH=/usr/local/bin:/usr/bin:/bin"], Cmd: args.slice(args.indexOf(imageId) + 1), Entrypoint: ["node"], WorkingDir: "/app", Labels: Object.fromEntries(label.map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])) },
        HostConfig: { NetworkMode: networkId, ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"], RestartPolicy: { Name: "no" },
          Tmpfs: { "/private": "rw,noexec,nosuid,size=33554432,mode=0700" } },
        // Observed on the owned daemon's actual never-started e7ae container.
        // --tmpfs belongs to HostConfig.Tmpfs; it is not a bind/volume Mount.
        Mounts: [], NetworkSettings: { Networks: { owned: { NetworkID: "" } } },
        State: { Status: "created", Running: false, StartedAt: "0001-01-01T00:00:00Z" } };
      present = true; mutate?.(actual); return Buffer.from(containerId);
    }
    if (args[0] === "inspect") return Buffer.from(JSON.stringify(args[1] === containerId ? [actual] : ids.filter(id => args.includes(id)).map(id => ({ Id: id, Image: imageId,
      Mounts: [], State: { Running: true }, Config: { Labels: { "wiseeff.controlled-recovery-run": runId } },
      NetworkSettings: { Networks: { owned: { NetworkID: networkId, IPAddress: "172.30.0.4", Aliases: ["postgres"] } } } }))));
    if (args[0] === "exec") return Buffer.from(JSON.stringify({ systemIdentifier: "123", databaseOid: "456" }));
    if (args[0] === "rm") { present = false; return Buffer.alloc(0); }
    throw new Error("unexpected-command-double");
  });
  return { directory, input: { journal: { journalPath: path.join(directory, "journal.json"), record: seams.record }, lock: {}, source, registeredSourceContainerIds: ids },
    fault(fn: (actual: any) => void) { mutate = fn; }, actual: () => actual, present: () => present };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(value => { resolve = value; });
  return { promise, resolve };
}

function waitForMarker(file: string) {
  if (existsSync(file)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const watcher = watch(path.dirname(file), (_event, name) => {
      if (String(name) === path.basename(file) && existsSync(file)) {
        done = true; watcher.close(); resolve();
      }
    });
    watcher.on("error", error => { if (!done) { done = true; watcher.close(); reject(error); } });
    if (existsSync(file) && !done) { done = true; watcher.close(); resolve(); }
  });
}

function captureInput(f: any) {
  return { handoff: { inputs: { runId: f.input.journal.record.runId, journalPath: f.input.journal.journalPath,
    source: f.input.source, candidate: { imageId: seams.artifact.loadedImageId } }, observation: {} },
    expectedHandoffDigest: "double-only", observer: {} };
}

function canonical(value: any): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

const snapshotBody = {
  version: "pcat-frozen-public-source-v1", target: { systemIdentifier: "123", databaseOid: "456" },
  sourceMigrations: [{ name: "0001.sql", checksum: "a".repeat(64) }], migrationSuffix: [],
  candidateInventoryDigest: `sha256:${"b".repeat(64)}`,
  relations: [{ name: "owned", kind: "r", columns: [], rowCount: 0, rowsDigest: `sha256:${"c".repeat(64)}` }],
};
const snapshotOutput = JSON.stringify({ ...snapshotBody,
  digest: `sha256:${createHash("sha256").update(canonical(snapshotBody)).digest("hex")}`,
});

describe("internal management snapshot child boundary", () => {
  it("refuses a JSON registration instead of admitting an extra source network member", () => {
    const observe = Reflect.get(owner, "observeManagementSnapshotChild");
    expect(observe).toBeTypeOf("function");
    expect(() => observe({ containerId: "a".repeat(64), imageId: `sha256:${"b".repeat(64)}` }))
      .toThrow("PCAT-MANAGEMENT-SNAPSHOT-NOT-ISSUED");
  });

  it("refuses capture with an unissued child before opening any private input", async () => {
    const capture = Reflect.get(owner, "captureManagementSourceSnapshot");
    expect(capture).toBeTypeOf("function");
    await expect(capture({}, {})).rejects.toThrow("PCAT-MANAGEMENT-SNAPSHOT-NOT-ISSUED");
  });

  it.each(["image", "mount", "command", "tmpfs"])("retains its resource record and refuses changed %s before START", async fault => {
    const f = await fixture();
    f.fault(c => { if (fault === "image") c.Image = `sha256:${"f".repeat(64)}`;
      if (fault === "mount") c.Mounts.push({ Type: "bind", Destination: "/var/run/docker.sock" });
      if (fault === "tmpfs") c.HostConfig.Tmpfs["/private"] = "rw,size=33554432,mode=0777";
      if (fault === "command") c.Config.Cmd = ["arbitrary"]; });
    try {
      await expect(Reflect.get(owner, "prepareManagementSnapshotChild")(f.input)).rejects.toThrow("PCAT-MANAGEMENT-SNAPSHOT-");
      expect(seams.command.mock.calls.some(([args]) => args[0] === "start")).toBe(false);
      expect(f.present()).toBe(true);
      expect(await readdir(f.directory)).toContain(`management-snapshot-${"b".repeat(24)}-intent.json`);
      const acknowledgement = JSON.parse(readFileSync(path.join(f.directory, `management-snapshot-${"b".repeat(24)}-container.json`), "utf8"));
      expect(acknowledgement).toEqual({ containerId: "9".repeat(64), createOutcome: "acknowledged" });
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });

  it("issues only the actual created identity and detects later image drift", async () => {
    const f = await fixture();
    try {
      const child = await Reflect.get(owner, "prepareManagementSnapshotChild")(f.input);
      expect(Reflect.get(owner, "observeManagementSnapshotChild")(child).state).toBe("created");
      f.actual().Image = "sha256:" + "f".repeat(64);
      expect(() => Reflect.get(owner, "observeManagementSnapshotChild")(child)).toThrow("CONTAINER-CHANGED");
      await expect(child.close()).rejects.toThrow("CLEANUP-UNKNOWN");
      expect(f.present()).toBe(true);
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });

  it("keeps the original artifact host run separate from the actual source resource owner run", async () => {
    const f = await fixture();
    try {
      const child = await Reflect.get(owner, "prepareManagementSnapshotChild")(f.input);
      const intent = JSON.parse(readFileSync(path.join(f.directory, `management-snapshot-${"b".repeat(24)}-intent.json`), "utf8"));
      expect(intent.runId).toBe("original-artifact-host-run");
      expect(intent.ownerRunId).toBe("b".repeat(24));
      expect(f.actual().Config.Labels["wiseeff.controlled-recovery-run"]).toBe(intent.ownerRunId);
      await child.close();
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });

  it("returns detached diagnostic timings only for its issued child, including resource close", async () => {
    const f = await fixture();
    try {
      const read = Reflect.get(owner, "readManagementSnapshotChildDiagnostic");
      expect(() => read({})).toThrow("NOT-ISSUED");
      const child = await Reflect.get(owner, "prepareManagementSnapshotChild")(f.input);
      const before = read(child);
      expect(before.diagnosticOnly).toBe(true);
      expect(before.stages.map((row: { stage: string }) => row.stage)).toEqual(["created"]);
      before.stages.length = 0;
      expect(read(child).stages).toHaveLength(1);
      await child.close();
      const after = read(child);
      expect(after.stages.map((row: { stage: string }) => row.stage)).toEqual(["created", "resource-close", "resources-closed"]);
      expect(after.stages.every((row: { elapsedMs: number }, index: number) => Number.isSafeInteger(row.elapsedMs)
        && row.elapsedMs >= (after.stages[index - 1]?.elapsedMs ?? 0))).toBe(true);
      expect(f.present()).toBe(false);
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });

  it("pins the loader temporary directory and executes the actual issued bootstrap through empty-input refusal", async () => {
    const f = await fixture();
    let child: { close(): Promise<void> } | undefined;
    try {
      child = await Reflect.get(owner, "prepareManagementSnapshotChild")(f.input);
      expect(f.actual().Config.Env).toContain("TMPDIR=/private");
      const { spawn } = await vi.importActual<typeof import("node:child_process")>("node:child_process");
      const { superviseComponentProcess } = await import("../../../../scripts/run-upgrade-component-tests");
      // Actual owner-issued node command, without extracting/evaluating source.
      // The host-only adapter maps container /private to this owned directory;
      // no credentials or database input are supplied and no Docker is run.
      const native = spawn(process.execPath, f.actual().Config.Cmd, {
        cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
        env: { PATH: process.env.PATH, TMPDIR: f.directory }, detached: true, stdio: ["pipe", "pipe", "pipe"],
      });
      const supervisor = superviseComponentProcess(native, { deadlineMs: 1500, graceMs: 500, outputBytes: 65536 });
      native.stdin!.on("error", () => supervisor.stop()); native.stdin!.end("{}");
      await expect(supervisor.wait).resolves.toEqual({ exitCode: 1, output: "management-snapshot-child-failed:input" });
    } finally { await child?.close(); await rm(f.directory, { recursive: true, force: true }); }
  });

  it.each(["missing", "changed", "duplicate", "extra"])("refuses loader environment %s before START and unknown-CREATE cleanup", async fault => {
    const f = await fixture();
    let child: { close(): Promise<void> } | undefined;
    try {
      child = await Reflect.get(owner, "prepareManagementSnapshotChild")(f.input);
      const env = f.actual().Config.Env as string[];
      if (fault === "missing") f.actual().Config.Env = env.filter(value => !value.startsWith("TMPDIR="));
      if (fault === "changed") f.actual().Config.Env = env.map(value => value.startsWith("TMPDIR=") ? "TMPDIR=/tmp" : value);
      if (fault === "duplicate") env.push("TMPDIR=/tmp");
      if (fault === "extra") env.push("UNDECLARED=value");
      expect(() => Reflect.get(owner, "observeManagementSnapshotChild")(child)).toThrow("CONTAINER-CHANGED");
      await expect(Reflect.get(owner, "reconcileUnstartedManagementSnapshotChild")({ journal: f.input.journal,
        lock: f.input.lock, expectedDaemonId: "owned", ownerRunId: "b".repeat(24) })).rejects.toThrow("CONTAINER-CHANGED");
      expect(f.present()).toBe(true);
      expect(seams.spawn).not.toHaveBeenCalled();
    } finally {
      f.actual().Config.Env = ["TMPDIR=/private", "PATH=/usr/local/bin:/usr/bin:/bin"];
      await child?.close(); await rm(f.directory, { recursive: true, force: true });
    }
  });

  it("cancels capture during its first awaited configuration open and closes without START or cyclic waiting", async () => {
    const f = await fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const configClosed = vi.fn(async () => {});
    seams.openConfiguration.mockImplementation(async () => { await gate; return {
      read: async () => ({ management: { DATABASE_URL: "postgres://postgres:synthetic@postgres:5432/wiseeff" } }), close: configClosed,
    }; });
    try {
      const child = await Reflect.get(owner, "prepareManagementSnapshotChild")(f.input);
      const capture = Reflect.get(owner, "captureManagementSourceSnapshot")(child, { handoff: { inputs: {
        runId: f.input.journal.record.runId, journalPath: f.input.journal.journalPath, source: f.input.source,
        candidate: { imageId: seams.artifact.loadedImageId },
      } }, expectedHandoffDigest: "unused", observer: {} });
      const rejection = expect(capture).rejects.toThrow("CLOSING");
      const closing = child.close();
      release();
      await Promise.all([rejection, closing]);
      expect(configClosed).toHaveBeenCalledOnce();
      expect(f.present()).toBe(false);
      expect(seams.command.mock.calls.some(([args]) => args[0] === "start")).toBe(false);
    } finally { release(); await rm(f.directory, { recursive: true, force: true }); }
  });

  it("coalesces slow fresh checks and awaits the final check after child settlement", async () => {
    const f = await fixture();
    const spawned = deferred<void>(), firstRead = deferred<void>(), secondRead = deferred<void>(), exited = deferred<void>();
    const firstGate = deferred<void>(), secondGate = deferred<void>();
    const ready = path.join(f.directory, "child-ready");
    const configValue = { management: { DATABASE_URL: "postgres://postgres:synthetic@postgres:5432/wiseeff" } };
    let sourceStarted = false, postStartReads = 0, verifyCalls = 0;
    let nativeChild: ChildProcess | undefined, handle: { close(): Promise<void> } | undefined;
    let capture: Promise<unknown> | undefined;
    const read = vi.fn(async () => {
      if (sourceStarted) {
        postStartReads += 1;
        if (postStartReads === 1) { firstRead.resolve(); await firstGate.promise; }
        if (postStartReads === 2) { secondRead.resolve(); await secondGate.promise; }
      }
      return configValue;
    });
    seams.openConfiguration.mockResolvedValue({ read, close: async () => {} });
    seams.verifyStoppedHandoff.mockImplementation(async (handoff: { observation: unknown }) => {
      verifyCalls += 1; return handoff.observation;
    });
    seams.spawn.mockImplementation((spawn: typeof import("node:child_process").spawn, _binary: string, _args: string[], options: any) => {
      const child = spawn(process.execPath, ["-e", `const fs=require("node:fs");process.stdin.on("data",()=>{});const keep=setInterval(()=>{},1000);process.on("SIGUSR1",()=>{clearInterval(keep);process.stdout.write(${JSON.stringify(snapshotOutput)});process.exit(0)});fs.writeFileSync(${JSON.stringify(ready)},"ready");`], options);
      nativeChild = child; sourceStarted = true;
      f.actual().State = { Status: "running", Running: true, ExitCode: 0, OOMKilled: false, Error: "" };
      f.actual().NetworkSettings.Networks.owned.NetworkID = "8".repeat(64);
      child.once("exit", () => { f.actual().State = { Status: "exited", Running: false, ExitCode: 0, OOMKilled: false, Error: "" }; exited.resolve(); });
      spawned.resolve(); return child;
    });
    vi.useFakeTimers();
    try {
      const prepared = await Reflect.get(owner, "prepareManagementSnapshotChild")(f.input);
      handle = prepared;
      const captureRun = Reflect.get(owner, "captureManagementSourceSnapshot")(prepared, captureInput(f)) as Promise<unknown>;
      capture = captureRun;
      await spawned.promise;
      await waitForMarker(ready);
      await vi.advanceTimersByTimeAsync(250);
      await firstRead.promise;
      await vi.advanceTimersByTimeAsync(1000);
      expect(postStartReads).toBe(1);
      firstGate.resolve();
      await vi.advanceTimersByTimeAsync(1000);
      await secondRead.promise;
      expect(postStartReads).toBe(2);
      let settled = false;
      captureRun.then(() => { settled = true; }, () => { settled = true; });
      await new Promise<void>(resolve => process.nextTick(resolve));
      nativeChild!.kill("SIGUSR1");
      await exited.promise;
      await Promise.resolve();
      expect(settled).toBe(false);
      secondGate.resolve();
      await expect(captureRun).resolves.toMatchObject({ target: { systemIdentifier: "123", databaseOid: "456" } });
      expect(postStartReads).toBe(3);
      expect(verifyCalls).toBe(5);
    } finally {
      firstGate.resolve(); secondGate.resolve();
      if (nativeChild && nativeChild.exitCode === null) nativeChild.kill("SIGUSR1");
      if (capture) await capture.catch(() => undefined);
      await handle?.close().catch(() => undefined);
      vi.useRealTimers();
      await rm(f.directory, { recursive: true, force: true });
    }
  });

  it("stops and cleans up when a fresh check rejects", async () => {
    const f = await fixture();
    const spawned = deferred<void>(), failedCheck = deferred<void>();
    const ready = path.join(f.directory, "child-ready");
    const configValue = { management: { DATABASE_URL: "postgres://postgres:synthetic@postgres:5432/wiseeff" } };
    let sourceStarted = false, nativeChild: ChildProcess | undefined, handle: { close(): Promise<void> } | undefined;
    let capture: Promise<unknown> | undefined;
    seams.openConfiguration.mockResolvedValue({ read: async () => configValue, close: async () => {} });
    seams.verifyStoppedHandoff.mockImplementation(async (handoff: { observation: unknown }) => {
      if (sourceStarted) { failedCheck.resolve(); throw new Error("fresh-check-failed"); }
      return handoff.observation;
    });
    seams.spawn.mockImplementation((spawn: typeof import("node:child_process").spawn, _binary: string, _args: string[], options: any) => {
      const child = spawn(process.execPath, ["-e", `const fs=require("node:fs");process.stdin.on("data",()=>{});const keep=setInterval(()=>{},1000);process.on("SIGUSR1",()=>{clearInterval(keep);process.exit(0)});fs.writeFileSync(${JSON.stringify(ready)},"ready");`], options);
      nativeChild = child; sourceStarted = true;
      f.actual().State = { Status: "running", Running: true, ExitCode: 0, OOMKilled: false, Error: "" };
      f.actual().NetworkSettings.Networks.owned.NetworkID = "8".repeat(64);
      child.once("exit", () => { f.actual().State = { Status: "exited", Running: false, ExitCode: 143, OOMKilled: false, Error: "" }; });
      spawned.resolve(); return child;
    });
    vi.useFakeTimers();
    try {
      const prepared = await Reflect.get(owner, "prepareManagementSnapshotChild")(f.input);
      handle = prepared;
      const captureRun = Reflect.get(owner, "captureManagementSourceSnapshot")(prepared, captureInput(f)) as Promise<unknown>;
      capture = captureRun;
      captureRun.catch(() => undefined);
      await spawned.promise;
      await waitForMarker(ready);
      await vi.advanceTimersByTimeAsync(250);
      await failedCheck.promise;
      await vi.advanceTimersByTimeAsync(2000);
      await expect(captureRun).rejects.toThrow("PCAT-MANAGEMENT-SNAPSHOT-EXECUTION-UNKNOWN");
      expect(f.actual().State).toMatchObject({ Status: "exited", Running: false, ExitCode: 143 });
      await prepared.close();
      expect(f.present()).toBe(false);
      expect(seams.command.mock.calls.some(([args]) => args[0] === "rm")).toBe(true);
    } finally {
      if (nativeChild && nativeChild.exitCode === null) nativeChild.kill("SIGTERM");
      if (capture) await capture.catch(() => undefined);
      await handle?.close().catch(() => undefined);
      vi.useRealTimers();
      await rm(f.directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["management-snapshot-child-failed:module-load", "module-load"],
    ["management-snapshot-child-failed:source-snapshot", "source-snapshot"],
    ["management-snapshot-child-failed:native-close", "native-close"],
    ["management-snapshot-child-failed:private-canary", undefined],
    ["management-snapshot-child-failed:target\nprivate-canary", undefined],
    ["management-snapshot-child-failed:targetmanagement-snapshot-child-failed:target", undefined],
  ])("records only the exact closed refusal frame from native process output: %s", async (output, expectedStage) => {
    const f = await fixture();
    let child: { close(): Promise<void> } | undefined;
    seams.openConfiguration.mockResolvedValue({
      read: async () => ({ management: { DATABASE_URL: "postgres://postgres:synthetic@postgres:5432/wiseeff" } }),
      close: async () => {},
    });
    // A real native process exercises supervisor EOF/output handling. Docker,
    // custody and PostgreSQL remain explicit doubles; this is no capture proof.
    seams.spawn.mockImplementation((spawn, _binary, _args, options) => {
      f.actual().State = { Status: "exited", Running: false, ExitCode: 1 };
      f.actual().NetworkSettings.Networks.owned.NetworkID = "8".repeat(64);
      return spawn(process.execPath, ["-e", "process.stdin.resume();process.stdin.on('end',()=>{process.stderr.write(process.argv[1]);process.exitCode=1})", output], options);
    });
    try {
      child = await Reflect.get(owner, "prepareManagementSnapshotChild")(f.input);
      await expect(Reflect.get(owner, "captureManagementSourceSnapshot")(child, { handoff: { inputs: {
        runId: f.input.journal.record.runId, journalPath: f.input.journal.journalPath, source: f.input.source,
        candidate: { imageId: seams.artifact.loadedImageId },
      }, observation: {} }, expectedHandoffDigest: "double-only", observer: {} })).rejects.toThrow("EXECUTION-UNKNOWN");
      const read = Reflect.get(owner, "readManagementSnapshotChildDiagnostic");
      const diagnostic = read(child);
      expect(diagnostic.execution).toEqual({ exitCode: 1, ...(expectedStage ? { refusalStage: expectedStage } : {}) });
      expect(JSON.stringify(diagnostic)).not.toContain("private-canary");
      diagnostic.execution.exitCode = 0;
      expect(read(child).execution.exitCode).toBe(1);
      expect(seams.spawn).toHaveBeenCalledOnce();
    } finally { await child?.close(); await rm(f.directory, { recursive: true, force: true }); }
  });

  it.each([false, true])("reconciles only a never-started exact unknown CREATE; wasStarted=%s", async wasStarted => {
    const f = await fixture();
    let child: { close(): Promise<void> } | undefined;
    try {
      child = await Reflect.get(owner, "prepareManagementSnapshotChild")(f.input);
      if (wasStarted) f.actual().State.StartedAt = "2026-09-08T00:00:00Z";
      const reconcile = Reflect.get(owner, "reconcileUnstartedManagementSnapshotChild")({ journal: f.input.journal,
        lock: f.input.lock, expectedDaemonId: "owned", ownerRunId: "b".repeat(24) });
      if (wasStarted) {
        await expect(reconcile).rejects.toThrow("RECONCILE-NOT-UNSTARTED");
        expect(f.present()).toBe(true);
        expect(seams.command.mock.calls.some(([args]) => args[0] === "rm")).toBe(false);
      } else {
        await expect(reconcile).resolves.toEqual({ outcome: "removed-unknown-origin" });
        expect(f.present()).toBe(false);
        const receipt = JSON.parse(readFileSync(path.join(f.directory, `management-snapshot-${"b".repeat(24)}-cleanup-observation.json`), "utf8"));
        expect(receipt.createOutcome).toBe("unknown-origin");
      }
      expect(seams.command.mock.calls.some(([args]) => args[0] === "start")).toBe(false);
    } finally { await child?.close(); await rm(f.directory, { recursive: true, force: true }); }
  });

  it("retains the safe reconciliation refusal when closing its private intent also fails", async () => {
    const f = await fixture();
    let child: { close(): Promise<void> } | undefined;
    try {
      child = await Reflect.get(owner, "prepareManagementSnapshotChild")(f.input);
      seams.closeIntentFails = true;
      const error = await Reflect.get(owner, "reconcileUnstartedManagementSnapshotChild")({ journal: f.input.journal,
        lock: f.input.lock, expectedDaemonId: "wrong-daemon", ownerRunId: "b".repeat(24) }).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(AggregateError);
      expect(error.errors.map((item: Error) => item.message)).toEqual([
        "PCAT-MANAGEMENT-SNAPSHOT-RECONCILE-INTENT", "PCAT-MANAGEMENT-SNAPSHOT-RECONCILE-CLOSE-UNKNOWN",
      ]);
      expect(JSON.stringify(error)).not.toContain("private-close-canary");
      expect(error.cause).toBeUndefined();
      expect(f.present()).toBe(true);
    } finally { seams.closeIntentFails = false; await child?.close(); await rm(f.directory, { recursive: true, force: true }); }
  });
});
