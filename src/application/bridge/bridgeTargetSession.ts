/**
 * Shared bridge / target / protocol vocabulary for `/node-debugging` and
 * `/dts-reload`. The two sessions stay separate; this module only folds the
 * overlapping selection types and the helpers that already existed inline.
 */

import type { DebugConnectionProtocol } from "@/domain/debugging/types";

export type { DebugConnectionProtocol };

export type BridgeSummary = {
  id: string;
  machineLabel: string;
  lastSeenAt?: string | null;
};

export type BridgeHealthSummary = {
  connected: boolean;
  bridgeId?: string | null;
} | null;

/** Overlapping selection fields on both sessions (and on `DeviceTarget`). */
export type BridgeTargetSelection = {
  protocol: DebugConnectionProtocol;
  bridgeId: string;
  targetRef: string;
};

export function defaultDeviceId(bridgeId: string): string {
  return `bridge:${bridgeId}`;
}

export function normalizeBridgeProtocol(
  value: string | null | undefined,
  fallback: DebugConnectionProtocol = "hdc"
): DebugConnectionProtocol {
  return value === "hdc" || value === "adb" ? value : fallback;
}

/**
 * Keep the current bridge when it is still listed; otherwise prefer the healthy
 * bridge when it is listed, else the first listed bridge.
 */
export function pickPreferredBridgeId(
  bridges: ReadonlyArray<Pick<BridgeSummary, "id">>,
  health: BridgeHealthSummary,
  currentBridgeId: string
): string {
  const preferred =
    (health?.bridgeId && bridges.some((bridge) => bridge.id === health.bridgeId)
      ? health.bridgeId
      : null) ??
    bridges[0]?.id ??
    "";
  return currentBridgeId && bridges.some((bridge) => bridge.id === currentBridgeId)
    ? currentBridgeId
    : preferred;
}

/** Map a `DeviceTarget` (or reload snapshot) onto the shared selection fields. */
export function bridgeTargetSelectionFrom(
  source: {
    protocol?: string | null;
    bridgeId?: string | null;
    targetRef?: string | null;
  },
  fallbackProtocol: DebugConnectionProtocol = "hdc"
): BridgeTargetSelection {
  return {
    protocol: normalizeBridgeProtocol(source.protocol, fallbackProtocol),
    bridgeId: source.bridgeId ?? "",
    targetRef: source.targetRef ?? ""
  };
}
