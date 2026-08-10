/**
 * Shared Bridge online inference for `/dts-reload` and `/node-debugging`.
 * Health-probe-wins: when a probe result exists, trust it exclusively; fall back to
 * lastSeen only when health is unavailable (59c84474).
 */

/** lastSeen within this window counts as connected when health is unavailable. */
export const BRIDGE_ONLINE_WINDOW_MS = 2 * 60 * 1000;

export function formatBridgeLastSeen(lastSeenAt: string | null | undefined) {
  if (!lastSeenAt) return "从未在线";
  const timestamp = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(timestamp)) return "未知";
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

export function inferBridgeOnline(
  bridge: { id: string; lastSeenAt?: string | null },
  health: { connected: boolean; bridgeId?: string | null } | null,
  now = Date.now()
) {
  // Health probe succeeded — trust it exclusively (do not fall back to lastSeen).
  if (health) {
    return Boolean(health.connected && health.bridgeId === bridge.id);
  }
  // Health unavailable — fall back to recent lastSeen window.
  if (!bridge.lastSeenAt) {
    return false;
  }
  const lastSeen = new Date(bridge.lastSeenAt).getTime();
  return Number.isFinite(lastSeen) && now - lastSeen <= BRIDGE_ONLINE_WINDOW_MS;
}
