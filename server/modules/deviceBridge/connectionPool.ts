import { WebSocket } from "ws";

import type { BridgeInboundMessage, BridgeRpcRequest, BridgeRpcResponse } from "./protocol";

type BridgeSocket = Pick<WebSocket, "send" | "close" | "readyState">;

type PendingRequest = {
  resolve: (response: BridgeRpcResponse) => void;
  reject: (error: Error) => void;
};

type BridgeConnection = {
  socket: BridgeSocket;
  lastSeenAt: string | null;
};

export type BridgeConnectionPool = ReturnType<typeof createBridgeConnectionPool>;

export type BridgeConnectionPoolOptions = {
  now?: () => Date;
};

export function createBridgeConnectionPool(options: BridgeConnectionPoolOptions = {}) {
  const now = options.now ?? (() => new Date());
  const connections = new Map<string, BridgeConnection>();
  const pendingByRequestId = new Map<string, PendingRequest>();
  const bridgeLocks = new Map<string, Promise<void>>();

  function getConnection(bridgeId: string) {
    return connections.get(bridgeId);
  }

  async function withBridgeLock<T>(bridgeId: string, task: () => Promise<T>) {
    const previous = bridgeLocks.get(bridgeId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    bridgeLocks.set(bridgeId, current);

    await previous;
    try {
      return await task();
    } finally {
      release();
      if (bridgeLocks.get(bridgeId) === current) {
        bridgeLocks.delete(bridgeId);
      }
    }
  }

  function rejectPendingForBridge(bridgeId: string, error: Error) {
    for (const [requestId, pending] of pendingByRequestId.entries()) {
      if (!requestId.startsWith(`${bridgeId}:`)) {
        continue;
      }
      pending.reject(error);
      pendingByRequestId.delete(requestId);
    }
  }

  return {
    register(bridgeId: string, socket: BridgeSocket) {
      const existing = connections.get(bridgeId);
      if (existing && existing.socket !== socket) {
        try {
          existing.socket.close();
        } catch {
          // Ignore close errors from stale sockets.
        }
      }

      connections.set(bridgeId, {
        socket,
        lastSeenAt: now().toISOString()
      });
    },

    unregister(bridgeId: string, socket?: BridgeSocket) {
      const existing = connections.get(bridgeId);
      if (!existing) {
        return;
      }
      if (socket && existing.socket !== socket) {
        return;
      }

      connections.delete(bridgeId);
      rejectPendingForBridge(bridgeId, new Error("Bridge disconnected."));
    },

    isConnected(bridgeId: string) {
      return connections.has(bridgeId);
    },

    getLastSeenAt(bridgeId: string) {
      return getConnection(bridgeId)?.lastSeenAt ?? null;
    },

    touchLastSeen(bridgeId: string, seenAt = now()) {
      const connection = getConnection(bridgeId);
      if (!connection) {
        return null;
      }
      const iso = seenAt.toISOString();
      connection.lastSeenAt = iso;
      return iso;
    },

    handleInboundMessage(bridgeId: string, message: BridgeInboundMessage) {
      if (message.type === "bridge.ping") {
        this.touchLastSeen(bridgeId);
        return;
      }

      const pending = pendingByRequestId.get(`${bridgeId}:${message.id}`);
      if (!pending) {
        return;
      }

      pending.resolve(message);
      pendingByRequestId.delete(`${bridgeId}:${message.id}`);
    },

    send(bridgeId: string, request: BridgeRpcRequest) {
      return withBridgeLock(bridgeId, () => {
        const connection = getConnection(bridgeId);
        if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
          return Promise.reject(new Error(`Bridge ${bridgeId} is not connected.`));
        }

        return new Promise<BridgeRpcResponse>((resolve, reject) => {
          const pendingKey = `${bridgeId}:${request.id}`;
          pendingByRequestId.set(pendingKey, { resolve, reject });
          connection.socket.send(JSON.stringify(request), (error) => {
            if (!error) {
              return;
            }
            pendingByRequestId.delete(pendingKey);
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        });
      });
    }
  };
}
