import type { DebugConnectionProtocol } from "@/domain/debugging/types";

export type DeviceTarget = {
  id: string;
  deviceId?: string;
  protocol?: DebugConnectionProtocol;
  label: string;
  targetRef?: string;
  status?: "detected" | "lost";
};

export type DebugDeviceSnapshot = {
  id: string;
  name: string;
  projectId: string;
  firmware: string;
  status: "online" | "offline" | "unknown";
  lastSeenAt: string | null;
};

export type DebugSessionSnapshot = {
  id: string;
  projectId: string;
  deviceId: string;
  targetId: string;
  protocol?: DebugConnectionProtocol;
  status: "active" | "closed";
  startedAt: string;
  endedAt: string | null;
};

export type DebugSnapshotSummary = {
  id: string;
  sessionId: string;
  status: "valid" | "rollback_pending" | "consumed" | "invalid";
  risk: "Low" | "Medium" | "High";
  createdAt: string;
};

export type NodeOperationSnapshot = {
  id: string;
  sessionId: string;
  parameterId?: string;
  protocol?: DebugConnectionProtocol;
  nodePath: string;
  operationType: "detect" | "read" | "write" | "rollback";
  status: "pending" | "succeeded" | "failed" | "readback_mismatch";
  requestedValue?: string;
  previousValue?: string;
  readValue?: string;
  readbackValue?: string;
  verified: boolean;
  failureReason?: string;
  durationMs: number;
  snapshotId?: string;
  createdAt: string;
};

export type DetectTargetsInput = {
  projectId?: string;
  deviceId?: string;
  protocol?: DebugConnectionProtocol;
};

export type ReadNodeInput = {
  sessionId?: string;
  target?: string;
  parameterId?: string;
  nodePath?: string;
};

export type NodeReadResult = {
  ok: boolean;
  value?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
  durationMs?: number;
};

export type WriteNodeInput = {
  sessionId?: string;
  target?: string;
  parameterId?: string;
  nodePath?: string;
  value: string;
  readBack: boolean;
  confirmationToken?: string;
  approvalId?: string;
  expectedPreviousValue?: string;
};

export type NodeWriteResult = {
  ok: boolean;
  value?: string;
  verified?: boolean;
  error?: string;
  writeResult?: NodeReadResult;
  readResult?: NodeReadResult;
};

export type RollbackSnapshotInput = {
  snapshotId: string;
  confirmationToken: string;
};

export interface DebuggingGateway {
  listDevices?(): Promise<DebugDeviceSnapshot[]>;
  listParameters?(query?: { projectId?: string; protocol?: DebugConnectionProtocol }): Promise<import("../../domain/debugging/types").DebugParameter[]>;
  detectTargets(input?: DetectTargetsInput): Promise<DeviceTarget[]>;
  createSession?(input: { projectId: string; deviceId: string; targetId: string; protocol?: DebugConnectionProtocol }): Promise<DebugSessionSnapshot>;
  getSession?(sessionId: string): Promise<DebugSessionSnapshot | null>;
  listSessionEvents?(sessionId: string): Promise<NodeOperationSnapshot[]>;
  readNode(input: ReadNodeInput): Promise<NodeReadResult>;
  writeNode(input: WriteNodeInput): Promise<NodeWriteResult>;
  rollbackSnapshot?(input: RollbackSnapshotInput): Promise<{ snapshot: DebugSnapshotSummary; operations: NodeOperationSnapshot[] }>;
}
