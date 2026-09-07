import { afterEach, expect, it, vi } from "vitest";

// Resource-lifecycle unit tests at the env runtime constructor. These do not
// establish Catalog approval or replace actual production-process acceptance.
afterEach(() => {
  vi.doUnmock("../../config/env");
  vi.doUnmock("../../shared/database/runtimeConnection");
  vi.doUnmock("../parameter-kernel/parameterIdentityMode");
  vi.resetModules();
});

it.each([false, true])("closes an admitted pool and redacts initialization errors (close fails: %s)", async (closeFails) => {
  vi.resetModules();
  const close = vi.fn(async () => {
    if (closeFails) throw new Error("private cleanup connection string");
  });
  vi.doMock("../../config/env", () => ({ loadServerEnv: () => ({
    NODE_ENV: "production", DATABASE_URL: "private connection string",
    OBJECT_STORE_MODE: "local", OBJECT_STORE_ROOT: "/unused",
  }) }));
  vi.doMock("../../shared/database/runtimeConnection", () => ({
    openRuntimeDatabase: async () => ({ close }),
  }));
  vi.doMock("../parameter-kernel/parameterIdentityMode", () => ({
    resolveParameterIdentityMode: async () => { throw new Error("private database diagnostic"); },
  }));
  const { createLogWorkerRuntimeFromEnv } = await import("./workerRunner");
  await expect(createLogWorkerRuntimeFromEnv({})).rejects.toMatchObject({
    message: "PCAT-RUNTIME-WORKER-INITIALIZATION-FAILED",
  });
  expect(close).toHaveBeenCalledOnce();
});

it("preserves the admission refusal before any worker initialization", async () => {
  vi.resetModules();
  const refusal = new Error("PCAT-RUNTIME-LIVE-PIN-ADAPTER-UNAVAILABLE");
  const initialize = vi.fn();
  vi.doMock("../../config/env", () => ({ loadServerEnv: () => ({
    NODE_ENV: "production", DATABASE_URL: "private connection string",
    OBJECT_STORE_MODE: "local", OBJECT_STORE_ROOT: "/unused",
  }) }));
  vi.doMock("../../shared/database/runtimeConnection", () => ({
    openRuntimeDatabase: async () => { throw refusal; },
  }));
  vi.doMock("../parameter-kernel/parameterIdentityMode", () => ({ resolveParameterIdentityMode: initialize }));
  const { createLogWorkerRuntimeFromEnv } = await import("./workerRunner");
  await expect(createLogWorkerRuntimeFromEnv({})).rejects.toBe(refusal);
  expect(initialize).not.toHaveBeenCalled();
});
