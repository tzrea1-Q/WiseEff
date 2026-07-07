import type {
  DebugConnectionProtocol,
  DebugDeviceTransport,
  Device,
  DeviceStatus,
  DebugParameter,
  DebugParameterAccessMode,
  DebugParameterNodeBinding
} from "@/domain/debugging/types";
import { resolveDebugValueMetadata } from "@/debugValueKind";
import type {
  DebugNormalizationMode,
  DebugValueFormat,
  DebugValueKind
} from "@/debugValueKind";
import type {
  DebugSnapshotSummary,
  DeviceTarget,
  NodeOperationSnapshot,
  NodeReadResult,
  NodeWriteResult
} from "@/application/ports/DebuggingGateway";

export type DebugDeviceDto = {
  id: string;
  name: string;
  transport?: DebugDeviceTransport;
  firmware: string;
  status: "online" | "offline" | "unknown";
  lastSeenAt: string | null;
};

export type DebugTargetDto = {
  id: string;
  deviceId: string;
  bridgeId?: string | null;
  bridge_id?: string | null;
  bridgeMachineLabel?: string | null;
  bridge_machine_label?: string | null;
  protocol?: DebugConnectionProtocol;
  label: string;
  targetRef: string;
  status: "detected" | "lost";
};

export type DebugParameterNodeBindingDto = {
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugParameterAccessMode;
  enabled: boolean;
  isSmokeDefault?: boolean;
  notes?: string | null;
  disabledReason?: string | null;
};

export type DebugParameterDto = {
  id: string;
  name: string;
  key: string;
  description: string;
  module: string;
  nodePath?: string;
  accessMode?: "RO" | "WO" | "RW";
  unit: string;
  range: string;
  minValue?: number | null;
  maxValue?: number | null;
  risk: "Low" | "Medium" | "High";
  currentValue: string;
  targetValue: string;
  sortOrder?: number;
  enabled?: boolean;
  archivedAt?: string | null;
  archivedBy?: string | null;
  archiveReason?: string | null;
  selectedBinding?: DebugParameterNodeBindingDto | null;
  bindings?: DebugParameterNodeBindingDto[];
  valueKind?: DebugValueKind;
  valueFormat?: DebugValueFormat;
  normalizationMode?: DebugNormalizationMode;
  maxValueBytes?: number | null;
};

export type NodeOperationDto = {
  id: string;
  sessionId: string;
  parameterId: string | null;
  protocol?: DebugConnectionProtocol;
  nodePath: string;
  operationType: "detect" | "read" | "write" | "reload" | "rollback";
  status: "pending" | "succeeded" | "failed" | "readback_mismatch";
  requestedValue: string | null;
  previousValue: string | null;
  readValue: string | null;
  readbackValue: string | null;
  verified: boolean;
  failureReason: string | null;
  durationMs: number;
  snapshotId: string | null;
  createdAt: string;
  valueKind?: DebugValueKind | null;
  valueFormat?: DebugValueFormat | null;
  normalizationMode?: DebugNormalizationMode | null;
  requestedValueDigest?: string | null;
  previousValueDigest?: string | null;
  readbackValueDigest?: string | null;
  valuePreview?: string | null;
};

export type DebugSnapshotDto = {
  id: string;
  sessionId: string;
  status: "valid" | "rollback_pending" | "consumed" | "invalid";
  risk: "Low" | "Medium" | "High";
  createdAt: string;
};

const deviceStatusLabels: Record<DebugDeviceDto["status"], DeviceStatus> = {
  online: "已连接",
  offline: "未连接",
  unknown: "连接中"
};

export function debugDeviceFromDto(dto: DebugDeviceDto): Device {
  return {
    id: dto.id,
    name: dto.name,
    transport: dto.transport,
    firmware: dto.firmware,
    status: deviceStatusLabels[dto.status],
    lastSeen: dto.lastSeenAt ?? "-"
  };
}

export function debugParameterFromDto(dto: DebugParameterDto): DebugParameter {
  const bindings = dto.bindings?.map(debugParameterBindingFromDto);
  const selectedBinding = dto.selectedBinding;
  const hasSelectedBinding = "selectedBinding" in dto;
  const selectedBindingEnabled = selectedBinding?.enabled === true;
  const nodePath = hasSelectedBinding
    ? selectedBindingEnabled
      ? selectedBinding.nodePath
      : ""
    : dto.nodePath ?? "";
  const accessMode = hasSelectedBinding
    ? selectedBindingEnabled
      ? selectedBinding.accessMode
      : "RO"
    : dto.accessMode ?? "RO";
  const bindingStatus = hasSelectedBinding
    ? selectedBinding?.enabled
      ? "configured"
      : selectedBinding
        ? "disabled"
        : "missing"
    : undefined;
  const bindingDisabledReason = selectedBinding && !selectedBinding.enabled
    ? selectedBinding.disabledReason ?? selectedBinding.notes ?? undefined
    : undefined;
  const valueMetadata = resolveDebugValueMetadata(dto);

  return {
    id: dto.id,
    name: dto.name,
    key: dto.key,
    description: dto.description,
    module: dto.module,
    currentValue: dto.currentValue,
    targetValue: dto.targetValue,
    unit: dto.unit,
    range: dto.range,
    minValue: dto.minValue,
    maxValue: dto.maxValue,
    risk: dto.risk,
    status: "已同步",
    nodePath,
    accessMode,
    sortOrder: dto.sortOrder,
    enabled: dto.enabled,
    archivedAt: dto.archivedAt,
    archivedBy: dto.archivedBy,
    archiveReason: dto.archiveReason,
    selectedProtocol: selectedBinding?.protocol,
    bindingStatus,
    bindingDisabledReason,
    bindings,
    valueKind: valueMetadata.valueKind,
    valueFormat: valueMetadata.valueFormat,
    normalizationMode: valueMetadata.normalizationMode,
    maxValueBytes: valueMetadata.maxValueBytes ?? null
  };
}

function debugParameterBindingFromDto(dto: DebugParameterNodeBindingDto): DebugParameterNodeBinding {
  return {
    protocol: dto.protocol,
    nodePath: dto.nodePath,
    accessMode: dto.accessMode,
    enabled: dto.enabled,
    isSmokeDefault: dto.isSmokeDefault,
    notes: dto.notes ?? undefined
  };
}

export function debugTargetFromDto(dto: DebugTargetDto): DeviceTarget {
  const bridgeId = dto.bridgeId ?? dto.bridge_id ?? undefined;
  const bridgeMachineLabel = dto.bridgeMachineLabel ?? dto.bridge_machine_label ?? undefined;
  return {
    id: dto.id,
    deviceId: dto.deviceId,
    bridgeId: bridgeId ?? undefined,
    bridgeMachineLabel: bridgeMachineLabel ?? undefined,
    protocol: dto.protocol,
    label: dto.label,
    targetRef: dto.targetRef,
    status: dto.status
  };
}

export function nodeOperationFromDto(dto: NodeOperationDto): NodeOperationSnapshot {
  return {
    id: dto.id,
    sessionId: dto.sessionId,
    parameterId: dto.parameterId ?? undefined,
    protocol: dto.protocol,
    nodePath: dto.nodePath,
    operationType: dto.operationType,
    status: dto.status,
    requestedValue: dto.requestedValue ?? undefined,
    previousValue: dto.previousValue ?? undefined,
    readValue: dto.readValue ?? undefined,
    readbackValue: dto.readbackValue ?? undefined,
    verified: dto.verified,
    failureReason: dto.failureReason ?? undefined,
    durationMs: dto.durationMs,
    snapshotId: dto.snapshotId ?? undefined,
    createdAt: dto.createdAt,
    valueKind: dto.valueKind ?? undefined,
    valueFormat: dto.valueFormat ?? undefined,
    normalizationMode: dto.normalizationMode ?? undefined,
    requestedValueDigest: dto.requestedValueDigest ?? undefined,
    previousValueDigest: dto.previousValueDigest ?? undefined,
    readbackValueDigest: dto.readbackValueDigest ?? undefined,
    valuePreview: dto.valuePreview ?? undefined
  };
}

export function nodeReadResultFromDto(dto: NodeOperationDto): NodeReadResult {
  return {
    ok: dto.status === "succeeded",
    value: dto.readValue ?? undefined,
    stdout: undefined,
    stderr: undefined,
    error: dto.failureReason ?? undefined,
    durationMs: dto.durationMs
  };
}

export function debugSnapshotFromDto(dto: DebugSnapshotDto): DebugSnapshotSummary {
  return { ...dto };
}

export function nodeWriteResultFromDto(response: { operation: NodeOperationDto; snapshot?: DebugSnapshotDto }): NodeWriteResult {
  const { operation } = response;
  const ok = operation.status === "succeeded";
  return {
    ok,
    value: operation.readbackValue ?? operation.readValue ?? operation.requestedValue ?? undefined,
    verified: operation.verified,
    error: ok ? undefined : operation.failureReason ?? "Node write failed.",
    writeResult: {
      ok: operation.status !== "failed",
      value: operation.requestedValue ?? undefined,
      error: operation.status === "failed" ? operation.failureReason ?? undefined : undefined,
      durationMs: operation.durationMs
    },
    readResult:
      operation.readbackValue || operation.readValue
        ? {
            ok: operation.status === "succeeded",
            value: operation.readbackValue ?? operation.readValue ?? undefined,
            error: operation.status === "readback_mismatch" ? operation.failureReason ?? undefined : undefined,
            durationMs: operation.durationMs
          }
        : undefined
  };
}

export type ParameterReloadTargetDto = {
  parameterDefinitionId: string;
  name: string;
  module: string;
  unit: string;
  range: string;
  risk: DebugParameter["risk"];
  currentValue: string;
  recommendedValue: string;
  binding: {
    id: string;
    protocol: DebugConnectionProtocol;
    nodePath: string;
    accessMode: DebugParameterAccessMode;
    enabled: boolean;
  } | null;
};

export type DebugRuntimeNodeDto = {
  id: string;
  name: string;
  description: string;
  writeFormatExample?: string;
  writeFormatHint?: string;
  module: string;
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugParameterAccessMode;
  enabled: boolean;
};

export function debugRuntimeNodeToDebugParameter(dto: DebugRuntimeNodeDto): DebugParameter {
  return {
    id: dto.id,
    name: dto.name,
    key: dto.id,
    description: dto.description,
    writeFormatExample: dto.writeFormatExample,
    writeFormatHint: dto.writeFormatHint,
    module: dto.module || "Device Nodes",
    currentValue: "",
    targetValue: "",
    unit: "",
    range: "",
    risk: "Medium",
    status: "已同步",
    nodePath: dto.nodePath,
    accessMode: dto.accessMode,
    selectedProtocol: dto.protocol,
    enabled: dto.enabled
  };
}

export function reloadTargetToDebugParameter(dto: ParameterReloadTargetDto): DebugParameter {
  const binding = dto.binding;
  const bindingStatus: DebugParameter["bindingStatus"] = !binding ? "missing" : binding.enabled ? "configured" : "disabled";
  const pending = binding?.enabled && dto.currentValue !== dto.recommendedValue;
  return {
    id: dto.parameterDefinitionId,
    parameterDefinitionId: dto.parameterDefinitionId,
    reloadManaged: true,
    name: dto.name,
    key: dto.parameterDefinitionId,
    description: "",
    module: dto.module,
    currentValue: dto.currentValue,
    targetValue: dto.recommendedValue,
    unit: dto.unit,
    range: dto.range,
    risk: dto.risk,
    status: !binding?.enabled ? "待下发" : pending ? "待下发" : "已同步",
    nodePath: binding?.nodePath ?? "",
    accessMode: binding?.accessMode ?? "RW",
    selectedProtocol: binding?.protocol,
    bindingStatus,
    enabled: binding?.enabled ?? false
  };
}
