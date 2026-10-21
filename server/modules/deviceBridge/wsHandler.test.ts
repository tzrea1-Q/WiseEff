import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { expect, it, vi } from "vitest";
import { createBridgeConnectionPool } from "./connectionPool";
import { createDeviceBridgeWsHandler } from "./wsHandler";
import { DEVICE_BRIDGE_CONNECT_SCOPE } from "./types";

it("rejects a handshake whose token was revoked after its initial authorization read", async () => {
  let release!: () => void, entered!: () => void, revoked = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const valid = { bridgeId: "br-race", scopes: [DEVICE_BRIDGE_CONNECT_SCOPE] };
  const repo = { validateBridgeToken: vi.fn().mockImplementationOnce(async () => { entered(); await held; return valid; }).mockImplementation(async () => revoked ? null : valid), touchBridgeLastSeen: vi.fn() };
  const socket = Object.assign(new EventEmitter(), { readyState: 1, send: vi.fn(), close: vi.fn() }) as unknown as WebSocket;
  const pool = createBridgeConnectionPool();
  const handler = createDeviceBridgeWsHandler({ pool, repo });
  const connection = handler.handleConnection(socket, { headers: { authorization: "Bridge wb_controlled" } } as IncomingMessage);
  await started; revoked = true; pool.disconnect("br-race"); release(); await connection;
  expect(pool.isConnected("br-race")).toBe(false);
  expect(socket.send).not.toHaveBeenCalled();
  expect(socket.close).toHaveBeenCalledWith(4401, expect.stringMatching(/revoked|expired/i));
});

it("does not expose a connecting socket to device RPCs before its final authorization check", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const valid = { bridgeId: "br-pending", scopes: [DEVICE_BRIDGE_CONNECT_SCOPE] };
  const repo = { validateBridgeToken: vi.fn().mockResolvedValueOnce(valid).mockImplementationOnce(async () => { entered(); await held; return valid; }), touchBridgeLastSeen: vi.fn() };
  const socket = Object.assign(new EventEmitter(), { readyState: 1, send: vi.fn(), close: vi.fn() }) as unknown as WebSocket;
  const pool = createBridgeConnectionPool();
  const connection = createDeviceBridgeWsHandler({ pool, repo }).handleConnection(socket, { headers: { authorization: "Bridge wb_controlled" } } as IncomingMessage);
  await started;
  try {
    expect(pool.isConnected("br-pending")).toBe(false);
    await expect(pool.send("br-pending", { type: "rpc.request", id: "blocked", method: "debug.detectTargets", params: {}, deadlineAt: new Date().toISOString() })).rejects.toThrow(/not connected/i);
  } finally { release(); await connection; pool.disconnect("br-pending"); }
});
