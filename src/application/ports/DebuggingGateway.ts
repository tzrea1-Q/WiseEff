import type { DebugParameter, Device } from "@/domain/debugging/types";

export type DeviceTarget = {
  target?: string;
  deviceId?: string;
};

export type ReadNodeInput = {
  target?: DeviceTarget;
  nodePath: string;
};

export type NodeReadResult = {
  ok: boolean;
  command?: string[];
  returncode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  value?: string;
  error?: string;
};

export type WriteNodeInput = {
  target?: DeviceTarget;
  nodePath: string;
  value: string;
  readBack: boolean;
};

export type NodeWriteResult = {
  ok: boolean;
  writeResult?: NodeReadResult;
  readResult?: NodeReadResult;
  value?: string;
  verified?: boolean;
  error?: string;
};

export interface DebuggingGateway {
  listDevices(projectId?: string): Promise<Device[]>;
  listDebugParameters(projectId?: string): Promise<DebugParameter[]>;
  readNode(input: ReadNodeInput): Promise<NodeReadResult>;
  writeNode(input: WriteNodeInput): Promise<NodeWriteResult>;
}
