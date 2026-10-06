import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseCheckpointSaver, CheckpointTuple } from "@langchain/langgraph-checkpoint";

const mockSetup = vi.fn().mockResolvedValue(undefined);
const mockEnd = vi.fn().mockResolvedValue(undefined);
const mockFromConnString = vi.fn((_connectionString: string) => ({ setup: mockSetup, getTuple: vi.fn(), end: mockEnd }));
const mockRuntimeSaver = vi.fn();
const mockRelease = vi.fn();
const mockQuery = vi.fn();
const mockConnect = vi.fn(async () => ({ query: mockQuery, release: mockRelease }));
const mockPool = vi.fn();

function readyQuery(sql: string) {
  if (sql.includes("FROM pg_class")) return { rows: [
    ["checkpoint_migrations", "v:int4:required", ["v"]],
    ["checkpoints", "thread_id:text:required checkpoint_ns:text:required checkpoint_id:text:required parent_checkpoint_id:text:nullable type:text:nullable checkpoint:jsonb:required metadata:jsonb:required", ["thread_id", "checkpoint_ns", "checkpoint_id"]],
    ["checkpoint_blobs", "thread_id:text:required checkpoint_ns:text:required channel:text:required version:text:required type:text:required blob:bytea:nullable", ["thread_id", "checkpoint_ns", "channel", "version"]],
    ["checkpoint_writes", "thread_id:text:required checkpoint_ns:text:required checkpoint_id:text:required task_id:text:required idx:int4:required channel:text:required type:text:nullable blob:bytea:required", ["thread_id", "checkpoint_ns", "checkpoint_id", "task_id", "idx"]]
  ].map(([name, specs, key]) => ({ name, key, usable: true, privileges: true,
    columns: (specs as string).split(" ").map((spec) => {
      const [name, type, nullability] = spec.split(":");
      return { name, type, required: nullability === "required", default: name === "metadata" ? "'{}'::jsonb" : name === "checkpoint_ns" ? "''::text" : null };
    })
  })) };
  return { rows: sql.startsWith("SELECT v") ? [0, 1, 2, 3, 4].map((v) => ({ v })) : [] };
}

vi.mock("pg", () => ({ default: { Pool: class {
  constructor(options: unknown) { mockPool(options); }
  connect = mockConnect;
  end = mockEnd;
} } }));

vi.mock("@langchain/langgraph-checkpoint-postgres", () => ({
  PostgresSaver: class {
    constructor(pool: unknown) { return mockRuntimeSaver(pool); }
    static fromConnString(connectionString: string) { return mockFromConnString(connectionString); }
  }
}));

describe("createPostgresCheckpointerSaver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockQuery.mockImplementation(readyQuery);
    mockRuntimeSaver.mockReturnValue({ getTuple: vi.fn(), end: mockEnd });
  });

  it("returns a saver from the connection string", async () => {
    const { createPostgresCheckpointerSaver } = await import("./durableCheckpointer");
    const handle = createPostgresCheckpointerSaver({ connectionString: "postgres://user:pass@localhost:5432/db" });

    expect(mockFromConnString).toHaveBeenCalledWith("postgres://user:pass@localhost:5432/db");
    expect(handle.saver).toBeDefined();
    expect(handle.saver.setup).toBe(mockSetup);
  });

  it("calls setup at most once when ensureSetup is invoked twice", async () => {
    const { createPostgresCheckpointerSaver } = await import("./durableCheckpointer");
    const handle = createPostgresCheckpointerSaver({ connectionString: "postgres://localhost/test" });

    await handle.ensureSetup();
    await handle.ensureSetup();

    expect(mockSetup).toHaveBeenCalledTimes(1);
  });

  it("validates concurrent runtime initialization once on its saver's pool without setup", async () => {
    const { createPostgresCheckpointerSaver } = await import("./durableCheckpointer");
    const handle = createPostgresCheckpointerSaver({ connectionString: "postgres://localhost/test", initialization: "runtime" });
    await Promise.all([handle.ensureSetup(), handle.ensureSetup()]);
    await handle.ensureSetup();
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockRuntimeSaver.mock.calls[0][0].connect).toBe(mockConnect);
    expect(mockSetup).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN READ ONLY", expect.stringContaining("FROM pg_class"), "SELECT v FROM public.checkpoint_migrations ORDER BY v", "COMMIT"
    ]);
    expect(mockRelease).toHaveBeenCalledOnce();
    await handle.saver.end();
    expect(mockEnd).toHaveBeenCalledOnce();
  });

  it("memoizes rejected readiness, preserving SQLSTATE and releasing the client", async () => {
    const failure = Object.assign(new Error("permission denied"), { code: "42501" });
    mockQuery.mockRejectedValueOnce(failure);
    const { createPostgresCheckpointerSaver } = await import("./durableCheckpointer");
    const handle = createPostgresCheckpointerSaver({ connectionString: "postgres://localhost/test", initialization: "runtime" });
    await expect(handle.ensureSetup()).rejects.toBe(failure);
    await expect(handle.ensureSetup()).rejects.toBe(failure);
    expect(mockConnect).toHaveBeenCalledOnce();
    expect(mockRelease).toHaveBeenCalledOnce();
    expect(mockSetup).not.toHaveBeenCalled();
    await handle.saver.end();
  });

  it("ends the distinct bootstrap handle on setup failure", async () => {
    const failure = new Error("bootstrap failed");
    mockSetup.mockRejectedValueOnce(failure);
    const { setupXiaozeCheckpointerTables } = await import("./durableCheckpointer");
    await expect(setupXiaozeCheckpointerTables({ mode: "postgres", connectionString: "postgres://localhost/test" })).rejects.toBe(failure);
    expect(mockEnd).toHaveBeenCalledOnce();
    expect(mockPool).not.toHaveBeenCalled();
  });
});

describe("interrupt checkpoint durability helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockQuery.mockImplementation(readyQuery);
  });

  it("detects pending mutating calls in checkpoint tuples", async () => {
    const { isInterruptCheckpointReadable } = await import("./durableCheckpointer");
    const readable: CheckpointTuple = {
      config: { configurable: { thread_id: "t1" } },
      checkpoint: {
        v: 4,
        id: "cp-1",
        ts: "2026-01-01T00:00:00.000Z",
        channel_values: {
          pendingMutatingCall: { id: "tc-1", name: "action.submitParameterChange", args: {} }
        },
        channel_versions: {},
        versions_seen: {}
      }
    };

    expect(isInterruptCheckpointReadable(readable)).toBe(true);
    expect(isInterruptCheckpointReadable(undefined)).toBe(false);
    expect(
      isInterruptCheckpointReadable({
        ...readable,
        checkpoint: { ...readable.checkpoint, channel_values: {} }
      })
    ).toBe(false);
  });

  it("polls until the interrupt checkpoint is readable", async () => {
    const { waitForInterruptCheckpointDurable } = await import("./durableCheckpointer");
    const getTuple = vi
      .fn<NonNullable<BaseCheckpointSaver["getTuple"]>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        config: { configurable: { thread_id: "t1" } },
        checkpoint: {
          v: 4,
          id: "cp-1",
          ts: "2026-01-01T00:00:00.000Z",
          channel_values: {
            pendingMutatingCall: { id: "tc-1", name: "action.submitParameterChange", args: {} }
          },
          channel_versions: {},
          versions_seen: {}
        }
      });
    const saver = { getTuple } as unknown as BaseCheckpointSaver;

    await waitForInterruptCheckpointDurable({
      threadId: "t1",
      saver,
      pollIntervalMs: 1,
      timeoutMs: 50
    });

    expect(getTuple).toHaveBeenCalledTimes(2);
    expect(getTuple).toHaveBeenCalledWith({ configurable: { thread_id: "t1" } });
  });

  it("verifies postgres durability through a fresh saver connection", async () => {
    const { waitForInterruptCheckpointDurable, resetSharedPostgresCheckpointerSaverForTests } = await import(
      "./durableCheckpointer"
    );
    resetSharedPostgresCheckpointerSaverForTests();
    const freshGetTuple = vi.fn().mockResolvedValue({
      config: { configurable: { thread_id: "t1" } },
      checkpoint: {
        v: 4,
        id: "cp-1",
        ts: "2026-01-01T00:00:00.000Z",
        channel_values: {
          pendingMutatingCall: { id: "tc-1", name: "action.submitParameterChange", args: {} }
        },
        channel_versions: {},
        versions_seen: {}
      }
    });
    mockRuntimeSaver.mockReturnValueOnce({ getTuple: freshGetTuple, end: mockEnd });
    const saver = { getTuple: vi.fn() } as unknown as BaseCheckpointSaver;

    await waitForInterruptCheckpointDurable({
      threadId: "t1",
      saver,
      connectionString: "postgres://localhost/test",
      pollIntervalMs: 1,
      timeoutMs: 50
    });

    expect(mockPool).toHaveBeenCalledWith({ connectionString: "postgres://localhost/test" });
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockSetup).not.toHaveBeenCalled();
    expect(freshGetTuple).toHaveBeenCalledWith({ configurable: { thread_id: "t1" } });
    expect(saver.getTuple).not.toHaveBeenCalled();
  });

  it("reuses one durability probe pool across waits", async () => {
    const { waitForInterruptCheckpointDurable, resetSharedPostgresCheckpointerSaverForTests } = await import(
      "./durableCheckpointer"
    );
    resetSharedPostgresCheckpointerSaverForTests();
    const readable = {
      config: { configurable: { thread_id: "t1" } },
      checkpoint: {
        v: 4,
        id: "cp-1",
        ts: "2026-01-01T00:00:00.000Z",
        channel_values: {
          pendingMutatingCall: { id: "tc-1", name: "action.submitParameterChange", args: {} }
        },
        channel_versions: {},
        versions_seen: {}
      }
    };
    const probeGetTuple = vi.fn().mockResolvedValue(readable);
    mockRuntimeSaver.mockReturnValue({ getTuple: probeGetTuple, end: mockEnd });
    const saver = { getTuple: vi.fn() } as unknown as BaseCheckpointSaver;

    await waitForInterruptCheckpointDurable({
      threadId: "t1",
      saver,
      connectionString: "postgres://localhost/test",
      pollIntervalMs: 1,
      timeoutMs: 50
    });
    await waitForInterruptCheckpointDurable({
      threadId: "t1",
      saver,
      connectionString: "postgres://localhost/test",
      pollIntervalMs: 1,
      timeoutMs: 50
    });

    expect(mockPool).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockSetup).not.toHaveBeenCalled();
    expect(probeGetTuple).toHaveBeenCalledTimes(2);
  });

  it("throws when the interrupt checkpoint does not become readable", async () => {
    const { waitForInterruptCheckpointDurable } = await import("./durableCheckpointer");
    const saver = { getTuple: vi.fn().mockResolvedValue(undefined) } as unknown as BaseCheckpointSaver;

    await expect(
      waitForInterruptCheckpointDurable({
        threadId: "t1",
        saver,
        pollIntervalMs: 5,
        timeoutMs: 20
      })
    ).rejects.toThrow(/did not become durable within 20ms/);
  });
});
