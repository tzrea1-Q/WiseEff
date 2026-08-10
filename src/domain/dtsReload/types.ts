export type DtsReloadCandidateBlockReason =
  | "no-node-path"
  | "synthesised-anchor"
  | "unsupported-value-shape"
  | "no-baseline-value";

export type DtsReloadCandidate = {
  bindingId: string;
  projectId: string;
  propertyKey: string;
  displayName: string;
  module: string;
  nodePath: string | null;
  baselineValue: string | null;
  valueShapeKind: string | null;
  unit: string | null;
  constraints: Record<string, unknown>;
  debuggable: boolean;
  blockReason?: DtsReloadCandidateBlockReason;
};

export type DtsReloadRunStatus = "pending" | "blocked" | "validated";

export type DtsReloadRun = {
  id: string;
  projectId: string;
  configRevisionId: string | null;
  status: DtsReloadRunStatus;
  failureCode: string | null;
  targets: Array<{
    bindingId: string;
    nodePath: string;
    propertyKey: string;
    baselineValue: string | null;
    debugValue: string;
  }>;
  steps: Array<{ step: string; outcome: "passed" | "failed" | "skipped" }>;
  diagnostics: Array<{
    stage: string;
    code: string;
    message: string;
    nodePath?: string;
    propertyName?: string;
  }>;
  toolVersions: { dtc: string | null; fdtoverlay: string | null };
  overlaySource: string | null;
  overlaySourceSha256: string | null;
  artifact: { fileName: string; sha256: string; sizeBytes: number } | null;
  createdAt: string;
  completedAt: string | null;
};

export type ReloadConfigurationContract = {
  destinationDirectory: string;
  destinationFilename: string;
  triggerNodePath: string;
  triggerPayload: string;
  kernelLogCommand: string;
};

export type OrganisationReloadConfiguration = ReloadConfigurationContract & {
  scope: "organisation";
  source: "seeded-default" | "organisation";
  updatedAt: string | null;
  updatedByUserId: string | null;
};

export type DeviceReloadConfigurationOverride = ReloadConfigurationContract & {
  scope: "device";
  deviceId: string;
  deviceName: string | null;
  updatedAt: string;
  updatedByUserId: string | null;
};

export type ReloadConfigurationAdminView = {
  organisation: OrganisationReloadConfiguration;
  deviceOverrides: DeviceReloadConfigurationOverride[];
};

export const dtsReloadBlockReasonLabels: Record<DtsReloadCandidateBlockReason, string> = {
  "no-node-path": "缺少绝对节点路径，无法作为 target-path",
  "synthesised-anchor": "定位器是合成 /label 锚点，不能作为 target-path",
  "unsupported-value-shape": "当前仅支持 u32 cell 数组与字符串列表",
  "no-baseline-value": "缺少库基线值，无法对比调试值"
};

/** Closed allowlist of exact kernel log commands — must stay aligned with server validation. */
export const KERNEL_LOG_COMMAND_ALLOWLIST = [
  "dmesg",
  "dmesg -T",
  "hilog",
  "hilog -x",
  "cat /proc/kmsg"
] as const;

/** Tool families shown in admin copy; prefer KERNEL_LOG_COMMAND_ALLOWLIST for validation. */
export const KERNEL_LOG_COMMAND_ALLOWLIST_PREFIXES = ["dmesg", "hilog", "cat /proc/kmsg"] as const;
