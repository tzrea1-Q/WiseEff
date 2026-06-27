import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import { resolveProxyUrl } from "./proxyFetch";

type RpcMethod = "bridge.getCapabilities" | "debug.detectTargets" | "debug.readNode" | "debug.writeNode";

type BridgeHelloMessage = {
  type: "bridge.hello";
  bridgeId: string;
  serverTime: string;
  heartbeatIntervalMs: number;
};

type BridgePongMessage = {
  type: "bridge.pong";
  serverTime: string;
};

type BridgeRpcRequest = {
  type: "rpc.request";
  id: string;
  method: RpcMethod;
  params: Record<string, unknown>;
  deadlineAt: string;
};

type BridgeRpcResponse = {
  type: "rpc.response";
  id: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
};

export type BridgeWsClientStatus = {
  connected: boolean;
  bridgeId?: string;
  serverUrl: string;
  lastError?: string;
  updatedAt: string;
};

export type BridgeWsClient = ReturnType<typeof createBridgeWsClient>;

type CreateBridgeWsClientOptions = {
  serverUrl: string;
  bridgeToken: string;
  rpc: {
    handle: (method: RpcMethod, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
    toRpcError: (error: unknown) => { code: string; message: string };
  };
  reconnectDelayMs?: number;
  pingIntervalMs?: number;
  websocketFactory?: (url: string, options: { headers: Record<string, string> }) => WebSocket;
  now?: () => Date;
  onStatusChange?: (status: BridgeWsClientStatus) => void;
  logger?: Pick<Console, "info" | "error">;
};

function buildBridgeWsUrl(serverUrl: string) {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/v1/device-bridges/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function safeParseJson(payload: string) {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

function isBridgeHelloMessage(value: unknown): value is BridgeHelloMessage {
  return typeof value === "object" && value !== null && (value as BridgeHelloMessage).type === "bridge.hello";
}

function isBridgePongMessage(value: unknown): value is BridgePongMessage {
  return typeof value === "object" && value !== null && (value as BridgePongMessage).type === "bridge.pong";
}

function isBridgeRpcRequest(value: unknown): value is BridgeRpcRequest {
  return typeof value === "object" && value !== null && (value as BridgeRpcRequest).type === "rpc.request";
}

export function createBridgeWsClient(options: CreateBridgeWsClientOptions) {
  const reconnectDelayMs = options.reconnectDelayMs ?? 2_000;
  const fallbackPingIntervalMs = options.pingIntervalMs ?? 15_000;
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? console;
  const wsUrl = buildBridgeWsUrl(options.serverUrl);

  let proxyAgent: HttpsProxyAgent<string> | undefined;
  let proxyResolved = false;

  async function ensureProxyAgent() {
    if (proxyResolved) {
      return proxyAgent;
    }
    proxyResolved = true;
    const proxyUrl = await resolveProxyUrl();
    if (proxyUrl) {
      try {
        proxyAgent = new HttpsProxyAgent(proxyUrl);
        logger.info(`[wiseeff-bridge] websocket using proxy: ${proxyUrl}`);
      } catch {
        // If agent creation fails, continue without proxy.
      }
    }
    return proxyAgent;
  }

  const defaultWebsocketFactory = async (url: string, init: { headers: Record<string, string> }) => {
    const agent = await ensureProxyAgent();
    return new WebSocket(url, { ...init, agent });
  };
  const websocketFactory = options.websocketFactory ?? ((url, init) => defaultWebsocketFactory(url, init));

  let socket: WebSocket | null = null;
  let running = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let status: BridgeWsClientStatus = {
    connected: false,
    serverUrl: options.serverUrl,
    updatedAt: now().toISOString()
  };

  function publishStatus(next: Partial<BridgeWsClientStatus>) {
    status = {
      ...status,
      ...next,
      updatedAt: now().toISOString()
    };
    options.onStatusChange?.(status);
  }

  function clearPingTimer() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function scheduleReconnect() {
    if (!running || reconnectTimer) {
      return;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (running) {
        connect();
      }
    }, reconnectDelayMs);
  }

  function sendJson(payload: object) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(payload));
  }

  function handleHello(message: BridgeHelloMessage) {
    publishStatus({
      connected: true,
      bridgeId: message.bridgeId,
      lastError: undefined
    });
    clearPingTimer();
    const heartbeatIntervalMs = Number.isFinite(message.heartbeatIntervalMs)
      ? Math.max(1_000, message.heartbeatIntervalMs)
      : fallbackPingIntervalMs;
    pingTimer = setInterval(() => {
      sendJson({ type: "bridge.ping", sentAt: now().toISOString() });
    }, heartbeatIntervalMs);
  }

  async function handleRpcRequest(message: BridgeRpcRequest) {
    try {
      const result = await options.rpc.handle(message.method, message.params ?? {});
      const response: BridgeRpcResponse = { type: "rpc.response", id: message.id, ok: true, result };
      sendJson(response);
    } catch (error) {
      const response: BridgeRpcResponse = {
        type: "rpc.response",
        id: message.id,
        ok: false,
        error: options.rpc.toRpcError(error)
      };
      sendJson(response);
    }
  }

  function connect() {
    const nextSocket = websocketFactory(wsUrl, {
      headers: {
        Authorization: `Bridge ${options.bridgeToken}`
      }
    });
    socket = nextSocket;

    nextSocket.on("open", () => {
      logger.info(`[wiseeff-bridge] connected ${wsUrl}`);
      publishStatus({ connected: true, lastError: undefined });
    });

    nextSocket.on("message", (raw) => {
      const payload = typeof raw === "string" ? raw : raw.toString("utf8");
      const parsed = safeParseJson(payload);
      if (!parsed) {
        return;
      }

      if (isBridgeHelloMessage(parsed)) {
        handleHello(parsed);
        return;
      }
      if (isBridgePongMessage(parsed)) {
        publishStatus({ connected: true, lastError: undefined });
        return;
      }
      if (isBridgeRpcRequest(parsed)) {
        void handleRpcRequest(parsed);
      }
    });

    nextSocket.on("error", (error) => {
      publishStatus({ connected: false, lastError: error.message });
      logger.error(`[wiseeff-bridge] websocket error: ${error.message}`);
    });

    nextSocket.on("close", (code, reason) => {
      const reasonText = typeof reason === "string" ? reason : reason.toString("utf8");
      if (code === 4401 && reasonText.trim()) {
        publishStatus({ connected: false, lastError: reasonText.trim() });
      } else {
        publishStatus({ connected: false });
      }
      clearPingTimer();
      scheduleReconnect();
    });
  }

  return {
    start() {
      if (running) {
        return;
      }
      running = true;
      connect();
    },
    stop() {
      running = false;
      clearPingTimer();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket && socket.readyState <= WebSocket.OPEN) {
        socket.close();
      }
      socket = null;
      publishStatus({ connected: false });
    },
    getStatus() {
      return { ...status };
    }
  };
}
