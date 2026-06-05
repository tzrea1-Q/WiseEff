import { describe, expect, it, vi } from "vitest";
import { createLogWorkerRuntime, validateLogWorkerConfig } from "./workerRunner";

describe("log worker runner", () => {
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

    await createLogWorkerRuntimeFromEnv({
      DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
      OBJECT_STORE_MODE: "s3",
      OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
      OBJECT_STORAGE_BUCKET: "wiseeff-pilot",
      OBJECT_STORAGE_ACCESS_KEY_ID: "key",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret"
    });

    expect(loadServerEnv).toHaveBeenCalledWith({
      DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
      OBJECT_STORE_MODE: "s3",
      OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
      OBJECT_STORAGE_BUCKET: "wiseeff-pilot",
      OBJECT_STORAGE_ACCESS_KEY_ID: "key",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret"
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

  it("starts the worker loop with injected dependencies", () => {
    const stop = vi.fn();
    const startLoop = vi.fn(() => stop);
    const db = { query: vi.fn(), transaction: vi.fn() };
    const objectStore = { put: vi.fn(), get: vi.fn() };
    const metrics = { recordLogAnalysisJobResult: vi.fn() };

    const runtime = createLogWorkerRuntime({ db, objectStore, startLoop, metrics, workerId: "worker-a", leaseTtlMs: 30000, intervalMs: 250 });
    const returnedStop = runtime.start();

    expect(returnedStop).toBe(stop);
    expect(startLoop).toHaveBeenCalledWith({ db, objectStore, metrics, workerId: "worker-a", leaseTtlMs: 30000 }, 250);
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
    const db = { query: vi.fn(), transaction: vi.fn() };
    const objectStore = { put: vi.fn(), get: vi.fn() };
    const metrics = { recordLogAnalysisJobResult: vi.fn() };

    const runtime = createLogWorkerRuntime({
      db,
      objectStore,
      metrics,
      startLoop,
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
    await stop();

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
      workerId: "wiseeff-log-worker"
    });
    expect(startLoop).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
