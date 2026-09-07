import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Queue, Worker } from "bullmq";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createIsolatedUpgradeDocker } from "../../../scripts/isolated-upgrade-docker";
import type { Database } from "../../shared/database/client";
import type { ObjectStore } from "./objectStore";
import { createLogAnalysisQueueRuntime, createLogAnalysisQueueTransport } from "./logAnalysisQueueRuntime";

// Owns a new Redis daemon, network and volume; never reads ambient REDIS_URL.
describe.skipIf(process.env.UPG_LOG_QUEUE_REDIS_TEST !== "1")("owned Redis log worker lifecycle", () => {
  let docker: ReturnType<typeof createIsolatedUpgradeDocker>;
  const run = randomBytes(12).toString("hex");
  const label = "wiseeff.log-worker-lifecycle";
  let container = ""; let network = ""; let volume = ""; let privateDirectory = "";
  let redisUrl = "";
  const password = randomBytes(24).toString("hex");
  const owned = () => docker.assertOwned(container, label, run);
  beforeAll(async () => {
    docker = createIsolatedUpgradeDocker();
    if (docker.daemonId !== process.env.UPG_EXPECTED_DOCKER_DAEMON_ID) throw new Error("owned-redis-daemon-identity-required");
    const image = JSON.parse(docker.command(["image", "inspect", "redis:7-alpine"]).toString())[0];
    privateDirectory = await mkdtemp(path.join(os.tmpdir(), "wiseeff-owned-redis-"));
    await writeFile(path.join(privateDirectory, "redis.conf"), `bind 0.0.0.0\nappendonly yes\ndir /data\nrequirepass ${password}\n`, { mode: 0o600 });
    network = docker.command(["network", "create", "--driver", "bridge", "--opt", "com.docker.network.bridge.enable_ip_masquerade=false", "--label", `${label}=${run}`, `log-worker-${run}`]).toString().trim();
    volume = docker.command(["volume", "create", "--label", `${label}=${run}`, `log-worker-${run}`]).toString().trim();
    container = docker.command(["create", "--label", `${label}=${run}`, "--network", network, "-p", "127.0.0.1::6379", "--entrypoint", "redis-server",
      "--mount", `type=volume,source=${volume},target=/data`, "--mount", `type=bind,source=${privateDirectory},target=/private,readonly`,
      image.Id, "/private/redis.conf"]).toString().trim();
    owned(); docker.command(["start", container]);
    const running = owned();
    if (!running.State.Running || !running.NetworkSettings.Ports["6379/tcp"]?.[0]?.HostPort) {
      throw new Error(`owned-redis-startup-unavailable:running=${running.State.Running}:exit=${running.State.ExitCode}`);
    }
    redisUrl = `redis://:${password}@127.0.0.1:${running.NetworkSettings.Ports["6379/tcp"][0].HostPort}`;
    const probe = new Queue(`probe-${run}`, { connection: { url: redisUrl } });
    probe.on("error", () => {});
    try { await probe.waitUntilReady(); } finally { await probe.close(); }
    console.info(JSON.stringify({ evidence: "owned-redis-lifecycle", imageId: image.Id, platform: `${image.Os}/${image.Architecture}`, persistence: "aof" }));
  });
  afterAll(async () => {
    if (container) { owned(); docker.command(["rm", "-f", container]); }
    for (const [kind, identity] of [["volume", volume], ["network", network]]) {
      if (!identity) continue;
      const info = JSON.parse(docker.command([kind, "inspect", identity]).toString())[0];
      if (info.Labels?.[label] !== run) throw new Error("owned-redis-resource-ownership-mismatch");
      docker.command([kind, "rm", identity]);
    }
    if (privateDirectory) await rm(privateDirectory, { recursive: true });
    for (const args of [["ps", "-aq"], ["volume", "ls", "-q"], ["network", "ls", "-q"]]) {
      if (docker.command([...args, "--filter", `label=${label}=${run}`]).toString().trim()) throw new Error("owned-redis-cleanup-incomplete");
    }
    console.info(JSON.stringify({ evidence: "owned-redis-lifecycle", cleanupVerified: true }));
  });
  const options = () => ({
    env: { REDIS_URL: redisUrl, LOG_ANALYSIS_QUEUE_PREFIX: `owned-${randomBytes(8).toString("hex")}`,
      LOG_ANALYSIS_QUEUE_ATTEMPTS: 2, LOG_ANALYSIS_QUEUE_BACKOFF_MS: 100, LOG_ANALYSIS_QUEUE_CONCURRENCY: 1 },
    db: {} as Database, objectStore: {} as ObjectStore
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
      await expect(runtime.close()).rejects.toThrow("PCAT-LOG-QUEUE-CLOSE-FAILED");
      expect(JSON.stringify(output.mock.calls)).not.toContain(privateCanary);
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
      await expect(createLogAnalysisQueueRuntime({ ...configured, processByJobId,
        QueueCtor: CapturedQueue as never, WorkerCtor: CapturedWorker as never }))
        .rejects.toThrow("PCAT-LOG-QUEUE-INITIALIZATION-FAILED");
      expect(processByJobId).not.toHaveBeenCalled();
      expect(actualQueue.isClosed).toBe(true); expect(actualWorker.isClosed).toBe(true);
      expect(JSON.stringify(output.mock.calls)).not.toContain(wrongPassword);
      expect(JSON.stringify(output.mock.calls)).not.toContain(password);
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
      await control.runCommand("acl", ["SETUSER", name, "on", `>${secret}`, "~*", "+@all", "-info"]);
      await expect(createLogAnalysisQueueRuntime({ ...configured, processByJobId }))
        .rejects.toThrow("PCAT-LOG-QUEUE-INITIALIZATION-FAILED");
      expect(processByJobId).not.toHaveBeenCalled();
      const output = JSON.stringify([...errors.mock.calls, ...warnings.mock.calls]);
      expect(output).not.toContain(name); expect(output).not.toContain(secret); expect(output).not.toContain(password);
    } finally {
      await control.runCommand("acl", ["DELUSER", name]); await controlQueue.close();
      errors.mockRestore(); warnings.mockRestore();
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
      expect(JSON.stringify(output.mock.calls)).not.toContain(password);
      expect(output).toHaveBeenCalledWith("PCAT-LOG-QUEUE-CONNECTION-ERROR");
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
      await expect(createLogAnalysisQueueTransport({ env: configured.env }))
        .rejects.toThrow("PCAT-LOG-QUEUE-INITIALIZATION-FAILED");
      expect(JSON.stringify(output.mock.calls)).not.toContain(wrongPassword);
      expect(JSON.stringify(output.mock.calls)).not.toContain(password);
    } finally { output.mockRestore(); }
  });

  it("refuses a stopped owned Redis target without starting a consumer", async () => {
    owned(); docker.command(["stop", container]);
    const processByJobId = vi.fn();
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(createLogAnalysisQueueRuntime({ ...options(), processByJobId }))
        .rejects.toThrow("PCAT-LOG-QUEUE-INITIALIZATION-FAILED");
      expect(processByJobId).not.toHaveBeenCalled();
      expect(JSON.stringify(output.mock.calls)).not.toContain(password);
    } finally { owned(); docker.command(["start", container]); output.mockRestore(); }
  });
});
