import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createTracingBoundary, type TraceExporter } from "../../observability/tracing";
import type { Database } from "../../shared/database/client";
import type { ObjectStore } from "./objectStore";
import { createLogAnalysisQueueRuntime, createLogAnalysisQueueTransport } from "./logAnalysisQueueRuntime";

function fakeRedisClient() {
  return Object.assign(new EventEmitter(), { status: "ready", duplicate: () => fakeRedisClient(), info: async () => "redis_version:7.0.0",
    disconnect() { this.status = "end"; }, async quit() { this.status = "end"; return "OK"; } });
}
const connectionLifecycle = () => ({ on: vi.fn(), off: vi.fn(), waitUntilReady: vi.fn(async () => fakeRedisClient()), run: vi.fn(async () => {}) });

function createTraceRecorder() {
  const spans: Parameters<TraceExporter>[0][] = [];
  return {
    spans,
    tracing: createTracingBoundary({
      enabled: true,
      serviceName: "wiseeff-api",
      exporter: (span) => {
        spans.push(span);
      }
    })
  };
}

describe("log analysis queue runtime", () => {
  it.each(["runtime", "transport"])("refuses malformed Redis credentials in a real %s subprocess without an unhandled rejection", async factory => {
    const source = `
      import { createLogAnalysisQueueRuntime, createLogAnalysisQueueTransport } from './server/modules/logs/logAnalysisQueueRuntime.ts';
      process.on('unhandledRejection', () => { process.stderr.write('unhandled-rejection'); process.exitCode = 2; });
      const env = { REDIS_URL: 'redis://synthetic:%ZZ@127.0.0.1:1', LOG_ANALYSIS_QUEUE_PREFIX: 'synthetic',
        LOG_ANALYSIS_QUEUE_ATTEMPTS: 2, LOG_ANALYSIS_QUEUE_BACKOFF_MS: 100, LOG_ANALYSIS_QUEUE_CONCURRENCY: 1 };
      try {
        await ${factory === "runtime" ? "createLogAnalysisQueueRuntime({ env, db: {}, objectStore: {} })" : "createLogAnalysisQueueTransport({ env })"};
        process.exitCode = 3;
      } catch (error) {
        if (error.message !== 'PCAT-LOG-QUEUE-INITIALIZATION-FAILED') process.exitCode = 4;
        else process.stdout.write(error.message);
      }
    `;
    const result = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
      cwd: process.cwd(), timeout: 5000, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production" }
    });
    expect(result.stdout).toBe("PCAT-LOG-QUEUE-INITIALIZATION-FAILED");
    expect(result.stderr).toBe("");
  });

  const lifecycleEnv = {
    REDIS_URL: "redis://redis:6379",
    LOG_ANALYSIS_QUEUE_PREFIX: "wiseeff",
    LOG_ANALYSIS_QUEUE_ATTEMPTS: 4,
    LOG_ANALYSIS_QUEUE_BACKOFF_MS: 1000,
    LOG_ANALYSIS_QUEUE_CONCURRENCY: 1
  };

  it("does not start consumption before both real connection readiness promises settle", async () => {
    let releaseQueue!: () => void; let releaseWorker!: () => void;
    const queueReady = new Promise<ReturnType<typeof fakeRedisClient>>((resolve) => { releaseQueue = () => resolve(fakeRedisClient()); });
    const workerReady = new Promise<void>((resolve) => { releaseWorker = resolve; });
    const queue = { ...connectionLifecycle(), close: vi.fn(), waitUntilReady: () => queueReady };
    const worker = { ...connectionLifecycle(), close: vi.fn(), waitUntilReady: () => workerReady };
    const starting = createLogAnalysisQueueRuntime({ env: lifecycleEnv, db: {} as Database, objectStore: {} as ObjectStore,
      QueueCtor: vi.fn(function () { return queue; }) as never, WorkerCtor: vi.fn(function () { return worker; }) as never });
    expect(worker.run).not.toHaveBeenCalled();
    releaseQueue(); await Promise.resolve();
    expect(worker.run).not.toHaveBeenCalled();
    releaseWorker();
    const runtime = await starting;
    expect(worker.run).toHaveBeenCalledOnce();
    await runtime.close();
  });

  it("closes both resources on rejected readiness and preserves the static initialization refusal", async () => {
    const queue = { ...connectionLifecycle(), close: vi.fn(async () => { throw new Error("private close failure"); }) };
    const worker = { ...connectionLifecycle(), close: vi.fn(), waitUntilReady: vi.fn(async () => { throw new Error("private initialization failure"); }) };
    await expect(createLogAnalysisQueueRuntime({ env: lifecycleEnv, db: {} as Database, objectStore: {} as ObjectStore,
      QueueCtor: vi.fn(function () { return queue; }) as never, WorkerCtor: vi.fn(function () { return worker; }) as never }))
      .rejects.toThrow("PCAT-LOG-QUEUE-INITIALIZATION-FAILED");
    expect(worker.run).not.toHaveBeenCalled();
    expect(worker.close).toHaveBeenCalledExactlyOnceWith(true);
    expect(queue.close).toHaveBeenCalledOnce();
    expect(worker.off).toHaveBeenCalledWith("error", expect.any(Function));
    expect(queue.off).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("awaits queue cleanup after worker construction fails and preserves the construction error", async () => {
    const constructionError = new Error("worker construction failed");
    let finishCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => { finishCleanup = resolve; });
    const queue = { ...connectionLifecycle(), close: vi.fn(async () => { await cleanup; throw new Error("cleanup failed"); }) };
    const start = Promise.resolve().then(() => createLogAnalysisQueueRuntime({
      env: lifecycleEnv, db: {} as Database, objectStore: {} as ObjectStore,
      QueueCtor: vi.fn(function () { return queue; }) as never,
      WorkerCtor: vi.fn(function () { throw constructionError; }) as never
    }));
    let settled = false;
    const observed = start.catch((error) => { settled = true; return error; });
    await vi.waitFor(() => expect(queue.close).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    finishCleanup();
    expect(await observed).toBe(constructionError);
  });

  it("closes both resources once and awaits queue cleanup when worker close fails synchronously", async () => {
    const closeError = new Error("worker close failed");
    let finishCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => { finishCleanup = resolve; });
    const queue = { ...connectionLifecycle(), close: vi.fn(async () => { await cleanup; }) };
    const worker = { ...connectionLifecycle(), close: vi.fn(() => { throw closeError; }) };
    const runtime = await createLogAnalysisQueueRuntime({
      env: lifecycleEnv, db: {} as Database, objectStore: {} as ObjectStore,
      QueueCtor: vi.fn(function () { return queue; }) as never,
      WorkerCtor: vi.fn(function () { return worker; }) as never
    });
    let settled = false;
    const closing = runtime.close();
    const repeated = runtime.close();
    const observed = Promise.all([closing.catch((error) => error), repeated.catch((error) => error)])
      .then((errors) => { settled = true; return errors; });
    await vi.waitFor(() => expect(queue.close).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    finishCleanup();
    expect(await observed).toEqual([closeError, closeError]);
    expect(worker.close).toHaveBeenCalledOnce();
    expect(queue.close).toHaveBeenCalledOnce();
  });

  it("waits for worker draining even when queue close rejects", async () => {
    const closeError = new Error("queue close failed");
    let finishWorker!: () => void;
    const draining = new Promise<void>((resolve) => { finishWorker = resolve; });
    const worker = { ...connectionLifecycle(), close: vi.fn(async () => { await draining; }) };
    const queue = { ...connectionLifecycle(), close: vi.fn(async () => { throw closeError; }) };
    const runtime = await createLogAnalysisQueueRuntime({
      env: lifecycleEnv, db: {} as Database, objectStore: {} as ObjectStore,
      QueueCtor: vi.fn(function () { return queue; }) as never,
      WorkerCtor: vi.fn(function () { return worker; }) as never
    });
    let settled = false;
    const observed = runtime.close().catch((error) => { settled = true; return error; });
    await Promise.resolve();
    expect(settled).toBe(false);
    finishWorker();
    expect(await observed).toBe(closeError);
    await expect(runtime.close()).rejects.toBe(closeError);
    expect(worker.close).toHaveBeenCalledOnce();
    expect(queue.close).toHaveBeenCalledOnce();
  });

  it("preserves the worker close error when its separately owned client also fails cleanup", async () => {
    const first = new Error("worker close failed");
    const client = fakeRedisClient();
    client.quit = vi.fn(async () => { throw new Error("client cleanup failed"); });
    const queueClient = fakeRedisClient();
    queueClient.duplicate = () => client;
    const queue = { ...connectionLifecycle(), waitUntilReady: async () => queueClient, close: vi.fn() };
    const worker = { ...connectionLifecycle(), close: vi.fn(async () => { throw first; }) };
    const runtime = await createLogAnalysisQueueRuntime({ env: lifecycleEnv, db: {} as Database, objectStore: {} as ObjectStore,
      QueueCtor: vi.fn(function () { return queue; }) as never, WorkerCtor: vi.fn(function () { return worker; }) as never });
    await expect(runtime.close()).rejects.toBe(first);
    expect(client.status).toBe("end");
    expect(queue.close).toHaveBeenCalledOnce();
    await expect(runtime.close()).rejects.toBe(first);
  });

  it("creates a BullMQ queue and worker with Redis connection settings", async () => {
    const processByJobId = vi.fn(async () => ({ status: "processed" as const }));
    const queue = {
      ...connectionLifecycle(),
      add: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getJobCounts: vi.fn(async () => ({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 })),
      close: vi.fn()
    };
    const worker = {
      ...connectionLifecycle(),
      close: vi.fn()
    };
    const QueueCtor = vi.fn(function () {
      return queue;
    });
    const WorkerCtor = vi.fn(function (_name: string, processor: (job: { data: { jobId: string } }) => Promise<string>, _options: unknown) {
      void processor({ data: { jobId: "job-from-bullmq" } });
      return worker;
    });
    const db = {} as Database;
    const objectStore = {} as ObjectStore;
    const metrics = { recordLogAnalysisJobResult: vi.fn() };

    const runtime = await createLogAnalysisQueueRuntime({
      env: {
        REDIS_URL: "redis://redis:6379",
        LOG_ANALYSIS_QUEUE_PREFIX: "wiseeff",
        LOG_ANALYSIS_QUEUE_ATTEMPTS: 5,
        LOG_ANALYSIS_QUEUE_BACKOFF_MS: 2500,
        LOG_ANALYSIS_QUEUE_CONCURRENCY: 3
      },
      db,
      objectStore,
      metrics,
      QueueCtor: QueueCtor as never,
      WorkerCtor: WorkerCtor as never,
      processByJobId
    });

    expect(QueueCtor).toHaveBeenCalledWith("log-analysis", {
      connection: { url: "redis://redis:6379" },
      prefix: "wiseeff"
    }, expect.any(Function));
    expect(WorkerCtor).toHaveBeenCalledWith(
      "log-analysis",
      expect.any(Function),
      {
        connection: expect.objectContaining({ status: "ready" }),
        prefix: "wiseeff",
        concurrency: 3,
        name: "wiseeff-log-worker",
        autorun: false
      },
      expect.any(Function)
    );
    await vi.waitFor(() => {
      expect(processByJobId).toHaveBeenCalledWith({
        db,
        objectStore,
        jobId: "job-from-bullmq",
        workerId: "wiseeff-log-worker",
        maxAttempts: 5,
        retryBaseDelayMs: 2500,
        metrics
      });
    });

    await expect(runtime.queue.checkHealth()).resolves.toMatchObject({ ok: true, status: "ready" });
    await runtime.close();
    expect(worker.close).toHaveBeenCalledOnce();
    expect(queue.close).toHaveBeenCalledOnce();
  });

  it("rejects BullMQ jobs without a jobId payload", async () => {
    const QueueCtor = vi.fn(function () {
      return {
        ...connectionLifecycle(),
        add: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        getJobCounts: vi.fn(),
        close: vi.fn()
      };
    });
    let processor: ((job: { data: unknown }) => Promise<string>) | undefined;
    const WorkerCtor = vi.fn(function (_name: string, handler: (job: { data: unknown }) => Promise<string>) {
      processor = handler;
      return { ...connectionLifecycle(), close: vi.fn() };
    });

    await createLogAnalysisQueueRuntime({
      env: {
        REDIS_URL: "redis://redis:6379",
        LOG_ANALYSIS_QUEUE_PREFIX: "wiseeff",
        LOG_ANALYSIS_QUEUE_ATTEMPTS: 4,
        LOG_ANALYSIS_QUEUE_BACKOFF_MS: 1000,
        LOG_ANALYSIS_QUEUE_CONCURRENCY: 1
      },
      db: {} as Database,
      objectStore: {} as ObjectStore,
      QueueCtor: QueueCtor as never,
      WorkerCtor: WorkerCtor as never,
      processByJobId: vi.fn()
    });

    await expect(processor?.({ data: { runId: "run-1" } })).rejects.toThrow("BullMQ log-analysis job payload must include jobId.");
  });

  it("throws for database-scheduled retries so BullMQ redelivers the message", async () => {
    const QueueCtor = vi.fn(function () {
      return {
        ...connectionLifecycle(),
        add: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        getJobCounts: vi.fn(),
        close: vi.fn()
      };
    });
    let processor: ((job: { data: { jobId: string } }) => Promise<string>) | undefined;
    const WorkerCtor = vi.fn(function (_name: string, handler: (job: { data: { jobId: string } }) => Promise<string>) {
      processor = handler;
      return { ...connectionLifecycle(), close: vi.fn() };
    });

    await createLogAnalysisQueueRuntime({
      env: {
        REDIS_URL: "redis://redis:6379",
        LOG_ANALYSIS_QUEUE_PREFIX: "wiseeff",
        LOG_ANALYSIS_QUEUE_ATTEMPTS: 4,
        LOG_ANALYSIS_QUEUE_BACKOFF_MS: 1000,
        LOG_ANALYSIS_QUEUE_CONCURRENCY: 1
      },
      db: {} as Database,
      objectStore: {} as ObjectStore,
      QueueCtor: QueueCtor as never,
      WorkerCtor: WorkerCtor as never,
      processByJobId: vi.fn(async () => ({ status: "retry" as const, reason: "Retry 2 of 4 after 2000ms." }))
    });

    await expect(processor?.({ data: { jobId: "job-1" } })).rejects.toThrow("Retry 2 of 4 after 2000ms.");
  });

  it("exports low-cardinality durable queue processor spans without Redis or job identifiers", async () => {
    const { spans, tracing } = createTraceRecorder();
    let processor: ((job: { data: { jobId: string } }) => Promise<string>) | undefined;
    const QueueCtor = vi.fn(function () {
      return {
        ...connectionLifecycle(),
        add: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        getJobCounts: vi.fn(),
        close: vi.fn()
      };
    });
    const WorkerCtor = vi.fn(function (_name: string, handler: (job: { data: { jobId: string } }) => Promise<string>) {
      processor = handler;
      return { ...connectionLifecycle(), close: vi.fn() };
    });

    await createLogAnalysisQueueRuntime({
      env: {
        REDIS_URL: "redis://redis-secret:6379",
        LOG_ANALYSIS_QUEUE_PREFIX: "wiseeff-secret",
        LOG_ANALYSIS_QUEUE_ATTEMPTS: 4,
        LOG_ANALYSIS_QUEUE_BACKOFF_MS: 1000,
        LOG_ANALYSIS_QUEUE_CONCURRENCY: 1
      },
      db: {} as Database,
      objectStore: {} as ObjectStore,
      QueueCtor: QueueCtor as never,
      WorkerCtor: WorkerCtor as never,
      processByJobId: vi.fn(async () => ({ status: "processed" as const })),
      tracing
    });

    await expect(processor?.({ data: { jobId: "job-secret" } })).resolves.toBe("processed");

    expect(spans).toEqual([
      expect.objectContaining({
        name: "log_analysis.queue.process",
        attributes: {
          service: "wiseeff-api",
          queue: "log-analysis",
          status: "processed"
        }
      })
    ]);
    expect(JSON.stringify(spans)).not.toContain("job-secret");
    expect(JSON.stringify(spans)).not.toContain("redis-secret");
    expect(JSON.stringify(spans)).not.toContain("wiseeff-secret");
  });

  it("creates an API-side queue transport without starting a worker", async () => {
    let stored: { id: string; data: Record<string, unknown> } | undefined;
    const queue = {
      ...connectionLifecycle(),
      getJob: vi.fn(async (id: string) => stored?.id === id ? stored : undefined),
      add: vi.fn(async (_name: string, data: Record<string, unknown>, options: { jobId: string }) =>
        (stored = { id: options.jobId, data })),
      pause: vi.fn(),
      resume: vi.fn(),
      getJobCounts: vi.fn(async () => ({ waiting: 1, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 })),
      close: vi.fn()
    };
    const QueueCtor = vi.fn(function () {
      return queue;
    });

    const runtime = await createLogAnalysisQueueTransport({
      env: {
        REDIS_URL: "redis://redis:6379",
        LOG_ANALYSIS_QUEUE_PREFIX: "wiseeff",
        LOG_ANALYSIS_QUEUE_ATTEMPTS: 4,
        LOG_ANALYSIS_QUEUE_BACKOFF_MS: 1000,
        LOG_ANALYSIS_QUEUE_CONCURRENCY: 1
      },
      QueueCtor: QueueCtor as never
    });

    await runtime.queue.enqueue({
      name: "analyze-log",
      payload: {
        organizationId: "org-1",
        logId: "log-1",
        runId: "run-1",
        jobId: "job-1"
      },
      idempotencyKey: "log-analysis:job-1"
    });

    expect(QueueCtor).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledWith("analyze-log", expect.objectContaining({ jobId: "job-1" }), expect.any(Object));
    await expect(runtime.queue.checkHealth()).resolves.toMatchObject({ ok: true, waiting: 1 });
    await runtime.close();
    expect(queue.close).toHaveBeenCalledOnce();
  });

  it("refuses API-side transport readiness failure and closes its Queue", async () => {
    const queue = { ...connectionLifecycle(), close: vi.fn(), waitUntilReady: vi.fn(async () => { throw new Error("private transport initialization"); }) };
    await expect(Promise.resolve().then(() => createLogAnalysisQueueTransport({ env: lifecycleEnv,
      QueueCtor: vi.fn(function () { return queue; }) as never })))
      .rejects.toThrow("PCAT-LOG-QUEUE-INITIALIZATION-FAILED");
    expect(queue.close).toHaveBeenCalledOnce();
  });

  it("closes the API-side Queue once across concurrent and repeated shutdown", async () => {
    const queue = { ...connectionLifecycle(), close: vi.fn(async () => {}) };
    const runtime = await createLogAnalysisQueueTransport({ env: lifecycleEnv,
      QueueCtor: vi.fn(function () { return queue; }) as never });
    await Promise.all([runtime.close(), runtime.close()]);
    await runtime.close();
    expect(queue.close).toHaveBeenCalledOnce();
  });
});
