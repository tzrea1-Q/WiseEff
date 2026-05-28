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
    expect(() => validateLogWorkerConfig({ OBJECT_STORE_ROOT: ".wiseeff-object-store" })).toThrow(
      "DATABASE_URL is required to start the log worker."
    );
  });

  it("refuses to start without object store configuration", () => {
    expect(() => validateLogWorkerConfig({ DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff", OBJECT_STORE_ROOT: " " })).toThrow(
      "OBJECT_STORE_ROOT is required to start the log worker."
    );
  });

  it("starts the worker loop with injected dependencies", () => {
    const stop = vi.fn();
    const startLoop = vi.fn(() => stop);
    const db = { query: vi.fn(), transaction: vi.fn() };
    const objectStore = { put: vi.fn(), get: vi.fn() };

    const runtime = createLogWorkerRuntime({ db, objectStore, startLoop, workerId: "worker-a", leaseTtlMs: 30000, intervalMs: 250 });
    const returnedStop = runtime.start();

    expect(returnedStop).toBe(stop);
    expect(startLoop).toHaveBeenCalledWith({ db, objectStore, workerId: "worker-a", leaseTtlMs: 30000 }, 250);
  });
});
