import { describe, expect, it, vi } from "vitest";
import {
  createLogWorkerObservabilityServer,
  createLogWorkerRuntime,
  resolveLogWorkerObservabilityConfig,
  validateLogWorkerConfig
} from "./workerRunner";
import { createMetricsRegistry } from "../../observability/metrics";
import type { LogWebhookDeliveryRetentionLoopStarter } from "./webhookRetention";

describe("log worker runner", () => {
  it("exposes private worker liveness and Prometheus metrics", async () => {
    const metrics = createMetricsRegistry({ serviceName: "wiseeff-log-worker" });
    const server = createLogWorkerObservabilityServer({ metrics });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Worker observability server did not bind a TCP port.");
    }

    try {
      const live = await fetch(`http://127.0.0.1:${address.port}/health/live`);
      expect(live.status).toBe(200);
      await expect(live.json()).resolves.toEqual({ ok: true, service: "wiseeff-log-worker", status: "live" });

      const metricsResponse = await fetch(`http://127.0.0.1:${address.port}/metrics`);
      expect(metricsResponse.status).toBe(200);
      expect(metricsResponse.headers.get("content-type")).toContain("text/plain");
      expect(await metricsResponse.text()).toContain('wiseeff_build_info{service="wiseeff-log-worker"} 1');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("keeps the worker observability listener private unless the deployment opts into a compose-network bind", () => {
    expect(resolveLogWorkerObservabilityConfig({})).toEqual({ host: "127.0.0.1", port: 8788 });
    expect(
      resolveLogWorkerObservabilityConfig({ LOG_WORKER_OBSERVABILITY_HOST: "0.0.0.0", LOG_WORKER_OBSERVABILITY_PORT: "9797" })
    ).toEqual({ host: "0.0.0.0", port: 9797 });
    expect(() => resolveLogWorkerObservabilityConfig({ LOG_WORKER_OBSERVABILITY_PORT: "invalid" })).toThrow(
      "LOG_WORKER_OBSERVABILITY_PORT must be a positive integer."
    );
  });

  it("does not load dotenv as an import-time side effect", async () => {
    vi.resetModules();
    vi.doMock("dotenv/config", () => {
      throw new Error("dotenv should only load from explicit env runtime creation.");
    });

    await expect(import("./workerRunner")).resolves.toHaveProperty("createLogWorkerRuntime");
    vi.doUnmock("dotenv/config");
  });

  it("refuses to start without database configuration", () => {
    expect(() =>
      validateLogWorkerConfig({
        OBJECT_STORE_MODE: "local",
        OBJECT_STORE_ROOT: ".wiseeff-object-store"
      })
    ).toThrow("DATABASE_URL is required to start the log worker.");
  });

  it("refuses to start without local object store configuration", () => {
    expect(() =>
      validateLogWorkerConfig({
        DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
        OBJECT_STORE_MODE: "local",
        OBJECT_STORE_ROOT: " "
      })
    ).toThrow("OBJECT_STORE_ROOT is required to start the log worker.");
  });

  it("allows S3 worker configuration without OBJECT_STORE_ROOT", () => {
    expect(() =>
      validateLogWorkerConfig({
        DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
        OBJECT_STORE_MODE: "s3",
        OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
        OBJECT_STORAGE_BUCKET: "wiseeff-pilot",
        OBJECT_STORAGE_ACCESS_KEY_ID: "key",
        OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret"
      })
    ).not.toThrow();
  });

  it("requires Redis URL when durable queue mode is enabled", () => {
    expect(() =>
      validateLogWorkerConfig({
        DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
        OBJECT_STORE_MODE: "local",
        OBJECT_STORE_ROOT: ".wiseeff-object-store",
        LOG_ANALYSIS_QUEUE_MODE: "durable"
      })
    ).toThrow("REDIS_URL is required when LOG_ANALYSIS_QUEUE_MODE=durable.");
  });

  it("allows explicit polling mode without Redis", () => {
    expect(() =>
      validateLogWorkerConfig({
        DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
        OBJECT_STORE_MODE: "local",
        OBJECT_STORE_ROOT: ".wiseeff-object-store",
        LOG_ANALYSIS_QUEUE_MODE: "polling"
      })
    ).not.toThrow();
  });

  it("uses the env-aware object store factory when starting from env", async () => {
    vi.resetModules();

    const createObjectStoreFromEnv = vi.fn(() => ({
      put: vi.fn(),
      get: vi.fn(),
      checkHealth: vi.fn()
    }));
    const createPostgresDatabase = vi.fn(() => ({ query: vi.fn(), transaction: vi.fn() }));
    const loadServerEnv = vi.fn(() => ({
      DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
      OBJECT_STORE_MODE: "s3",
      OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
      OBJECT_STORAGE_BUCKET: "wiseeff-pilot",
      OBJECT_STORAGE_ACCESS_KEY_ID: "key",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret"
    }));

    vi.doMock("../../objectStoreFactory", () => ({
      createObjectStoreFromEnv
    }));
    vi.doMock("../../config/env", () => ({
      loadServerEnv
    }));
    vi.doMock("../../shared/database/client", () => ({
      createPostgresDatabase
    }));
    vi.doMock("../../observability/tracing", () => ({
      defaultTracingBoundary: { withSpan: vi.fn() }
    }));

    const { createLogWorkerRuntimeFromEnv } = await import("./workerRunner");

    const runtime = await createLogWorkerRuntimeFromEnv({
      DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
      OBJECT_STORE_MODE: "s3",
      OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
      OBJECT_STORAGE_BUCKET: "wiseeff-pilot",
      OBJECT_STORAGE_ACCESS_KEY_ID: "key",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
      LOG_WORKER_OBSERVABILITY_HOST: "0.0.0.0",
      LOG_WORKER_OBSERVABILITY_PORT: "8788"
    });

    expect(runtime.observability).toEqual({ host: "0.0.0.0", port: 8788 });
    expect(runtime.metrics.renderPrometheus()).toContain('wiseeff_build_info{service="wiseeff-log-worker"} 1');

    expect(loadServerEnv).toHaveBeenCalledWith({
      DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
      OBJECT_STORE_MODE: "s3",
      OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
      OBJECT_STORAGE_BUCKET: "wiseeff-pilot",
      OBJECT_STORAGE_ACCESS_KEY_ID: "key",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
      LOG_WORKER_OBSERVABILITY_HOST: "0.0.0.0",
      LOG_WORKER_OBSERVABILITY_PORT: "8788"
    });
    expect(createObjectStoreFromEnv).toHaveBeenCalledWith(
      expect.objectContaining({
        OBJECT_STORE_MODE: "s3",
        OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
        OBJECT_STORAGE_BUCKET: "wiseeff-pilot",
        OBJECT_STORAGE_ACCESS_KEY_ID: "key",
        OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret"
      }),
      expect.objectContaining({ tracing: expect.any(Object) })
    );
    expect(createPostgresDatabase).toHaveBeenCalledWith(
      "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
      expect.objectContaining({ tracing: expect.any(Object) })
    );
  });

  it("starts the worker loop with injected dependencies and awaits retention shutdown", async () => {
    const stop = vi.fn();
    const startLoop = vi.fn(() => stop);
    let resolveRetentionStop: (() => void) | undefined;
    const retentionStopped = new Promise<void>((resolve) => {
      resolveRetentionStop = resolve;
    });
    const stopRetention = vi.fn(() => retentionStopped);
    const startRetentionLoop = vi.fn<LogWebhookDeliveryRetentionLoopStarter>(
      () => stopRetention
    );
    const db = { query: vi.fn(), transaction: vi.fn() };
    const objectStore = { put: vi.fn(), get: vi.fn() };
    const metrics = { recordLogAnalysisJobResult: vi.fn() };

    const runtime = createLogWorkerRuntime({
      db,
      objectStore,
      startLoop,
      startRetentionLoop,
      retention: { enabled: true, keepPerDomain: 10_000 },
      metrics,
      workerId: "worker-a",
      leaseTtlMs: 30000,
      intervalMs: 250
    });
    const returnedStop = runtime.start();

    let shutdownFinished = false;
    const shutdown = Promise.resolve(returnedStop()).then(() => {
      shutdownFinished = true;
    });

    expect(startLoop).toHaveBeenCalledWith({ db, objectStore, metrics, workerId: "worker-a", leaseTtlMs: 30000 }, 250);
    expect(startRetentionLoop).toHaveBeenCalledOnce();
    expect(startRetentionLoop).toHaveBeenCalledWith({ db, keepPerDomain: 10_000 });
    expect(stop).toHaveBeenCalledOnce();
    expect(stopRetention).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(shutdownFinished).toBe(false);

    resolveRetentionStop?.();
    await shutdown;
    expect(shutdownFinished).toBe(true);
  });

  it("keeps retention disabled when the rollback switch is false", () => {
    const startRetentionLoop = vi.fn<LogWebhookDeliveryRetentionLoopStarter>(
      () => async () => undefined
    );
    const runtime = createLogWorkerRuntime({
      db: { query: vi.fn(), transaction: vi.fn() },
      objectStore: { put: vi.fn(), get: vi.fn() },
      startLoop: vi.fn(() => vi.fn()),
      startRetentionLoop,
      retention: { enabled: false, keepPerDomain: 10_000 }
    });

    runtime.start()();

    expect(startRetentionLoop).not.toHaveBeenCalled();
  });

  it("starts a durable BullMQ runtime instead of polling when queue mode is durable", async () => {
    const close = vi.fn(async () => undefined);
    const createDurableRuntime = vi.fn(() => ({
      queue: {
        enqueue: vi.fn(),
        processNext: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        getStats: vi.fn(),
        checkHealth: vi.fn()
      },
      close
    }));
    const startLoop = vi.fn(() => vi.fn());
    let resolveRetentionStop: (() => void) | undefined;
    const retentionStopped = new Promise<void>((resolve) => {
      resolveRetentionStop = resolve;
    });
    const stopRetention = vi.fn(() => retentionStopped);
    const startRetentionLoop = vi.fn<LogWebhookDeliveryRetentionLoopStarter>(
      () => stopRetention
    );
    const db = { query: vi.fn(), transaction: vi.fn() };
    const objectStore = { put: vi.fn(), get: vi.fn() };
    const metrics = { recordLogAnalysisJobResult: vi.fn() };

    const runtime = createLogWorkerRuntime({
      db,
      objectStore,
      metrics,
      startLoop,
      startRetentionLoop,
      retention: { enabled: true, keepPerDomain: 10_000 },
      createDurableRuntime,
      queueMode: "durable",
      env: {
        REDIS_URL: "redis://redis:6379",
        LOG_ANALYSIS_QUEUE_PREFIX: "wiseeff",
        LOG_ANALYSIS_QUEUE_ATTEMPTS: 4,
        LOG_ANALYSIS_QUEUE_BACKOFF_MS: 1000,
        LOG_ANALYSIS_QUEUE_CONCURRENCY: 2
      }
    });
    const stop = runtime.start();
    let shutdownFinished = false;
    const shutdown = Promise.resolve(stop()).then(() => {
      shutdownFinished = true;
    });

    expect(createDurableRuntime).toHaveBeenCalledWith({
      env: {
        REDIS_URL: "redis://redis:6379",
        LOG_ANALYSIS_QUEUE_PREFIX: "wiseeff",
        LOG_ANALYSIS_QUEUE_ATTEMPTS: 4,
        LOG_ANALYSIS_QUEUE_BACKOFF_MS: 1000,
        LOG_ANALYSIS_QUEUE_CONCURRENCY: 2
      },
      db,
      objectStore,
      metrics,
      tracing: expect.any(Object),
      workerId: "wiseeff-log-worker"
    });
    expect(startLoop).not.toHaveBeenCalled();
    expect(startRetentionLoop).toHaveBeenCalledOnce();
    expect(startRetentionLoop).toHaveBeenCalledWith({ db, keepPerDomain: 10_000 });
    expect(stopRetention).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(shutdownFinished).toBe(false);

    resolveRetentionStop?.();
    await shutdown;
    expect(shutdownFinished).toBe(true);
  });
});
