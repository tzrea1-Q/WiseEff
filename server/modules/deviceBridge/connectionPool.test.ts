import { describe, expect, it, vi } from "vitest";

import { createBridgeConnectionPool } from "./connectionPool";
import type { BridgeRpcRequest } from "./protocol";

type BridgeSocket = Parameters<ReturnType<typeof createBridgeConnectionPool>["register"]>[1];

type MockSocket = BridgeSocket & {
  on: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
};

function createMockSocket(): MockSocket {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const socket: MockSocket = {
    send: vi.fn((_data: unknown, callback?: (error?: Error) => void) => {
      callback?.();
    }) as BridgeSocket["send"],
    close: vi.fn() as BridgeSocket["close"],
    readyState: 1,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    }),
    emit(event: string, ...args: unknown[]) {
      for (const handler of handlers.get(event) ?? []) {
        handler(...args);
      }
    }
  };
  return socket;
}

function rpcRequest(id: string): BridgeRpcRequest {
  return {
    type: "rpc.request",
    id,
    method: "debug.detectTargets",
    params: { protocol: "adb" },
    deadlineAt: "2026-06-23T12:00:05.000Z"
  };
}

describe("bridge connection pool", () => {
  it("registers and unregisters bridge sockets", () => {
    const pool = createBridgeConnectionPool();
    const socket = createMockSocket();

    pool.register("br-1", socket);
    expect(pool.isConnected("br-1")).toBe(true);

    pool.unregister("br-1");
    expect(pool.isConnected("br-1")).toBe(false);
  });

  it("tracks lastSeenAt when ping is received", () => {
    const pool = createBridgeConnectionPool({ now: () => new Date("2026-06-23T12:00:00.000Z") });
    const socket = createMockSocket();

    pool.register("br-1", socket);
    pool.handleInboundMessage("br-1", { type: "bridge.ping" });

    expect(pool.getLastSeenAt("br-1")).toBe("2026-06-23T12:00:00.000Z");
  });

  it("rejects send when bridge is offline", async () => {
    const pool = createBridgeConnectionPool();

    await expect(pool.send("br-1", rpcRequest("req-1"))).rejects.toThrow(/not connected/i);
  });

  it("resolves rpc responses for in-flight requests", async () => {
    const pool = createBridgeConnectionPool();
    const socket = createMockSocket();
    pool.register("br-1", socket);

    const pending = pool.send("br-1", rpcRequest("req-1"));
    await Promise.resolve();
    expect(socket.send).toHaveBeenCalledTimes(1);

    pool.handleInboundMessage("br-1", {
      type: "rpc.response",
      id: "req-1",
      ok: true,
      result: { targets: [{ targetRef: "serial-1", online: true }] }
    });

    await expect(pending).resolves.toEqual({
      type: "rpc.response",
      id: "req-1",
      ok: true,
      result: { targets: [{ targetRef: "serial-1", online: true }] }
    });
  });

  it("serializes rpc sends for the same bridge", async () => {
    const pool = createBridgeConnectionPool();
    const socket = createMockSocket();
    pool.register("br-1", socket);

    const first = pool.send("br-1", rpcRequest("req-1"));
    const second = pool.send("br-1", rpcRequest("req-2"));
    await Promise.resolve();

    expect(socket.send).toHaveBeenCalledTimes(1);

    pool.handleInboundMessage("br-1", {
      type: "rpc.response",
      id: "req-1",
      ok: true,
      result: { targets: [] }
    });
    await first;
    await Promise.resolve();
    expect(socket.send).toHaveBeenCalledTimes(2);

    pool.handleInboundMessage("br-1", {
      type: "rpc.response",
      id: "req-2",
      ok: true,
      result: { targets: [] }
    });
    await second;
  });

  it("closes stale sockets when the same bridge reconnects", () => {
    const pool = createBridgeConnectionPool();
    const first = createMockSocket();
    const second = createMockSocket();

    pool.register("br-1", first);
    pool.register("br-1", second);

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(pool.isConnected("br-1")).toBe(true);

    pool.unregister("br-1", first);
    expect(pool.isConnected("br-1")).toBe(true);

    pool.unregister("br-1", second);
    expect(pool.isConnected("br-1")).toBe(false);
  });
});
