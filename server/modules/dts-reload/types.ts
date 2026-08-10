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
 * Reload run status machine (#281 preflight + #285 deploy + #287 behavioural verify).
 * - pending: reserved for resumable/async shaping (not used as a durable terminal today)
 * - blocked: preflight refused before any device write
 * - validated: overlay compiled and applicable; artifact downloadable; not yet deployed
 * - deploying: in-request mount/transfer/trigger in progress (survivable shape for later async)
 * - unverifiable: commands succeeded but behavioural confirmation is unavailable or incomplete
 * - verified: behaviourally verified — every bound parameter's debug-node read matched
 * - contradicted: at least one bound debug-node read disagreed with the debug value
 * - failed: a deploy step failed (mount / transfer / trigger / integrity)
 */
export type ReloadRunStatus =
  | "pending"
  | "blocked"
  | "validated"
  | "deploying"
  | "unverifiable"
  | "verified"
  | "contradicted"
  | "failed";

/**
 * Why a reload run was started.
 * - ordinary: engineer-supplied debug values
 * - restore-baseline: compensating reload whose debug values are library baselines
 *   for the same parameter set as the residue-producing run (not an undo / unload)
 */
export type ReloadRunPurpose = "ordinary" | "restore-baseline";

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

/**
 * Unjudged kernel log evidence attached to a reload snapshot (#286).
 *
 * Matching identity: each run target's `propertyKey` (DTS property / parameter name).
 * Filtering is server-side only — parameter names never enter bridge RPC params.
 *
 * captureStatus distinguishes:
 * - obtained: bridge returned non-empty raw text (matchedByParameter may still be empty)
 * - not-obtained: capture failed, threw, returned empty, or otherwise yielded no signal
 */
export type KernelSignalCaptureStatus = "obtained" | "not-obtained";

export interface KernelSignalMatchedGroup {
  /** Target propertyKey used for substring matching against log lines. */
  parameterName: string;
  bindingId: string;
  lines: string[];
}

export interface KernelSignalDto {
  command: string;
  captureStatus: KernelSignalCaptureStatus;
  /** Set when captureStatus is not-obtained; null when obtained. */
  captureError: string | null;
  /** Verbatim capture text when obtained; null when not-obtained. */
  rawText: string | null;
  truncated: boolean;
  matchedByParameter: KernelSignalMatchedGroup[];
  /**
   * Legacy stub field from pre-#286 rows (`{ command, excerpt }`). Prefer rawText.
   * When parsing legacy rows, excerpt is preserved and also mapped into rawText when present.
   */
  excerpt: string | null;
}

export type ParameterVerificationOutcome =
  | "verified"
  | "contradicted"
  | "unbound"
  | "read-failed";

export interface ParameterVerificationRecordDto {
  bindingId: string;
  propertyKey: string;
  outcome: ParameterVerificationOutcome;
  debugNodeId: string | null;
  nodePath: string | null;
  expectedValue: string;
  readValue: string | null;
  reason: string | null;
}

export interface BehaviouralVerificationDto {
  outcomes: ParameterVerificationRecordDto[];
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
  /** Kernel log evidence after a successful trigger; null when deploy never reached capture. */
  kernelSignal: KernelSignalDto | null;
  /** Per-parameter behavioural verification via debug-node read-back (#287); null when not attempted. */
  behaviouralVerification: BehaviouralVerificationDto | null;
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
  purpose: ReloadRunPurpose;
  /**
   * For restore-baseline runs: the residue source run this compensating reload targets.
   * Used to clear residue only when it still names this source (stale restores must not
   * wipe a newer ordinary reload's bookkeeping). Null for ordinary runs.
   */
  restoresSourceRunId: string | null;
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
  /**
   * Device id. For restore-baseline runs this is pinned at start and must match deploy.
   * For ordinary runs it is typically null until deploy.
   */
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

/**
 * Platform bookkeeping that a device was last left carrying debug values.
 * Derived from run history — not confirmed from the device. Invalidated by reboot,
 * reflash, or any out-of-band change made outside the platform.
 */
export interface ReloadResidueDto {
  deviceId: string;
  projectId: string;
  sourceRunId: string;
  parameters: Array<{
    bindingId: string;
    propertyKey: string;
    nodePath: string;
    baselineValue: string | null;
    debugValue: string;
  }>;
  recordedAt: string;
}

/** Always required before any device deploy for a reload run. Never inject from runtime. */
export const DTS_RELOAD_CONFIRMATION_TOKEN = "confirm-dts-reload";

export const PUSH_FILE_MAX_BYTES = 1 * 1024 * 1024;

export const RELOAD_MOUNT_TIMEOUT_MS = 15_000;
export const RELOAD_PUSH_FILE_TIMEOUT_MS = 30_000;
export const RELOAD_TRIGGER_TIMEOUT_MS = 10_000;
export const RELOAD_KERNEL_LOG_TIMEOUT_MS = 10_000;
export const RELOAD_READ_NODE_TIMEOUT_MS = 10_000;

export const DEVICE_BRIDGE_RELEASES_PATH = "/api/v1/device-bridge/releases";
