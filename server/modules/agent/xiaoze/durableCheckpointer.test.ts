import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseCheckpointSaver, CheckpointTuple } from "@langchain/langgraph-checkpoint";
import { emptyCheckpoint } from "@langchain/langgraph-checkpoint";
import { EventEmitter } from "node:events";
import type pg from "pg";

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
    constructor(pool: unknown, serde?: unknown) { return mockRuntimeSaver(pool, serde); }
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

    expect(mockPool).toHaveBeenCalledWith({ connectionString: "postgres://localhost/test", connectionTimeoutMillis: 2000 });
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

describe("same physical checkpoint session", () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  };
  async function fixture() {
    vi.resetModules();
    vi.clearAllMocks();
    const { PostgresSaver } = await vi.importActual<typeof import("@langchain/langgraph-checkpoint-postgres")>("@langchain/langgraph-checkpoint-postgres");
    mockRuntimeSaver.mockImplementation((pool: pg.Pool, serde) => new PostgresSaver(pool, serde));
    const client = Object.assign(new EventEmitter(), {
      query: vi.fn(async (sql: string) => ({ rows: sql.includes("pg_try_advisory_lock") ? [{ locked: true }] : sql.includes("pg_advisory_unlock") ? [{ unlocked: true }] : [] })),
      release: vi.fn(),
      end: vi.fn(async () => undefined)
    });
    mockConnect.mockResolvedValue(client);
    const producer = await import("./durableCheckpointer");
    const handle = producer.createPostgresCheckpointerSaver({ connectionString: "postgres://localhost/unit", initialization: "runtime" });
    return { client, handle, producer };
  }
  const config = { configurable: { thread_id: "owned", checkpoint_ns: "", checkpoint_id: "cp" } };

  it("serializes whole official transactions and reads, preserves the initiating rollback failure", async () => {
    const { client, handle } = await fixture();
    const began = deferred();
    const release = deferred();
    const raw = client.query.getMockImplementation()!;
    let first = true;
    client.query.mockImplementation(async (sql) => {
      if (sql === "BEGIN" && first) { first = false; began.resolve(); await release.promise; }
      return raw(sql);
    });
    const run = handle.withNamespaceLease("owned", async () => {
      const put = handle.saver.put(config, emptyCheckpoint(), { source: "input", step: 0, parents: {} }, {});
      await began.promise;
      const writes = handle.saver.putWrites(config, [["answer", "value"]], "task");
      const read = handle.saver.getTuple(config);
      await new Promise(setImmediate);
      expect(client.query.mock.calls.filter(([sql]) => sql === "BEGIN")).toHaveLength(1);
      expect(client.query.mock.calls.some(([sql]) => sql.startsWith("SELECT thread_id"))).toBe(false);
      release.resolve();
      await Promise.all([put, writes, read]);
    });
    await run;
    const statements = client.query.mock.calls.map(([sql]) => sql);
    expect(statements.filter((sql) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql))).toEqual(["BEGIN", "COMMIT", "BEGIN", "COMMIT"]);
    expect(statements.at(-1)).toContain("pg_advisory_unlock");
    expect(mockConnect).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledOnce();

    const initiating = Object.assign(new Error("write failed"), { code: "23514" });
    const secondary = Object.assign(new Error("rollback failed"), { code: "08006" });
    client.query.mockImplementation(async (sql) => {
      if (sql.startsWith("INSERT")) throw initiating;
      if (sql === "ROLLBACK") throw secondary;
      return raw(sql);
    });
    await expect(handle.withNamespaceLease("owned", () => handle.saver.putWrites(config, [["answer", "value"]], "task"))).rejects.toBe(initiating);
    expect(client.release).toHaveBeenLastCalledWith(true);
  });

  it("closes queued admission and late serializers while draining a granted transaction before unlock", async () => {
    const { client, handle } = await fixture();
    const began = deferred(); const finish = deferred(); const callback = deferred();
    const raw = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql) => {
      if (sql === "BEGIN") { began.resolve(); await finish.promise; }
      return raw(sql);
    });
    let granted!: Promise<unknown>; let queued!: Promise<unknown>;
    const run = handle.withNamespaceLease("owned", async () => {
      granted = handle.saver.put(config, emptyCheckpoint(), { source: "input", step: 0, parents: {} }, {});
      await began.promise;
      queued = handle.saver.putWrites(config, [["answer", "queued"]], "queued");
      void queued.catch(() => undefined);
      await new Promise(setImmediate);
      callback.resolve();
    });
    await callback.promise;
    await new Promise(setImmediate);
    expect(client.query.mock.calls.some(([sql]) => sql.includes("pg_advisory_unlock"))).toBe(false);
    finish.resolve();
    await run; await granted;
    await expect(queued).rejects.toMatchObject({ code: "CONFLICT" });
    expect(client.query.mock.calls.filter(([sql]) => sql === "BEGIN")).toHaveLength(1);

    const serialize = deferred(); const entered = deferred();
    const original = handle.saver.serde.dumpsTyped.bind(handle.saver.serde);
    vi.spyOn(handle.saver.serde, "dumpsTyped").mockImplementation(async (value) => { entered.resolve(); await serialize.promise; return original(value); });
    let late!: Promise<void>;
    await handle.withNamespaceLease("owned", async () => {
      late = handle.saver.putWrites(config, [["answer", "late"]], "late");
      void late.catch(() => undefined);
      await entered.promise;
    });
    const sqlCount = client.query.mock.calls.length;
    serialize.resolve();
    await expect(late).rejects.toMatchObject({ code: "CONFLICT" });
    expect(client.query).toHaveBeenCalledTimes(sqlCount);
  });

  it("captures lazy list and cached public writes, rejects mismatched owner and namespaces", async () => {
    const { client, handle, producer } = await fixture();
    const cached = handle.saver.putWrites;
    await expect(cached(config, [], "outside")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(handle.saver.deleteThread("owned")).rejects.toMatchObject({ code: "CONFLICT" });
    const { createXiaozeCheckpointer } = await import("./checkpointer");
    const other = producer.createPostgresCheckpointerSaver({ connectionString: "postgres://localhost/unit", initialization: "runtime" });
    const wrong = createXiaozeCheckpointer({ mode: "postgres", saver: handle.saver, withNamespaceLease: other.withNamespaceLease });
    const work = vi.fn(async () => undefined);
    await expect(wrong.withNamespaceLease("owned", work)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(work).not.toHaveBeenCalled();
    let list!: ReturnType<typeof handle.saver.list>;
    await handle.withNamespaceLease("owned", async () => {
      list = handle.saver.list(config);
      await expect(cached({ configurable: { thread_id: "other" } }, [], "wrong")).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(cached({ configurable: { thread_id: "owned", checkpoint_ns: "nested" } }, [], "wrong")).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(handle.saver.deleteThread("other")).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(handle.withNamespaceLease("owned", work)).rejects.toMatchObject({ code: "CONFLICT" });
      await cached(config, [], "valid");
    });
    const count = client.query.mock.calls.length;
    await other.withNamespaceLease("other", async () => {
      await expect(list.next()).rejects.toMatchObject({ code: "CONFLICT" });
    });
    expect(client.query.mock.calls.slice(count).filter(([sql]) => !sql.includes("advisory"))).toHaveLength(0);
  });

  it("discards unlock false and dead sessions with no pool fallback", async () => {
    const { client, handle } = await fixture();
    const raw = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql) => sql.includes("pg_advisory_unlock") ? { rows: [{ unlocked: false }] } : raw(sql));
    await expect(handle.withNamespaceLease("owned", async () => undefined)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(client.release).toHaveBeenLastCalledWith(true);
    client.query.mockImplementation(raw);
    const failure = new Error("session lost");
    await expect(handle.withNamespaceLease("owned", async () => {
      client.emit("error", failure);
      await handle.saver.putWrites(config, [], "dead");
    })).rejects.toBe(failure);
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(client.release).toHaveBeenCalledTimes(2);
  });

  it("shuts down a held run and refuses pending acquisition, releasing each physical client once", async () => {
    const { client, handle } = await fixture();
    const acquired = deferred(); const proceed = deferred();
    const held = handle.withNamespaceLease("owned", async () => { acquired.resolve(); await proceed.promise; });
    void held.catch(() => undefined);
    await acquired.promise;
    await handle.saver.end();
    expect(client.end).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledOnce();
    proceed.resolve();
    await expect(held).rejects.toMatchObject({ code: "CONFLICT" });
    expect(client.release).toHaveBeenCalledOnce();
    await expect(handle.withNamespaceLease("owned", async () => undefined)).rejects.toMatchObject({ code: "CONFLICT" });

    const next = await fixture();
    const connecting = deferred();
    mockConnect.mockImplementationOnce(async () => { await connecting.promise; return next.client; });
    const pending = next.handle.withNamespaceLease("owned", async () => undefined);
    void pending.catch(() => undefined);
    await next.handle.saver.end();
    connecting.resolve();
    await expect(pending).rejects.toMatchObject({ code: "CONFLICT" });
    expect(next.client.query).not.toHaveBeenCalled();
    expect(next.client.release).toHaveBeenCalledOnce();
  });

  it("terminates an unresolved granted SQL interval before releasing exclusion", async () => {
    const { client, handle } = await fixture();
    const began = deferred();
    let reject!: (error: Error) => void;
    const pending = new Promise<never>((_resolve, fail) => { reject = fail; });
    const raw = client.query.getMockImplementation()!;
    const cleanup: string[] = [];
    client.query.mockImplementation(async (sql) => {
      if (sql === "BEGIN") { began.resolve(); return pending; }
      return raw(sql);
    });
    client.end.mockImplementation(async () => { cleanup.push("end"); reject(new Error("terminated physical connection")); });
    client.release.mockImplementation(() => { cleanup.push("release"); });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let granted!: Promise<unknown>;
    try {
      const run = handle.withNamespaceLease("owned", async () => {
        granted = handle.saver.put(config, emptyCheckpoint(), { source: "input", step: 0, parents: {} }, {});
        void granted.catch(() => undefined);
        await began.promise;
      });
      void run.catch(() => undefined);
      await began.promise;
      await vi.advanceTimersByTimeAsync(2000);
      await expect(run).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(granted).rejects.toMatchObject({ code: "CONFLICT" });
      expect(cleanup).toEqual(["end", "release"]);
      expect(client.release).toHaveBeenCalledOnce();
      expect(client.query.mock.calls.some(([sql]) => sql.includes("pg_advisory_unlock"))).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
