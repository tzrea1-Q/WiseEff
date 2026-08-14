import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseCheckpointSaver, CheckpointTuple } from "@langchain/langgraph-checkpoint";

const mockSetup = vi.fn().mockResolvedValue(undefined);
const mockFromConnString = vi.fn((_connectionString: string) => ({ setup: mockSetup, getTuple: vi.fn() }));

vi.mock("@langchain/langgraph-checkpoint-postgres", () => ({
  PostgresSaver: {
    fromConnString: (connectionString: string) => mockFromConnString(connectionString)
  }
}));

describe("createPostgresCheckpointerSaver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
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
});

describe("interrupt checkpoint durability helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
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
    mockFromConnString.mockReturnValueOnce({ setup: mockSetup, getTuple: freshGetTuple });
    const saver = { getTuple: vi.fn() } as unknown as BaseCheckpointSaver;

    await waitForInterruptCheckpointDurable({
      threadId: "t1",
      saver,
      connectionString: "postgres://localhost/test",
      pollIntervalMs: 1,
      timeoutMs: 50
    });

    expect(mockFromConnString).toHaveBeenCalledWith("postgres://localhost/test");
    expect(mockSetup).toHaveBeenCalledTimes(1);
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
    mockFromConnString.mockReturnValue({ setup: mockSetup, getTuple: probeGetTuple });
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

    expect(mockFromConnString).toHaveBeenCalledTimes(1);
    expect(mockSetup).toHaveBeenCalledTimes(1);
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
