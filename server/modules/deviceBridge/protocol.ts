export const BRIDGE_RPC_METHODS = [
  "bridge.getCapabilities",
  "debug.detectTargets",
  "debug.readNode",
  "debug.writeNode"
] as const;

export type BridgeRpcMethod = (typeof BRIDGE_RPC_METHODS)[number];

export type BridgeHelloMessage = {
  type: "bridge.hello";
  bridgeId: string;
  serverTime: string;
  heartbeatIntervalMs: number;
};

export type BridgePingMessage = {
  type: "bridge.ping";
  sentAt?: string;
};

export type BridgePongMessage = {
  type: "bridge.pong";
  serverTime: string;
};

export type BridgeRpcRequest = {
  type: "rpc.request";
  id: string;
  method: BridgeRpcMethod;
  params: Record<string, unknown>;
  deadlineAt: string;
};

export type BridgeRpcError = {
  code: string;
  message: string;
};

export type BridgeRpcResponse = {
  type: "rpc.response";
  id: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: BridgeRpcError;
};

export type BridgeInboundMessage = BridgePingMessage | BridgeRpcResponse;

export type BridgeOutboundMessage = BridgeHelloMessage | BridgePongMessage | BridgeRpcRequest;

export const DEFAULT_BRIDGE_HEARTBEAT_INTERVAL_MS = 15_000;

export function isBridgePingMessage(value: unknown): value is BridgePingMessage {
  return typeof value === "object" && value !== null && (value as BridgePingMessage).type === "bridge.ping";
}

export function isBridgeRpcResponse(value: unknown): value is BridgeRpcResponse {
  return typeof value === "object" && value !== null && (value as BridgeRpcResponse).type === "rpc.response";
}

export function parseBridgeInboundMessage(raw: string): BridgeInboundMessage | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isBridgePingMessage(parsed) || isBridgeRpcResponse(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
