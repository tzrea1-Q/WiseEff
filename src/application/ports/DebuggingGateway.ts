export type DeviceTarget = {
  id: string;
  label: string;
};

export type ReadNodeInput = {
  target?: string;
  nodePath: string;
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
  target?: string;
  nodePath: string;
  value: string;
  readBack: boolean;
};

export type NodeWriteResult = {
  ok: boolean;
  value?: string;
  verified?: boolean;
  error?: string;
  writeResult?: NodeReadResult;
  readResult?: NodeReadResult;
};

export interface DebuggingGateway {
  detectTargets(): Promise<DeviceTarget[]>;
  readNode(input: ReadNodeInput): Promise<NodeReadResult>;
  writeNode(input: WriteNodeInput): Promise<NodeWriteResult>;
}
