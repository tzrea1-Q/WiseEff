import { describe, expect, it, vi } from "vitest";

import { createTracingBoundary, type TraceExporter } from "../../observability/tracing";
import type { Database } from "../../shared/database/client";
import type { ObjectStore } from "./objectStore";
import { createLogAnalysisQueueRuntime, createLogAnalysisQueueTransport } from "./logAnalysisQueueRuntime";

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
  it.each(["queued", "processing"])("does not acknowledge an idle delivery while its database job is %s", async status => {
    let processor!: (job: { data: { jobId: string }; moveToDelayed(timestamp: number, token?: string): Promise<void> }, token?: string) => Promise<string>;
    const db = { query: vi.fn(async () => ({ rows: [{ id: "job", status, updated_at: "2026-09-09T00:00:00Z" }], rowCount: 1 })) } as unknown as Database;
    const runtime = createLogAnalysisQueueRuntime({
      db, objectStore: {} as ObjectStore,
      env: { REDIS_URL: "redis://redis:6379", LOG_ANALYSIS_QUEUE_PREFIX: "wiseeff", LOG_ANALYSIS_QUEUE_ATTEMPTS: 4, LOG_ANALYSIS_QUEUE_BACKOFF_MS: 1000, LOG_ANALYSIS_QUEUE_CONCURRENCY: 1 },
      QueueCtor: vi.fn(function () { return { close: vi.fn() }; }) as never,
      WorkerCtor: vi.fn(function (_name: string, handler: typeof processor) { processor = handler; return { close: vi.fn() }; }) as never,
      processByJobId: vi.fn(async () => ({ status: "idle" as const })),
    });
    const moveToDelayed = vi.fn(async (_timestamp: number, _token?: string) => {});
    const started = Date.now();
    await expect(processor({ data: { jobId: "job" }, moveToDelayed }, "token")).rejects.toThrow("bullmq:movedToDelayed");
    expect(moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "token");
    expect(moveToDelayed.mock.calls[0][0]).toBeGreaterThanOrEqual(started + 1000);
    await runtime.close();
  });
  it("creates a BullMQ queue and worker with Redis connection settings", async () => {
    const processByJobId = vi.fn(async () => ({ status: "processed" as const }));
    const queue = {
      add: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getJobCounts: vi.fn(async () => ({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 })),
      close: vi.fn()
    };
    const worker = {
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

    const runtime = createLogAnalysisQueueRuntime({
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
    });
    expect(WorkerCtor).toHaveBeenCalledWith(
      "log-analysis",
      expect.any(Function),
      {
        connection: { url: "redis://redis:6379" },
        prefix: "wiseeff",
        concurrency: 3,
        name: "wiseeff-log-worker"
      }
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
      return { close: vi.fn() };
    });

    createLogAnalysisQueueRuntime({
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

  it("redelivers at the database retry deadline without consuming a second retry budget", async () => {
    const QueueCtor = vi.fn(function () {
      return {
        add: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        getJobCounts: vi.fn(),
        close: vi.fn()
      };
    });
    let processor: ((job: { data: { jobId: string }; moveToDelayed: (timestamp: number, token?: string) => Promise<void> }, token?: string) => Promise<string>) | undefined;
    const WorkerCtor = vi.fn(function (_name: string, handler: NonNullable<typeof processor>) {
      processor = handler;
      return { close: vi.fn() };
    });

    createLogAnalysisQueueRuntime({
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
      processByJobId: vi.fn(async () => ({ status: "retry" as const, reason: "Retry 2 of 4 after 2000ms.", nextRunAt: "2026-09-09T00:00:02.000Z" }))
    });

    const moveToDelayed = vi.fn(async () => {});
    await expect(processor?.({ data: { jobId: "job-1" }, moveToDelayed }, "lease-token")).rejects.toThrow("bullmq:movedToDelayed");
    expect(moveToDelayed).toHaveBeenCalledWith(Date.parse("2026-09-09T00:00:02.000Z"), "lease-token");
  });

  it("exports low-cardinality durable queue processor spans without Redis or job identifiers", async () => {
    const { spans, tracing } = createTraceRecorder();
    let processor: ((job: { data: { jobId: string } }) => Promise<string>) | undefined;
    const QueueCtor = vi.fn(function () {
      return {
        add: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        getJobCounts: vi.fn(),
        close: vi.fn()
      };
    });
    const WorkerCtor = vi.fn(function (_name: string, handler: (job: { data: { jobId: string } }) => Promise<string>) {
      processor = handler;
      return { close: vi.fn() };
    });

    createLogAnalysisQueueRuntime({
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
    const stored = new Map<string, { id: string; data: Record<string, unknown> }>();
    const queue = {
      getJob: vi.fn(async (id: string) => stored.get(id)),
      add: vi.fn(async (_name: string, data: Record<string, unknown>, options: { jobId: string }) => {
        const job = { id: options.jobId, data };
        stored.set(job.id, job);
        return job;
      }),
      pause: vi.fn(),
      resume: vi.fn(),
      getJobCounts: vi.fn(async () => ({ waiting: 1, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 })),
      close: vi.fn()
    };
    const QueueCtor = vi.fn(function () {
      return queue;
    });

    const runtime = createLogAnalysisQueueTransport({
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
});
