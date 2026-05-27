import type {
  Device,
  DeviceStatus,
  DebugParameter
} from "@/domain/debugging/types";
import type {
  DebugSnapshotSummary,
  DeviceTarget,
  NodeOperationSnapshot,
  NodeReadResult,
  NodeWriteResult
} from "@/application/ports/DebuggingGateway";

export type DebugDeviceDto = {
  id: string;
  projectId: string;
  name: string;
  firmware: string;
  status: "online" | "offline" | "unknown";
  lastSeenAt: string | null;
};

export type DebugTargetDto = {
  id: string;
  deviceId: string;
  label: string;
  targetRef: string;
  status: "detected" | "lost";
};

export type DebugParameterDto = {
  id: string;
  projectId: string;
  name: string;
  key: string;
  description: string;
  module: string;
  nodePath: string;
  accessMode: "RO" | "WO" | "RW";
  unit: string;
  range: string;
  risk: "Low" | "Medium" | "High";
  currentValue: string;
  targetValue: string;
};

export type NodeOperationDto = {
  id: string;
  sessionId: string;
  parameterId: string | null;
  nodePath: string;
  operationType: "detect" | "read" | "write" | "rollback";
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
};

export type DebugSnapshotDto = {
  id: string;
  sessionId: string;
  status: "valid" | "consumed" | "invalid";
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
    projectId: dto.projectId,
    firmware: dto.firmware,
    status: deviceStatusLabels[dto.status],
    lastSeen: dto.lastSeenAt ?? "-"
  };
}

export function debugParameterFromDto(dto: DebugParameterDto): DebugParameter {
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
    risk: dto.risk,
    status: "已同步",
    nodePath: dto.nodePath,
    accessMode: dto.accessMode
  };
}

export function debugTargetFromDto(dto: DebugTargetDto): DeviceTarget {
  return { ...dto };
}

export function nodeOperationFromDto(dto: NodeOperationDto): NodeOperationSnapshot {
  return {
    id: dto.id,
    sessionId: dto.sessionId,
    parameterId: dto.parameterId ?? undefined,
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
    createdAt: dto.createdAt
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
