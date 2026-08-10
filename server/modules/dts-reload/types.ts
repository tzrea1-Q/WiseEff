import type { PreflightDiagnostic, PreflightStep } from "./preflight";

/**
 * Why a listed parameter cannot carry a debug value yet. The full user-facing classification of
 * not-debuggable parameters is a later ticket; these are the cases this surface must refuse.
 */
export type ReloadCandidateBlockReason =
  | "no-node-path"
  | "synthesised-anchor"
  | "unsupported-value-shape"
  | "no-baseline-value";

/** Server-computed sensitive-node match for a reload candidate (UI must not reimplement matching). */
export interface ReloadCandidateSensitiveMatchDto {
  riskTier: "high" | "critical";
  requiredCapability: string;
  ruleId: string;
  matchType: "path" | "compatible";
  pattern: string;
  requiresElevatedCapability: true;
  requiresConfirmation: boolean;
}

export interface ReloadCandidateDto {
  bindingId: string;
  projectId: string;
  propertyKey: string;
  displayName: string;
  module: string;
  /** Absolute device-tree path, or null when the binding has no resolved locator. */
  nodePath: string | null;
  /** Compatible string from the logical node revision, when available. */
  compatible: string | null;
  /** Library baseline value, exactly as the parameter library holds it. */
  baselineValue: string | null;
  valueShapeKind: string | null;
  unit: string | null;
  constraints: Record<string, unknown>;
  debuggable: boolean;
  blockReason?: ReloadCandidateBlockReason;
  /** Present when organisation sensitive-node rules match this parameter's node. */
  sensitiveMatch: ReloadCandidateSensitiveMatchDto | null;
}

/**
 * Reload run status machine (#281 preflight + #285 deploy).
 * - pending: reserved for resumable/async shaping (not used as a durable terminal today)
 * - blocked: preflight refused before any device write
 * - validated: overlay compiled and applicable; artifact downloadable; not yet deployed
 * - deploying: in-request mount/transfer/trigger in progress (survivable shape for later async)
 * - unverifiable: all deploy commands succeeded and artifact integrity held; no DT read-back
 * - failed: a deploy step failed (mount / transfer / trigger / integrity)
 */
export type ReloadRunStatus =
  | "pending"
  | "blocked"
  | "validated"
  | "deploying"
  | "unverifiable"
  | "failed";

export type IntegrityCheckStrength = "sha256" | "md5" | "byte-length";

export type DeployStepName = "mount-target" | "transfer-artifact" | "trigger-reload";

export type ReloadStepName = PreflightStep["step"] | DeployStepName;

export type ReloadStepOutcome = "passed" | "failed" | "skipped" | "pending" | "running";

export interface ReloadStep {
  step: ReloadStepName;
  outcome: ReloadStepOutcome;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  detail?: Record<string, unknown>;
}

export interface ReloadSnapshotDto {
  libraryBaselines: Array<{
    bindingId: string;
    propertyKey: string;
    nodePath: string;
    baselineValue: string | null;
  }>;
  artifactDigest: {
    sha256: string;
    onDeviceDigest: string | null;
    /** Strength actually achieved — never report byte-length as a digest match. */
    integrityCheck: IntegrityCheckStrength | null;
  } | null;
  /** Filled by #286 when kernel log capture lands; null until then. */
  kernelSignal: { command: string; excerpt: string | null } | null;
}

export interface ReloadRunTargetDto {
  bindingId: string;
  nodePath: string;
  propertyKey: string;
  baselineValue: string | null;
  debugValue: string;
}

export interface ReloadRunDto {
  id: string;
  projectId: string;
  configRevisionId: string | null;
  status: ReloadRunStatus;
  failureCode: string | null;
  targets: ReloadRunTargetDto[];
  steps: Array<PreflightStep | ReloadStep>;
  diagnostics: PreflightDiagnostic[];
  toolVersions: { dtc: string | null; fdtoverlay: string | null };
  /** Generated overlay text, read back from the object store. */
  overlaySource: string | null;
  overlaySourceSha256: string | null;
  artifact: {
    fileName: string;
    sha256: string;
    sizeBytes: number;
  } | null;
  deviceId: string | null;
  bridgeId: string | null;
  bridgeMachineLabel: string | null;
  targetRef: string | null;
  protocol: string | null;
  integrityCheck: IntegrityCheckStrength | null;
  reloadSnapshot: ReloadSnapshotDto | null;
  createdAt: string;
  completedAt: string | null;
}

/** Always required before any device deploy for a reload run. Never inject from runtime. */
export const DTS_RELOAD_CONFIRMATION_TOKEN = "confirm-dts-reload";

export const PUSH_FILE_MAX_BYTES = 1 * 1024 * 1024;

export const RELOAD_MOUNT_TIMEOUT_MS = 15_000;
export const RELOAD_PUSH_FILE_TIMEOUT_MS = 30_000;
export const RELOAD_TRIGGER_TIMEOUT_MS = 10_000;

export const DEVICE_BRIDGE_RELEASES_PATH = "/api/v1/device-bridge/releases";
