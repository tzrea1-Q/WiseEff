import { randomUUID } from "node:crypto";

import type { BridgeConnectionPool } from "./connectionPool";
import type { BridgeRpcMethod, BridgeRpcResponse } from "./protocol";

export const DEFAULT_BRIDGE_RPC_TIMEOUT_MS = 10_000;
export const DEFAULT_BRIDGE_DETECT_TIMEOUT_MS = 5_000;

export type BridgeRpcClient = ReturnType<typeof createBridgeRpcClient>;

export type BridgeRpcClientOptions = {
  pool: Pick<BridgeConnectionPool, "send">;
  now?: () => Date | number;
  createRequestId?: () => string;
  defaultTimeoutMs?: number;
};

function readNowMs(now: () => Date | number) {
  const value = now();
  return typeof value === "number" ? value : value.getTime();
}

export function createBridgeRpcClient(options: BridgeRpcClientOptions) {
  const now = options.now ?? (() => new Date());
  const createRequestId = options.createRequestId ?? randomUUID;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_BRIDGE_RPC_TIMEOUT_MS;

  return {
    async call(
      bridgeId: string,
      method: BridgeRpcMethod,
      params: Record<string, unknown> = {},
      callOptions: { timeoutMs?: number } = {}
    ) {
      const timeoutMs = callOptions.timeoutMs ?? defaultTimeoutMs;
      const request = {
        type: "rpc.request" as const,
        id: createRequestId(),
        method,
        params,
        deadlineAt: new Date(readNowMs(now) + timeoutMs).toISOString()
      };

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = (await Promise.race([
          options.pool.send(bridgeId, request),
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(new Error(`Bridge RPC timed out after ${timeoutMs}ms`));
            }, timeoutMs);
          })
        ])) as BridgeRpcResponse;

        if (!response.ok) {
          throw new Error(response.error?.message ?? "Bridge RPC failed.");
        }

        return response.result ?? {};
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }
    }
  };
}
