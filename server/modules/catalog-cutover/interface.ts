import type pg from "pg";

import type { CatalogReleaseSource } from "../catalog-kernel/interface";
import type { FrozenP0Graph } from "./classifier";
import type { ArchiveObjectStore } from "./archive";
import type { ConversionManifest } from "./conversionManifest";
import type { BindingImportIntent } from "../parameter-bindings/cutoverImport/intent";
import type { DatabaseIdentity } from "./bindingImportProducer";

export { THREAT_MATRIX } from "./threatMatrix";
export type { ThreatMatrixRow } from "./threatMatrix";

export const MIGRATION_CONTRACT_VERSION = "s7-orc-p0-p10-v1";

export const PRE_ACTIVATION_PHASES = [
  "P0",
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
  "P8",
  "P9",
  "P10",
] as const;

export type PreActivationPhase = (typeof PRE_ACTIVATION_PHASES)[number];

export const UNAVAILABLE_PHASES = ["P11", "P12", "P13", "P14", "P15", "P16"] as const;
export type UnavailablePhase = (typeof UNAVAILABLE_PHASES)[number];

export type CutoverPhase = PreActivationPhase | UnavailablePhase;

export const CUTOVER_RUN_STATES = [
  "planned",
  "running",
  "failed",
  "completed",
  "recovery-required",
] as const;
export type CutoverRunState = (typeof CUTOVER_RUN_STATES)[number];

export const RECOVERY_ACTIONS = ["whole-state-restore", "forward-recover"] as const;
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];

export const CUTOVER_FAILURE_CODES = [
  "PCAT-ORC-UNKNOWN-PHASE",
  "PCAT-ORC-ACTIVATION-UNAVAILABLE",
  "PCAT-ORC-AD-HOC",
  "PCAT-ORC-NOT-POPULATED",
  "PCAT-ORC-INVALID-PLAN",
  "PCAT-ORC-NOT-FOUND",
  "PCAT-ORC-CRASH",
  "PCAT-ORC-ROLLBACK-DRIFT",
  "PCAT-ORC-INVALID-TOKEN",
  "PCAT-ORC-CLASSIFICATION-BLOCKED",
  "PCAT-ORC-PHASE-FAILED",
  "PCAT-ORC-RESUME-INVALIDATED",
] as const;
export type CutoverFailureCode = (typeof CUTOVER_FAILURE_CODES)[number];

export type CutoverFailure = {
  readonly code: CutoverFailureCode;
  readonly detail: string;
};

export type CutoverResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CutoverFailure };

export type ManagementPreparationPin = {
  readonly runId: string;
  readonly planDigest: string;
  readonly candidateArtifactSha: string;
  readonly candidateArtifactTree: string;
};

export type CutoverPlan = {
  readonly managementPreparation?: ManagementPreparationPin;
  readonly managementMigrationReceiptDigest?: string;
  readonly bindingImportIntentDigest?: string;
  readonly bindingArchiveRetainUntil?: string;
  readonly conversionManifestDigest?: string;
  readonly planDigest: string;
  readonly sourceSnapshotFingerprint: string;
  readonly targetArtifactSha: string;
  readonly targetCatalogReleaseDigest: string;
  readonly migrationContractVersion: string;
  readonly phases: readonly PreActivationPhase[];
};

export type CutoverCheckpoint = {
  readonly phase: PreActivationPhase;
  readonly checkpointDigest: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly committedAt: string;
};

export type CutoverRunSnapshot = {
  readonly runId: string;
  readonly planDigest: string;
  readonly currentPhase: PreActivationPhase;
  readonly state: CutoverRunState;
  readonly resumed: boolean;
  readonly liveRun: boolean;
  readonly checkpoints: readonly CutoverCheckpoint[];
  readonly runBoundToken: string | null;
  readonly recoveryPointDump: string | null;
};

export type PlanCutoverInput = {
  readonly managementPreparation?: ManagementPreparationPin;
  /** Receipt from the fixed preparation plan, generated before this S7 plan. */
  readonly managementMigrationReceiptDigest?: string;
  readonly bindingImportIntent?: BindingImportIntent;
  /** Explicit retention-owner input. No production retention period is invented by the controller. */
  readonly bindingArchiveRetainUntil?: string;
  readonly conversionManifest?: ConversionManifest;
  readonly graph: FrozenP0Graph;
  readonly targetArtifactSha: string;
  readonly targetCatalogReleaseDigest: string;
  readonly catalogReleaseSource?: CatalogReleaseSource;
};

export type ExecuteCutoverInput = {
  readonly managementMigrations?: {
    /** Root-owned: recompute the source/ledger/checkpoint receipt on the actual
     * target, and compare it with the committed existing controller journal. */
    verify(input: { receiptDigest: string; target: DatabaseIdentity; preparation: ManagementPreparationPin }): Promise<{
      receiptDigest: string; sourceSnapshotDigest: string; candidateInventoryDigest: string;
    }>;
  };
  readonly bindingImportIntent?: BindingImportIntent;
  /** Controlled management login only; never the API/worker runtime pool. */
  readonly bindingManagementPool?: pg.Pool;
  readonly bindingBoundary?: BindingCutoverBoundary;
  /** Adapter over the existing upgrade controller journal; no alternate journal store. */
  readonly bindingJournal?: BindingCutoverJournal;
  readonly conversionManifest?: ConversionManifest;
  readonly pool: pg.Pool;
  readonly plan: CutoverPlan;
  readonly graph: FrozenP0Graph;
  readonly catalogReleaseSource: CatalogReleaseSource;
  readonly archiveObjectStore: ArchiveObjectStore;
  readonly archiveEncryptionKey: Buffer;
  readonly operatorAuditRef: string;
  readonly failBeforePhase?: PreActivationPhase;
};

export type BindingBoundaryReceipt = {
  readonly runId: string;
  readonly planDigest: string;
  readonly target: DatabaseIdentity;
  readonly sourceInventoryFingerprint: string;
  readonly writeFenceReceiptDigest: string;
  readonly recoveryManifestDigest: string;
};

/** Implemented by the deployment boundary owner using real writer isolation and three-store recovery. */
export type BindingCutoverBoundary = {
  prepare(input: { runId: string; plan: CutoverPlan; target: DatabaseIdentity }): Promise<BindingBoundaryReceipt>;
  verify(receipt: BindingBoundaryReceipt): Promise<void>;
};

export type BindingPhaseAttempt = {
  readonly attemptId:string;
  readonly runId:string;
  readonly planDigest:string;
  readonly phase:PreActivationPhase;
};

/** Pending/unknown outcomes require the existing controller's explicit reconciliation. */
export type BindingCutoverJournal = {
  unresolved(target:DatabaseIdentity):Promise<readonly (BindingPhaseAttempt & {outcome:"pending" | "unknown"})[]>;
  begin(input:{target:DatabaseIdentity;runId:string;planDigest:string;phase:PreActivationPhase;inputDigest:string}):Promise<BindingPhaseAttempt>;
  finish(input:{attempt:BindingPhaseAttempt;outcome:"committed" | "failed" | "unknown"}):Promise<void>;
};

export type InspectCutoverInput = {
  readonly pool: pg.Pool;
  readonly runId?: string;
  readonly planDigest?: string;
};

export type RecoverCutoverInput = {
  readonly pool: pg.Pool;
  readonly runId: string;
  readonly recordedAction: string;
  readonly runBoundToken: string;
  readonly archiveObjectStore?: ArchiveObjectStore;
};
