import type { IncomingMessage, Server } from "node:http";

import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";

import type { BridgeConnectionPool } from "./connectionPool";
import {
  DEFAULT_BRIDGE_HEARTBEAT_INTERVAL_MS,
  parseBridgeInboundMessage,
  type BridgeHelloMessage,
  type BridgePongMessage
} from "./protocol";
import type { DeviceBridgeRepository } from "./repository";
import { sha256Hex } from "./token";
import { DEVICE_BRIDGE_CONNECT_SCOPE } from "./types";

export type DeviceBridgeWsHandler = ReturnType<typeof createDeviceBridgeWsHandler>;

export type DeviceBridgeWsHandlerOptions = {
  pool: BridgeConnectionPool;
  repo: Pick<DeviceBridgeRepository, "validateBridgeToken" | "touchBridgeLastSeen">;
  now?: () => Date;
  heartbeatIntervalMs?: number;
};

export function parseBridgeAuthorizationHeader(
  headers: IncomingMessage["headers"] | Record<string, string | string[] | undefined>
) {
  const raw = headers.authorization;
  const authorization = Array.isArray(raw) ? raw[0] : raw;
  if (!authorization) {
    return null;
  }

  const match = /^Bridge\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

function closeWithError(socket: WebSocket, reason: string) {
  socket.close(4401, reason);
}

export function createDeviceBridgeWsHandler(options: DeviceBridgeWsHandlerOptions) {
  const now = options.now ?? (() => new Date());
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_BRIDGE_HEARTBEAT_INTERVAL_MS;

  return {
    async handleConnection(socket: WebSocket, request: IncomingMessage) {
      const bridgeToken = parseBridgeAuthorizationHeader(request.headers);
      if (!bridgeToken) {
        closeWithError(socket, "Missing bridge authorization.");
        return;
      }

      const validated = await options.repo.validateBridgeToken({
        tokenHash: sha256Hex(bridgeToken),
        now: now()
      });

      if (!validated) {
        closeWithError(socket, "Invalid or expired bridge token.");
        return;
      }

      if (!validated.scopes.includes(DEVICE_BRIDGE_CONNECT_SCOPE)) {
        closeWithError(socket, "Bridge token missing connect scope.");
        return;
      }

      const bridgeId = validated.bridgeId;
      options.pool.register(bridgeId, socket);

      const hello: BridgeHelloMessage = {
        type: "bridge.hello",
        bridgeId,
        serverTime: now().toISOString(),
        heartbeatIntervalMs
      };
      socket.send(JSON.stringify(hello));

      socket.on("message", (raw) => {
        const payload = typeof raw === "string" ? raw : raw.toString("utf8");
        const message = parseBridgeInboundMessage(payload);
        if (!message) {
          return;
        }

        if (message.type === "bridge.ping") {
          const seenAt = now();
          options.pool.touchLastSeen(bridgeId, seenAt);
          void options.repo.touchBridgeLastSeen({ bridgeId, seenAt }).catch(() => undefined);

          const pong: BridgePongMessage = {
            type: "bridge.pong",
            serverTime: seenAt.toISOString()
          };
          socket.send(JSON.stringify(pong));
          return;
        }

        options.pool.handleInboundMessage(bridgeId, message);
      });

      socket.on("close", () => {
        options.pool.unregister(bridgeId, socket);
      });

      socket.on("error", () => {
        options.pool.unregister(bridgeId, socket);
      });
    }
  };
}

export function attachDeviceBridgeWebSocket(
  server: Server,
  options: {
    path: string;
    wsHandler: DeviceBridgeWsHandler;
  }
) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== options.path) {
      return;
    }

    wss.handleUpgrade(request, socket, head, (wsSocket) => {
      void options.wsHandler.handleConnection(wsSocket, request);
    });
  });

  return wss;
}
