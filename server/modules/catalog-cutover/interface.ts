import type pg from "pg";

import type { CatalogReleaseSource } from "../catalog-kernel/interface";
import type { FrozenP0Graph } from "./classifier";
import type { ArchiveObjectStore } from "./archive";

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

export type CutoverPlan = {
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
  readonly graph: FrozenP0Graph;
  readonly targetArtifactSha: string;
  readonly targetCatalogReleaseDigest: string;
  readonly catalogReleaseSource?: CatalogReleaseSource;
};

export type ExecuteCutoverInput = {
  readonly pool: pg.Pool;
  readonly plan: CutoverPlan;
  readonly graph: FrozenP0Graph;
  readonly catalogReleaseSource: CatalogReleaseSource;
  readonly archiveObjectStore: ArchiveObjectStore;
  readonly archiveEncryptionKey: Buffer;
  readonly operatorAuditRef: string;
  readonly failBeforePhase?: PreActivationPhase;
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
