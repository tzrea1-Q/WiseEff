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

export const DEBUG_VALUE_KINDS = ["scalar", "complex"] as const;
export type DebugValueKind = (typeof DEBUG_VALUE_KINDS)[number];
export const DEBUG_VALUE_KIND_SCALAR: DebugValueKind = "scalar";
export const DEBUG_VALUE_KIND_COMPLEX: DebugValueKind = "complex";

export const DEBUG_VALUE_FORMATS = ["raw", "json", "dts", "line-list", "kv-list"] as const;
export type DebugValueFormat = (typeof DEBUG_VALUE_FORMATS)[number];
export const DEBUG_VALUE_FORMAT_RAW: DebugValueFormat = "raw";
export const DEBUG_VALUE_FORMAT_JSON: DebugValueFormat = "json";
export const DEBUG_VALUE_FORMAT_DTS: DebugValueFormat = "dts";
export const DEBUG_VALUE_FORMAT_LINE_LIST: DebugValueFormat = "line-list";
export const DEBUG_VALUE_FORMAT_KV_LIST: DebugValueFormat = "kv-list";

export const DEBUG_NORMALIZATION_MODES = [
  "exact",
  "trim",
  "line-ending-normalized",
  "json-canonical"
] as const;
export type DebugNormalizationMode = (typeof DEBUG_NORMALIZATION_MODES)[number];
export const DEBUG_NORMALIZATION_MODE_EXACT: DebugNormalizationMode = "exact";
export const DEBUG_NORMALIZATION_MODE_TRIM: DebugNormalizationMode = "trim";
export const DEBUG_NORMALIZATION_MODE_LINE_ENDING_NORMALIZED: DebugNormalizationMode =
  "line-ending-normalized";
export const DEBUG_NORMALIZATION_MODE_JSON_CANONICAL: DebugNormalizationMode = "json-canonical";

export type DebugValueMetadata = {
  valueKind: DebugValueKind;
  valueFormat: DebugValueFormat;
  normalizationMode: DebugNormalizationMode;
  maxValueBytes?: number | null;
};

export type DebugValueEnvelope = {
  kind: DebugValueKind;
  format: DebugValueFormat;
  normalization: DebugNormalizationMode;
  raw: string;
  canonical?: string;
  digest: string;
  bytes: number;
  preview: string;
};

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
  valueKind: DebugValueKind;
  valueFormat: DebugValueFormat;
  normalizationMode: DebugNormalizationMode;
  maxValueBytes: number | null;
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
  valueKind?: DebugValueKind;
  valueFormat?: DebugValueFormat;
  normalizationMode?: DebugNormalizationMode;
  previousDigest?: string;
  targetDigest?: string;
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
  valueKind: DebugValueKind | null;
  valueFormat: DebugValueFormat | null;
  normalizationMode: DebugNormalizationMode | null;
  requestedValueDigest: string | null;
  previousValueDigest: string | null;
  readbackValueDigest: string | null;
  valuePreview: string | null;
};
