export type GatewayTarget = {
  id: string;
  deviceId: string;
  targetRef: string;
  label: string;
  online: boolean;
};

export type GatewayReadInput = {
  targetRef: string;
  nodePath: string;
};

export type GatewayWriteInput = GatewayReadInput & {
  value: string;
  readBack: boolean;
};

export type GatewayNodeResult = {
  ok: boolean;
  value?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
  durationMs: number;
};

export type GatewayWriteResult = {
  ok: boolean;
  value?: string;
  verified: boolean;
  error?: string;
  writeResult: GatewayNodeResult;
  readResult?: GatewayNodeResult;
};

export interface DebugDeviceGateway {
  detectTargets(input: { projectId: string; deviceId?: string }): Promise<{
    ok: boolean;
    targets: GatewayTarget[];
    error?: string;
  }>;
  readNode(input: GatewayReadInput): Promise<GatewayNodeResult>;
  writeNode(input: GatewayWriteInput): Promise<GatewayWriteResult>;
}
