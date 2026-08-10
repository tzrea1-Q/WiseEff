/**
 * Shared Bridge online inference for `/dts-reload` and `/node-debugging`.
 *
 * Local health probes only describe the daemon on this machine. Rules:
 * - Matched `bridgeId`: health.connected wins (no lastSeen).
 * - `connected: false` with no match: nothing is connected locally — offline (no lastSeen).
 * - Health connected to a *different* bridge: other registered bridges may still use lastSeen
 *   (multi-bridge list on `/node-debugging`), unless `healthExclusive` is set for deploy UX.
 * - Health unavailable (`null`): lastSeen window only.
 */

/** lastSeen within this window counts as connected when health does not decide. */
export const BRIDGE_ONLINE_WINDOW_MS = 2 * 60 * 1000;

export type InferBridgeOnlineOptions = {
  /**
   * Deploy / single-selection contexts (`/dts-reload`): any successful health probe is
   * exclusive — never fall back to lastSeen. Prevents marking the selected bridge
   * "connected" from server lastSeen while the local daemon is attached elsewhere.
   */
  healthExclusive?: boolean;
  now?: number;
};

export function formatBridgeLastSeen(lastSeenAt: string | null | undefined) {
  if (!lastSeenAt) return "从未在线";
  const timestamp = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(timestamp)) return "未知";
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function lastSeenOnline(lastSeenAt: string | null | undefined, now: number) {
  if (!lastSeenAt) return false;
  const lastSeen = new Date(lastSeenAt).getTime();
  return Number.isFinite(lastSeen) && now - lastSeen <= BRIDGE_ONLINE_WINDOW_MS;
}

export function inferBridgeOnline(
  bridge: { id: string; lastSeenAt?: string | null },
  health: { connected: boolean; bridgeId?: string | null } | null,
  options: InferBridgeOnlineOptions = {}
) {
  const now = options.now ?? Date.now();

  if (options.healthExclusive) {
    if (health) {
      return Boolean(health.connected && health.bridgeId === bridge.id);
    }
    return lastSeenOnline(bridge.lastSeenAt, now);
  }

  if (health) {
    if (health.bridgeId === bridge.id) {
      return Boolean(health.connected);
    }
    // Local probe says nothing is connected — do not invent online from lastSeen.
    if (!health.connected) {
      return false;
    }
    // Local daemon is attached to a different bridge — this one may still be
    // recently online on the server registry.
  }

  return lastSeenOnline(bridge.lastSeenAt, now);
}
