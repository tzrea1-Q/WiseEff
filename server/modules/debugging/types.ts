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
import type { DebugConnectionProtocol } from "./protocol";

export type DebugDeviceRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  transport: "simulator" | "hdc" | "adb" | "multi";
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
  protocol: DebugConnectionProtocol;
  status: DebugTargetStatus;
  detectedAt: string;
};

export type DebugParameterRecord = {
  id: string;
  organizationId: string;
  projectId: string | null;
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
  enabled: boolean;
  archivedAt: string | null;
  archivedBy: string | null;
  archiveReason: string | null;
};

export type DebugParameterNodeBindingRecord = {
  id: string;
  organizationId: string;
  projectId: string | null;
  parameterId: string;
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugAccessMode;
  enabled: boolean;
  isSmokeDefault: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DebugParameterWithBindingsRecord = DebugParameterRecord & {
  selectedBinding: DebugParameterNodeBindingRecord | null;
  bindings: DebugParameterNodeBindingRecord[];
};

export type DebugSessionRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  deviceId: string;
  targetId: string;
  protocol: DebugConnectionProtocol;
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
  protocol?: DebugConnectionProtocol;
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
  protocol: DebugConnectionProtocol;
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
