import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Queue, Worker } from "bullmq";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { createIsolatedUpgradeDocker } from "../../../scripts/isolated-upgrade-docker";
import type { Database } from "../../shared/database/client";
import type { ObjectStore } from "./objectStore";
import { createLogAnalysisQueueRuntime, createLogAnalysisQueueTransport } from "./logAnalysisQueueRuntime";
import { enqueueLogAnalysisJob } from "./logAnalysisQueue";
import { enqueueNotificationOutbox } from "../notifications/notificationQueue";
import { createBullMqDurableQueue } from "../jobs/bullmqQueue";

function assertPrivateDiagnosticsAbsent(output: string, secrets: readonly string[]) {
  // Assertion libraries retain expected/actual values, even if a reporter hides
  // them. A failing leakage check must never become another copy of the secret.
  if (secrets.some(secret => output.includes(secret))) throw new Error("private-diagnostic-observed");
}

async function assertStaticFailure(operation: Promise<unknown>, code: string) {
  let matched = false;
  try { await operation; }
  catch (error) { matched = error instanceof Error && error.message === code; }
  expect(matched).toBe(true);
}

// The supervising runner owns creation and cleanup, including when Vitest is killed.
// This child verifies the private receipt against Docker and Redis, never ambient URLs.
describe("owned Redis log worker lifecycle", () => {
  let docker: ReturnType<typeof createIsolatedUpgradeDocker>;
  let run = ""; let label = ""; let container = "";
  let redisUrl = "";
  let password = "";
  const owned = () => docker.assertOwned(container, label, run);
  beforeAll(async () => {
    docker = createIsolatedUpgradeDocker();
    if (docker.daemonId !== process.env.UPG_EXPECTED_DOCKER_DAEMON_ID) throw new Error("owned-redis-daemon-identity-required");
    const receiptPath = process.env.UPG_REDIS_TARGET_RECEIPT;
    if (!receiptPath) throw new Error("owned-redis-runner-required");
    const file = await open(receiptPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let receipt;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 ||
          stat.uid !== process.getuid?.() || stat.size > 16384) throw new Error("owned-redis-receipt-private-file-required");
      receipt = JSON.parse(await file.readFile("utf8"));
    } finally { await file.close(); }
    if (receipt.profile !== "selfhost-redis7-aof-v1" || receipt.daemonId !== docker.daemonId ||
        receipt.label !== "wiseeff.upgrade.conversion" || !/^conversion-[a-f0-9]+$/.test(receipt.run)) {
      throw new Error("owned-redis-receipt-identity-mismatch");
    }
    run = receipt.run; label = receipt.label; container = receipt.id;
    const running = owned();
    const port = running.NetworkSettings.Ports["6379/tcp"]?.[0];
    const mounts = running.Mounts.filter((mount: { Destination: string }) => mount.Destination === "/data");
    const network = JSON.parse(docker.command(["network", "inspect", receipt.net]).toString())[0];
    const volume = JSON.parse(docker.command(["volume", "inspect", receipt.dataVolume.name]).toString())[0];
    const consumers = docker.command(["ps", "-aq", "--filter", `volume=${receipt.dataVolume.name}`]).toString().trim().split("\n");
    if (!running.State.Running || running.Image !== receipt.imageId || port?.HostIp !== "127.0.0.1" ||
        mounts.length !== 1 || mounts[0].Name !== receipt.dataVolume.name ||
        volume.CreatedAt !== receipt.dataVolume.createdAt || volume.Labels?.[label] !== run ||
        network.Labels?.[label] !== run || !network.Containers?.[container] ||
        Object.keys(network.Containers).length !== 1 || consumers.length !== 1 || !container.startsWith(consumers[0])) {
      throw new Error("owned-redis-resource-identity-mismatch");
    }
    const url = new URL(receipt.url);
    if (url.protocol !== "redis:" || url.hostname !== "127.0.0.1" || url.port !== port.HostPort ||
        url.username || !url.password || url.search || url.hash || url.pathname) throw new Error("owned-redis-connection-mismatch");
    redisUrl = receipt.url; password = url.password;
    const probe = new Queue(`probe-${run}`, { connection: { url: redisUrl } });
    probe.on("error", () => {});
    try {
      const client = await probe.waitUntilReady();
      const server = await client.info("server");
      if (/^run_id:([a-f0-9]{40})\r?$/m.exec(server)?.[1] !== receipt.redisRunId) throw new Error("owned-redis-server-identity-mismatch");
      expect(await client.config("GET", "appendonly")).toEqual(["appendonly", "yes"]);
    } finally { await probe.close(); }
    console.info(JSON.stringify({ evidence: "owned-redis-lifecycle", imageId: receipt.imageId, persistence: "aof" }));
  });
  const options = () => ({
    env: { REDIS_URL: redisUrl, LOG_ANALYSIS_QUEUE_PREFIX: `owned-${randomBytes(8).toString("hex")}`,
      LOG_ANALYSIS_QUEUE_ATTEMPTS: 2, LOG_ANALYSIS_QUEUE_BACKOFF_MS: 100, LOG_ANALYSIS_QUEUE_CONCURRENCY: 1 },
    db: {} as Database, objectStore: {} as ObjectStore
  });

  it("keeps the leakage assertion itself free of private diagnostics when it fails", () => {
    const secret = randomBytes(24).toString("hex");
    let failure: unknown;
    try { assertPrivateDiagnosticsAbsent(`AUTH ${secret}`, [secret]); }
    catch (error) { failure = error; }
    expect(failure instanceof Error).toBe(true);
    expect(JSON.stringify(failure).includes(secret)).toBe(false);
    expect(String(failure).includes(secret)).toBe(false);
  });

  it("runs a real BullMQ job and drains it before idempotent close", async () => {
    let release!: () => void;
    const active = new Promise<void>((resolve) => { release = resolve; });
    const processByJobId = vi.fn(async () => { await active; return { status: "processed" as const }; });
    const runtime = await createLogAnalysisQueueRuntime({ ...options(), processByJobId });
    try {
      await runtime.queue.enqueue({ name: "analyze-log", payload: { jobId: "synthetic-job", organizationId: "org", logId: "log", runId: "run" }, idempotencyKey: "synthetic-job" });
      await vi.waitFor(() => expect(processByJobId).toHaveBeenCalledOnce());
      let closed = false;
      const closing = runtime.close().then(() => { closed = true; });
      await delay(30);
      expect(closed).toBe(false);
      release(); await closing; await runtime.close();
      expect(processByJobId).toHaveBeenCalledOnce();
    } finally { release(); await runtime.close(); }
  });

  it("drains an actual BullMQ task across repeated OS signals before closing its explicit database seam", async () => {
    // Redis and SIGTERM/SIGINT are real. Database/admission and the controlled
    // processor are explicit seams; this is not production Catalog readiness.
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { runProcessWithSignals } from './server/processSignals.ts';
      import { createLogAnalysisQueueRuntime } from './server/modules/logs/logAnalysisQueueRuntime.ts';
      let configure, release, runtime, closed = false, lateWrites = 0, processed = 0, stops = 0;
      const configuration = new Promise(resolve => { configure = resolve; });
      const active = new Promise(resolve => { release = resolve; });
      process.on('message', message => { if (message === 'release') release(); else configure(message); });
      process.send('configured-channel');
      try {
        const env = await configuration;
        await runProcessWithSignals({ failureCode: 'PCAT-TEST-QUEUE-SHUTDOWN-FAILED',
          async initialize() {
            runtime = await createLogAnalysisQueueRuntime({ env, db: {}, objectStore: {},
              async processByJobId() {
                processed++; process.send('active'); await active;
                if (closed) lateWrites++;
                return { status: 'processed' };
              } });
            await runtime.queue.enqueue({ name:'analyze-log', idempotencyKey:'signal-task',
              payload:{jobId:'signal-task',organizationId:'synthetic',logId:'synthetic',runId:'synthetic'} });
          },
          async shutdown() {
            stops++; process.send('draining'); await runtime.close(); closed = true;
            process.send({closed,processed,lateWrites,stops}); process.disconnect();
          }
        });
      } catch { process.stderr.write('PCAT-TEST-QUEUE-CHILD-FAILED'); process.exitCode = 1; process.disconnect(); }
    `], { cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    const messages: unknown[] = [];
    let output = "";
    child.on("message", message => messages.push(message));
    child.stderr!.on("data", bytes => { output += bytes; });
    child.stdout!.on("data", bytes => { output += bytes; });
    const exited = once(child, "exit");
    try {
      await vi.waitFor(() => expect(messages.includes("configured-channel")).toBe(true));
      child.send(options().env); // Private IPC only: no URL in arguments or logs.
      await vi.waitFor(() => expect(messages.includes("active")).toBe(true));
      child.kill("SIGTERM");
      await vi.waitFor(() => expect(messages.includes("draining")).toBe(true));
      child.kill("SIGINT");
      await delay(30);
      expect(child.exitCode === null && child.signalCode === null).toBe(true);
      expect(messages.some(message => typeof message === "object")).toBe(false);
      child.send("release");
      const [code, signal] = await exited;
      expect({ code, signal }).toEqual({ code: 0, signal: null });
      expect(messages).toContainEqual({ closed: true, processed: 1, lateWrites: 0, stops: 1 });
      assertPrivateDiagnosticsAbsent(output, [password, redisUrl]);
      expect(output.length === 0).toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    }
  });

  it("accepts the formal log producer's idempotency key and deduplicates delivery", async () => {
    const processByJobId = vi.fn(async () => ({ status: "processed" as const }));
    const runtime = await createLogAnalysisQueueRuntime({ ...options(), processByJobId });
    const payload = { jobId: "synthetic-formal-job", organizationId: "org", logId: "log", runId: "run" };
    try {
      const [first, second] = await Promise.all([
        enqueueLogAnalysisJob(runtime.queue, payload), enqueueLogAnalysisJob(runtime.queue, payload)
      ]);
      expect(second?.id).toBe(first?.id);
      await vi.waitFor(() => expect(processByJobId).toHaveBeenCalledOnce());
      const distinct = await enqueueLogAnalysisJob(runtime.queue, { ...payload, jobId: "synthetic-distinct-job" });
      expect(distinct?.id).not.toBe(first?.id);
      await enqueueLogAnalysisJob(runtime.queue, payload);
      await vi.waitFor(() => expect(processByJobId).toHaveBeenCalledTimes(2));
      await runtime.close();
      expect(processByJobId).toHaveBeenCalledTimes(2);
    } finally { await runtime.close(); }
  });

  it("persists formal notification keys and refuses unmarked Redis identity collisions", async () => {
    const native = new Queue("notification-outbox", { connection: { url: redisUrl },
      prefix: `owned-${randomBytes(8).toString("hex")}` });
    native.on("error", () => {});
    try {
      await native.waitUntilReady();
      const queue = createBullMqDurableQueue({ name: "notification-outbox", queue: native });
      const payload = { organizationId: "org", outboxId: "synthetic-outbox" };
      const [first, duplicate] = await Promise.all([
        enqueueNotificationOutbox(queue, payload), enqueueNotificationOutbox(queue, payload)
      ]);
      expect(duplicate?.id).toBe(first?.id);
      const persisted = await native.getJob(first!.id);
      expect(persisted?.data.outboxId).toBe(payload.outboxId);
      expect(persisted?.data.$wiseeffDurableKeyV1).toBe("notification-outbox:synthetic-outbox");
      // A legitimate native add constructs an old unmarked job at a colliding
      // physical ID; the adapter must not mistake it for its own encoded task.
      const key = "notification-outbox:collision";
      const collisionId = "wiseeff-durable-v1-" + Buffer.from(key, "utf16le").toString("base64url");
      await native.add("old-unmarked", { outboxId: "foreign" }, { jobId: collisionId });
      await expect(enqueueNotificationOutbox(queue, { organizationId: "org", outboxId: "collision" }))
        .rejects.toThrow("durable-queue-key-collision");
      expect((await native.getJob(collisionId))?.data).toEqual({ outboxId: "foreign" });
      expect(await native.getJobCounts("waiting")).toMatchObject({ waiting: 2 });
    } finally { await native.close(); }
  });

  it("rejects a native BullMQ close error event without leaking its private diagnostic", async () => {
    let actual!: Worker;
    class CapturedWorker extends Worker { constructor(...args: ConstructorParameters<typeof Worker>) { super(...args); actual = this; } }
    const runtime = await createLogAnalysisQueueRuntime({ ...options(), WorkerCtor: CapturedWorker as never });
    await actual.waitUntilReady();
    const privateCanary = `private-redis-close-${randomBytes(8).toString("hex")}`;
    const connection = (actual as unknown as { blockingConnection: { close: (force?: boolean) => Promise<void> } }).blockingConnection;
    const originalClose = connection.close.bind(connection);
    vi.spyOn(connection, "close").mockImplementation(async (force) => { await originalClose(force); throw new Error(privateCanary); });
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await assertStaticFailure(runtime.close(), "PCAT-LOG-QUEUE-CLOSE-FAILED");
      assertPrivateDiagnosticsAbsent(JSON.stringify(output.mock.calls), [privateCanary]);
    } finally { await runtime.close().catch(() => {}); output.mockRestore(); }
  });

  it("refuses bad authentication before any job runs and closes asynchronously initializing clients", async () => {
    let actualQueue!: CapturedQueue; let actualWorker!: CapturedWorker;
    class CapturedQueue extends Queue {
      constructor(...args: ConstructorParameters<typeof Queue>) { super(...args); actualQueue = this; }
      get isClosed() { return this.closed; }
    }
    class CapturedWorker extends Worker {
      constructor(...args: ConstructorParameters<typeof Worker>) { super(...args); actualWorker = this; }
      get isClosed() { return this.closed; }
    }
    const wrongPassword = randomBytes(24).toString("hex");
    const configured = options(); configured.env.REDIS_URL = redisUrl.replace(password, wrongPassword);
    const processByJobId = vi.fn();
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await assertStaticFailure(createLogAnalysisQueueRuntime({ ...configured, processByJobId,
        QueueCtor: CapturedQueue as never, WorkerCtor: CapturedWorker as never }),
        "PCAT-LOG-QUEUE-INITIALIZATION-FAILED");
      expect(processByJobId).not.toHaveBeenCalled();
      expect(actualQueue.isClosed).toBe(true);
      expect(actualWorker === undefined).toBe(true); // Never serialize a credential-bearing client on failure.
      assertPrivateDiagnosticsAbsent(JSON.stringify(output.mock.calls), [wrongPassword, password]);
    } finally { await actualWorker?.close(true); await actualQueue?.close(); output.mockRestore(); }
  });

  it("refuses a real asynchronous Redis readiness failure after authentication", async () => {
    const controlQueue = new Queue(`control-${run}`, { connection: { url: redisUrl } });
    controlQueue.on("error", () => {});
    const control = await controlQueue.client;
    const name = `limited-${randomBytes(8).toString("hex")}`;
    const secret = randomBytes(24).toString("hex");
    const configured = options();
    configured.env.REDIS_URL = redisUrl.replace(`:${password}@`, `${name}:${secret}@`);
    const processByJobId = vi.fn();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await control.runCommand("acl", ["SETUSER", name, "on", `>${secret}`, "~*", "+@all", "-info"])
        .catch(() => { throw new Error("owned-redis-test-acl-setup-failed"); });
      await assertStaticFailure(createLogAnalysisQueueRuntime({ ...configured, processByJobId }),
        "PCAT-LOG-QUEUE-INITIALIZATION-FAILED");
      expect(processByJobId).not.toHaveBeenCalled();
      const output = JSON.stringify([...errors.mock.calls, ...warnings.mock.calls]);
      assertPrivateDiagnosticsAbsent(output, [name, secret, password]);
    } finally {
      // The parent still owns the Redis target. Attempt client cleanup even if
      // ACL cleanup fails, and never expose a Redis command's private arguments.
      let cleanupFailed = false;
      try { await control.runCommand("acl", ["DELUSER", name]); }
      catch { cleanupFailed = true; }
      try { await controlQueue.close(); }
      catch { cleanupFailed = true; }
      errors.mockRestore(); warnings.mockRestore();
      if (cleanupFailed) throw new Error("owned-redis-test-acl-cleanup-failed");
    }
  });

  it("recovers real dropped connections and processes a subsequent job without poisoning close", async () => {
    const controlQueue = new Queue(`control-${run}`, { connection: { url: redisUrl } });
    controlQueue.on("error", () => {});
    const control = await controlQueue.client;
    const processByJobId = vi.fn(async () => ({ status: "processed" as const }));
    let actual!: Worker;
    class CapturedWorker extends Worker { constructor(...args: ConstructorParameters<typeof Worker>) { super(...args); actual = this; } }
    const runtime = await createLogAnalysisQueueRuntime({ ...options(), processByJobId, WorkerCtor: CapturedWorker as never });
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      actual.emit("error", new Error(`private-recoverable-${password}`));
      const killed = await control.runCommand("client", ["KILL", "TYPE", "normal", "SKIPME", "yes"]);
      expect(Number(killed)).toBeGreaterThan(0);
      await runtime.queue.enqueue({ name: "analyze-log", payload: { jobId: "after-reconnect", organizationId: "org", logId: "log", runId: "run" }, idempotencyKey: "after-reconnect" });
      await vi.waitFor(() => expect(processByJobId).toHaveBeenCalledOnce(), { timeout: 5000 });
      await runtime.close(); await runtime.close();
      assertPrivateDiagnosticsAbsent(JSON.stringify(output.mock.calls), [password]);
      expect(output.mock.calls.some(call => call.length === 1 && call[0] === "PCAT-LOG-QUEUE-CONNECTION-ERROR")).toBe(true);
    } finally { await runtime.close(); await controlQueue.close(); output.mockRestore(); }
  });

  it("uses the API-side transport to enqueue a real job for an independently owned worker", async () => {
    const configured = options();
    const processByJobId = vi.fn(async () => ({ status: "processed" as const }));
    const runtime = await createLogAnalysisQueueRuntime({ ...configured, processByJobId });
    const transport = await createLogAnalysisQueueTransport({ env: configured.env });
    try {
      await transport.queue.enqueue({ name: "analyze-log", payload: { jobId: "api-job", organizationId: "org", logId: "log", runId: "run" }, idempotencyKey: "api-job" });
      await vi.waitFor(() => expect(processByJobId).toHaveBeenCalledOnce());
      await transport.close(); await transport.close();
      expect((await runtime.queue.checkHealth()).ok).toBe(true);
    } finally { await transport.close(); await runtime.close(); }
  });

  it("refuses wrong API-side Redis credentials without leaking them", async () => {
    const configured = options();
    const wrongPassword = randomBytes(24).toString("hex");
    configured.env.REDIS_URL = redisUrl.replace(password, wrongPassword);
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await assertStaticFailure(createLogAnalysisQueueTransport({ env: configured.env }),
        "PCAT-LOG-QUEUE-INITIALIZATION-FAILED");
      assertPrivateDiagnosticsAbsent(JSON.stringify(output.mock.calls), [wrongPassword, password]);
    } finally { output.mockRestore(); }
  });

  it("refuses a stopped owned Redis target without starting a consumer", async () => {
    owned(); docker.command(["stop", container]);
    const processByJobId = vi.fn();
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await assertStaticFailure(createLogAnalysisQueueRuntime({ ...options(), processByJobId }),
        "PCAT-LOG-QUEUE-INITIALIZATION-FAILED");
      expect(processByJobId).not.toHaveBeenCalled();
      assertPrivateDiagnosticsAbsent(JSON.stringify(output.mock.calls), [password]);
    } finally { owned(); docker.command(["start", container]); output.mockRestore(); }
  });
});
