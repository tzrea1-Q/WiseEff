/**
 * Single source of truth for device-bridge RPC method names.
 * Server capability checks and bridge capability reports must both derive from this list
 * so adding a method cannot leave the advertised set stale.
 */
export const BRIDGE_RPC_METHODS = [
  "bridge.getCapabilities",
  "debug.detectTargets",
  "debug.readNode",
  "debug.writeNode",
  "debug.mountTarget",
  "debug.pushFile"
] as const;

export type BridgeRpcMethod = (typeof BRIDGE_RPC_METHODS)[number];

/** Methods required to deploy a DTS reload overlay through the local device bridge (#285). */
export const DTS_RELOAD_BRIDGE_RPC_METHODS = ["debug.mountTarget", "debug.pushFile", "debug.writeNode"] as const;

export type DtsReloadBridgeRpcMethod = (typeof DTS_RELOAD_BRIDGE_RPC_METHODS)[number];
