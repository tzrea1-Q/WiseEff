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

export interface ReloadCandidateDto {
  bindingId: string;
  projectId: string;
  propertyKey: string;
  displayName: string;
  module: string;
  /** Absolute device-tree path, or null when the binding has no resolved locator. */
  nodePath: string | null;
  /** Library baseline value, exactly as the parameter library holds it. */
  baselineValue: string | null;
  valueShapeKind: string | null;
  unit: string | null;
  constraints: Record<string, unknown>;
  debuggable: boolean;
  blockReason?: ReloadCandidateBlockReason;
}

export type ReloadRunStatus = "pending" | "blocked" | "validated";

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
  steps: PreflightStep[];
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
  createdAt: string;
  completedAt: string | null;
}
