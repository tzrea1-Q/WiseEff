import type {
  DebugAccessMode,
  DebugDeviceStatus,
  DebugOperationStatus,
  DebugOperationType,
  DebugRiskLevel,
  DebugSessionStatus,
  DebugSnapshotStatus,
  DebugTargetStatus
} from "./status";

export type DebugDeviceRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  transport: "simulator" | "hdc";
  status: DebugDeviceStatus;
  firmware: string;
  lastSeenAt: string | null;
};

export type DebugTargetRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  deviceId: string;
  targetRef: string;
  label: string;
  status: DebugTargetStatus;
  detectedAt: string;
};

export type DebugParameterRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  key: string;
  description: string;
  module: string;
  nodePath: string;
  accessMode: DebugAccessMode;
  unit: string;
  range: string;
  minValue: number | null;
  maxValue: number | null;
  risk: DebugRiskLevel;
  currentValue: string;
  targetValue: string;
  sortOrder: number;
};

export type DebugSessionRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  deviceId: string;
  targetId: string;
  actorUserId: string;
  status: DebugSessionStatus;
  startedAt: string;
  endedAt: string | null;
};

export type DebugDeviceLeaseRecord = {
  organizationId: string;
  projectId: string;
  deviceId: string;
  sessionId: string;
  leaseOwnerUserId: string;
  expiresAt: string;
  acquiredAt: string;
  updatedAt: string;
};

export type DebugSnapshotEntry = {
  parameterId: string;
  nodePath: string;
  previousValue: string;
  targetValue: string;
};

export type DebugSnapshotRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  sessionId: string;
  operationId: string | null;
  status: DebugSnapshotStatus;
  risk: DebugRiskLevel;
  entries: DebugSnapshotEntry[];
  createdAt: string;
};

export type NodeOperationRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  sessionId: string;
  parameterId: string | null;
  nodePath: string;
  operationType: DebugOperationType;
  status: DebugOperationStatus;
  requestedValue: string | null;
  previousValue: string | null;
  readValue: string | null;
  readbackValue: string | null;
  verified: boolean;
  failureReason: string | null;
  durationMs: number;
  approvalId: string | null;
  snapshotId: string | null;
  createdAt: string;
};
