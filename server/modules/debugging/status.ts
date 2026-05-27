export const debugAccessModes = ["RO", "WO", "RW"] as const;
export const debugRiskLevels = ["Low", "Medium", "High"] as const;
export const debugDeviceStatuses = ["online", "offline", "unknown"] as const;
export const debugTargetStatuses = ["detected", "lost"] as const;
export const debugSessionStatuses = ["active", "closed"] as const;
export const debugOperationTypes = ["detect", "read", "write", "rollback"] as const;
export const debugOperationStatuses = ["pending", "succeeded", "failed", "readback_mismatch"] as const;
export const debugSnapshotStatuses = ["valid", "consumed", "invalid"] as const;

export type DebugAccessMode = (typeof debugAccessModes)[number];
export type DebugRiskLevel = (typeof debugRiskLevels)[number];
export type DebugDeviceStatus = (typeof debugDeviceStatuses)[number];
export type DebugTargetStatus = (typeof debugTargetStatuses)[number];
export type DebugSessionStatus = (typeof debugSessionStatuses)[number];
export type DebugOperationType = (typeof debugOperationTypes)[number];
export type DebugOperationStatus = (typeof debugOperationStatuses)[number];
export type DebugSnapshotStatus = (typeof debugSnapshotStatuses)[number];

export function isTerminalNodeOperationStatus(status: DebugOperationStatus) {
  return status !== "pending";
}
