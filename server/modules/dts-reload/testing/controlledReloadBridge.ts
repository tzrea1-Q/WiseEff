import { randomUUID } from "node:crypto";
import { DTS_RELOAD_BRIDGE_RPC_METHODS } from "@wiseeff/device-command-core/bridgeRpcMethods";
import type { Database } from "../../../shared/database/client";
import { createBridgeConnectionPool } from "../../deviceBridge/connectionPool";
import { createBridgeRpcClient } from "../../deviceBridge/rpc";
import { createBridge } from "../../deviceBridge/repository";
import type { BridgeRpcRequest } from "../../deviceBridge/protocol";
import { SEEDED_RELOAD_CONFIGURATION } from "../configurationTypes";

/** Controlled device socket only. Real connection pool, RPC envelope, HTTP,
 * leases, preflight and canonical writers remain outside this adapter. */
export async function createControlledReloadBridge(
  db: Database,
  input: { organizationId: string; userId: string; nodePath: string }
) {
  const bridgeId = `bridge-898-${randomUUID()}`;
  const targetRef = "issue898-controlled-target";
  const methods = ["bridge.getCapabilities", "debug.detectTargets", "debug.readNode", ...DTS_RELOAD_BRIDGE_RPC_METHODS];
  await createBridge(db, {
    id: bridgeId, organizationId: input.organizationId, userId: input.userId,
    machineLabel: "Issue 898 controlled device adapter", platform: "linux", arch: "arm64",
    clientVersion: "0.0.1", capabilities: { methods }
  });
  const connectionPool = createBridgeConnectionPool();
  const rpcClient = createBridgeRpcClient({ pool: connectionPool });
  const values = new Map([[input.nodePath, "5"]]);
  const calls: Array<{ method: string; nodePath?: string }> = [];
  let nextOverlayValue = "6";
  type Socket = Parameters<typeof connectionPool.register>[1];
  const socket: Socket = {
    readyState: 1,
    close() { connectionPool.unregister(bridgeId); },
    send: ((data: unknown, callback?: (error?: Error) => void) => {
      const request = JSON.parse(String(data)) as BridgeRpcRequest;
      const nodePath = typeof request.params.nodePath === "string" ? request.params.nodePath : undefined;
      calls.push({ method: request.method, ...(nodePath ? { nodePath } : {}) });
      let result: Record<string, unknown>;
      switch (request.method) {
        case "bridge.getCapabilities": result = { methods }; break;
        case "debug.detectTargets":
          result = { ok: true, targets: [{ targetRef, label: "Controlled fixture device", online: true }] };
          break;
        case "debug.mountTarget": result = { ok: true, durationMs: 1 }; break;
        case "debug.pushFile":
          result = { ok: true, localDigest: request.params.contentSha256,
            remoteDigest: request.params.contentSha256, integrityCheck: "sha256", durationMs: 1 };
          break;
        case "debug.writeNode": {
          const value = String(request.params.value ?? "");
          if (nodePath === SEEDED_RELOAD_CONFIGURATION.triggerNodePath) values.set(input.nodePath, nextOverlayValue);
          else if (nodePath) values.set(nodePath, value);
          result = { ok: true, verified: true, value,
            writeResult: { ok: true, durationMs: 1 },
            readResult: { ok: true, value, durationMs: 1 },
            writeOutcome: "executed", readbackOutcome: "observed" };
          break;
        }
        case "debug.readNode": result = { ok: true, value: values.get(nodePath ?? "") ?? "5", durationMs: 1 }; break;
        case "debug.readKernelLog":
          result = { ok: true, text: "controlled adapter: iin_max overlay trigger observed\n", truncated: false,
            byteLength: 57, maxBytes: 262144, durationMs: 1 };
          break;
        default:
          callback?.();
          queueMicrotask(() => connectionPool.handleInboundMessage(bridgeId, {
            type: "rpc.response", id: request.id, ok: false,
            error: { code: "METHOD_NOT_FOUND", message: `Unimplemented controlled adapter method ${request.method}` }
          }));
          return;
      }
      callback?.();
      queueMicrotask(() => connectionPool.handleInboundMessage(bridgeId, {
        type: "rpc.response", id: request.id, ok: true, result
      }));
    }) as Socket["send"]
  };
  connectionPool.register(bridgeId, socket);
  return {
    bridgeId, targetRef, deviceId: `bridge:${bridgeId}`, connectionPool, rpcClient, values, calls,
    setNextOverlayValue(value: string) { nextOverlayValue = value; },
    close() { connectionPool.unregister(bridgeId); }
  };
}
