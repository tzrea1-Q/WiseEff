import type { RiskLevel } from "../parameters/types";

export type DeviceStatus = "未连接" | "连接中" | "已连接" | "连接失败";
export type DebugDeviceTransport = "simulator" | "hdc" | "adb" | "multi";

export type Device = {
  id: string;
  name: string;
  projectId: string;
  transport?: DebugDeviceTransport;
  firmware: string;
  status: DeviceStatus;
  lastSeen: string;
};

export type DebugParameterAccessMode = "RO" | "WO" | "RW";
export type DebugConnectionProtocol = "hdc" | "adb";
export type DebugParameterBindingStatus = "configured" | "missing" | "disabled";

export type DebugParameterNodeBinding = {
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugParameterAccessMode;
  enabled: boolean;
  isSmokeDefault?: boolean;
  notes?: string;
};

export type DebugParameter = {
  id: string;
  projectId?: string | null;
  name: string;
  key: string;
  description: string;
  module: string;
  currentValue: string;
  targetValue: string;
  unit: string;
  range: string;
  risk: RiskLevel;
  status: "已同步" | "待下发" | "下发成功";
  nodePath: string;
  accessMode: DebugParameterAccessMode;
  selectedProtocol?: DebugConnectionProtocol;
  bindingStatus?: DebugParameterBindingStatus;
  bindingDisabledReason?: string;
  bindings?: DebugParameterNodeBinding[];
};

export type DebugSnapshotEntry = {
  parameterId: string;
  previousValue: string;
  nextValue: string;
};

export type DebugSnapshot = {
  id: string;
  createdAt: string;
  entries: DebugSnapshotEntry[];
  risk: RiskLevel;
};

export type DebugEvent =
  | { kind: "connect"; deviceId: string; at: string }
  | { kind: "disconnect"; deviceId: string; at: string }
  | { kind: "push"; snapshotId: string; parameterIds: string[]; at: string; risk: RiskLevel }
  | { kind: "rollback"; snapshotId: string; parameterIds: string[]; at: string }
  | { kind: "rollback-undo"; snapshotId: string; at: string };
