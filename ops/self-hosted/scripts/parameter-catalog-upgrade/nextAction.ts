import {
  PRE_ACTIVATION_PHASES,
  type CutoverRunSnapshot,
  type CutoverRunState,
  type InspectCutoverInput,
  type PreActivationPhase,
  type RecoverCutoverInput,
} from "../../../../server/modules/catalog-cutover/interface";
import type { ControllerState } from "./stateMachine";

export type ConsumedInspectCutoverInput = InspectCutoverInput;
export type ConsumedRecoverCutoverInput = RecoverCutoverInput;
export type ConsumedCutoverRunSnapshot = CutoverRunSnapshot;

export const OPERATOR_NEXT_ACTIONS = Object.freeze([
  "resume",
  "forward-recovery",
  "whole-state-restore",
  "manual-stop",
] as const);

export type OperatorNextAction = (typeof OPERATOR_NEXT_ACTIONS)[number];

export const COMMIT_OUTCOMES = Object.freeze(["committed", "uncommitted", "unknown"] as const);
export type CommitOutcome = (typeof COMMIT_OUTCOMES)[number];

export const STORE_COMPLETENESS = Object.freeze(["complete", "partial", "missing"] as const);
export type StoreCompleteness = (typeof STORE_COMPLETENESS)[number];

export const RESTORE_OBSERVATIONS = Object.freeze([
  "authorized",
  "token-failure",
  "stale-boundary",
  "checksum-drift",
  "wrong-target",
  "pre-quiesce",
  "partial-store",
  "none",
] as const);
export type RestoreObservation = (typeof RESTORE_OBSERVATIONS)[number];

export const RECORDED_RECOVERY_ACTIONS = Object.freeze([
  "whole-state-restore",
  "forward-recover",
  "none",
] as const);
export type RecordedRecoveryAction = (typeof RECORDED_RECOVERY_ACTIONS)[number];

export const PHASE_FAILURE_KINDS = Object.freeze([
  "crash-known-uncommitted",
  "unknown-commit",
  "partial-store",
  "authorized-whole-state-restore",
  "forward-recover",
  "token-failure",
] as const);
export type PhaseFailureKind = (typeof PHASE_FAILURE_KINDS)[number];

export const RECOVERY_REFUSAL_CODES = Object.freeze([
  "PCAT-REC-UNKNOWN-OUTCOME",
  "PCAT-REC-PARTIAL-STORE",
  "PCAT-REC-TOKEN-FAILURE",
  "PCAT-REC-STALE-OR-DRIFT",
  "PCAT-REC-WRONG-TARGET",
  "PCAT-REC-ILLEGAL-RESUME",
] as const);
export type RecoveryRefusalCode = (typeof RECOVERY_REFUSAL_CODES)[number];

export type RecoveryObservation = {
  readonly controllerState: ControllerState;
  readonly lastFailureCode: string | null;
  readonly commitOutcome: CommitOutcome;
  readonly stores: StoreCompleteness;
  readonly restore: RestoreObservation;
  readonly recordedAction: RecordedRecoveryAction;
  readonly lastCheckpoint: PreActivationPhase | null;
  readonly cutoverState: CutoverRunState | null;
  readonly guessedOutcome: boolean;
};

export type OperatorNextActionDecision = {
  readonly action: OperatorNextAction;
  readonly autoResume: boolean;
  readonly refusalCode: RecoveryRefusalCode | null;
  readonly detail: string;
  readonly commitOutcome: CommitOutcome;
};

export type FailureMatrixRow = {
  readonly id: number;
  readonly phase: PreActivationPhase;
  readonly kind: PhaseFailureKind;
  readonly expected: OperatorNextAction;
};

export type ControllerStateMatrixRow = {
  readonly id: number;
  readonly controllerState: ControllerState;
  readonly commitOutcome: CommitOutcome;
  readonly stores: StoreCompleteness;
  readonly restore: RestoreObservation;
  readonly recordedAction: RecordedRecoveryAction;
  readonly lastCheckpoint: PreActivationPhase | null;
  readonly expected: OperatorNextAction;
};

const phaseIndex = (phase: PreActivationPhase): number => PRE_ACTIVATION_PHASES.indexOf(phase);

export const previousPhase = (phase: PreActivationPhase): PreActivationPhase | null => {
  const index = phaseIndex(phase);
  return index > 0 ? PRE_ACTIVATION_PHASES[index - 1]! : null;
};

export const checkpointHasRecoveryPoint = (checkpoint: PreActivationPhase | null): boolean =>
  checkpoint !== null && phaseIndex(checkpoint) >= phaseIndex("P3");

export const deriveCommitOutcome = (input: {
  readonly controllerState: ControllerState;
  readonly lastFailureCode: string | null;
  readonly cutoverState: CutoverRunState | null;
  readonly hasInspect: boolean;
}): CommitOutcome => {
  if (input.controllerState === "idle" || input.controllerState === "planned") {
    return "uncommitted";
  }
  if (
    input.controllerState === "cutover-completed" ||
    input.controllerState === "verification-prepared" ||
    input.controllerState === "verification-ran"
  ) {
    return "committed";
  }
  if (
    (input.controllerState === "executing" ||
      input.controllerState === "recovery-required" ||
      input.controllerState === "failed") &&
    !input.hasInspect
  ) {
    return "unknown";
  }
  if (input.lastFailureCode === "PCAT-ORC-CRASH" && input.cutoverState === "running") {
    return "uncommitted";
  }
  if (input.cutoverState === "completed") {
    return "committed";
  }
  if (input.cutoverState === "recovery-required" || input.cutoverState === "failed") {
    return "committed";
  }
  if (input.cutoverState === "running" && input.lastFailureCode !== "PCAT-ORC-CRASH") {
    return "unknown";
  }
  if (input.cutoverState === "planned") {
    return "uncommitted";
  }
  return "unknown";
};

export const observationFromRecordedState = (input: {
  readonly controllerState: ControllerState;
  readonly lastFailureCode?: string | null;
  readonly cutoverInspect?: Pick<
    CutoverRunSnapshot,
    "state" | "currentPhase" | "checkpoints" | "runBoundToken" | "liveRun"
  > | null;
  readonly stores?: StoreCompleteness;
  readonly restore?: RestoreObservation;
  readonly recordedAction?: RecordedRecoveryAction;
  readonly guessedOutcome?: boolean;
  readonly commitOutcome?: CommitOutcome;
}): RecoveryObservation => {
  const lastCheckpoint = input.cutoverInspect?.checkpoints.at(-1)?.phase ?? null;
  const cutoverState = input.cutoverInspect?.state ?? null;
  const lastFailureCode = input.lastFailureCode ?? null;
  return {
    controllerState: input.controllerState,
    lastFailureCode,
    commitOutcome:
      input.commitOutcome ??
      deriveCommitOutcome({
        controllerState: input.controllerState,
        lastFailureCode,
        cutoverState,
        hasInspect: input.cutoverInspect != null,
      }),
    stores: input.stores ?? "missing",
    restore: input.restore ?? "none",
    recordedAction: input.recordedAction ?? "none",
    lastCheckpoint,
    cutoverState,
    guessedOutcome: input.guessedOutcome === true,
  };
};

const stop = (
  code: RecoveryRefusalCode,
  detail: string,
  commitOutcome: CommitOutcome,
): OperatorNextActionDecision => ({
  action: "manual-stop",
  autoResume: false,
  refusalCode: code,
  detail,
  commitOutcome,
});

const allow = (
  action: Exclude<OperatorNextAction, "manual-stop">,
  commitOutcome: CommitOutcome,
  detail: string,
): OperatorNextActionDecision => ({
  action,
  autoResume: action === "resume",
  refusalCode: null,
  detail,
  commitOutcome,
});

const restoreRefusalCode = (restore: RestoreObservation): RecoveryRefusalCode | null => {
  switch (restore) {
    case "token-failure":
      return "PCAT-REC-TOKEN-FAILURE";
    case "stale-boundary":
    case "checksum-drift":
    case "pre-quiesce":
      return "PCAT-REC-STALE-OR-DRIFT";
    case "wrong-target":
      return "PCAT-REC-WRONG-TARGET";
    case "partial-store":
      return "PCAT-REC-PARTIAL-STORE";
    case "authorized":
    case "none":
      return null;
    default: {
      const exhaustive: never = restore;
      return exhaustive;
    }
  }
};

export const classifyUpgradeRecovery = (
  observation: RecoveryObservation,
): OperatorNextActionDecision => {
  if (observation.guessedOutcome) {
    return stop(
      "PCAT-REC-UNKNOWN-OUTCOME",
      "Unknown commit outcome cannot be guessed or auto-resumed",
      "unknown",
    );
  }
  if (observation.commitOutcome === "unknown") {
    return stop(
      "PCAT-REC-UNKNOWN-OUTCOME",
      "Unknown commit outcome cannot auto-resume; inspect or stop",
      "unknown",
    );
  }
  if (observation.stores === "partial") {
    return stop(
      "PCAT-REC-PARTIAL-STORE",
      "Partial cross-store outcome cannot auto-resume or restore",
      observation.commitOutcome,
    );
  }
  const restoreCode = restoreRefusalCode(observation.restore);
  if (restoreCode) {
    return stop(
      restoreCode,
      `Recovery point observation ${observation.restore} cannot auto-resume or restore`,
      observation.commitOutcome,
    );
  }

  switch (observation.controllerState) {
    case "idle":
    case "cutover-completed":
    case "verification-prepared":
    case "verification-ran":
      return stop(
        "PCAT-REC-ILLEGAL-RESUME",
        `Controller state ${observation.controllerState} is not an auto-resume recovery; P12-P15 stay unexecuted`,
        observation.commitOutcome,
      );
    case "planned":
      return allow("resume", observation.commitOutcome, "Same-run execute is the legal next action");
    case "executing":
      if (observation.commitOutcome === "uncommitted") {
        return allow(
          "resume",
          "uncommitted",
          "Inspect proved the last checkpoint; resume the same journal run",
        );
      }
      return stop(
        "PCAT-REC-UNKNOWN-OUTCOME",
        "Executing without a proved uncommitted crash cannot auto-resume",
        observation.commitOutcome,
      );
    case "recovery-required":
    case "failed": {
      if (observation.restore !== "authorized") {
        return stop(
          "PCAT-REC-TOKEN-FAILURE",
          "recovery-required/failed cannot restore without an authorized three-store token",
          observation.commitOutcome,
        );
      }
      if (!checkpointHasRecoveryPoint(observation.lastCheckpoint)) {
        return stop(
          "PCAT-REC-TOKEN-FAILURE",
          "P3 recovery point is missing; whole-state restore is not legal",
          observation.commitOutcome,
        );
      }
      if (observation.recordedAction === "forward-recover") {
        return allow(
          "forward-recovery",
          observation.commitOutcome,
          "Recorded forward-recover is the only legal next action",
        );
      }
      if (
        observation.recordedAction === "whole-state-restore" ||
        observation.recordedAction === "none"
      ) {
        return allow(
          "whole-state-restore",
          observation.commitOutcome,
          "Authorized three-store restore token selects whole-state-restore",
        );
      }
      return stop(
        "PCAT-REC-ILLEGAL-RESUME",
        "recovery-required/failed cannot auto-resume",
        observation.commitOutcome,
      );
    }
    default: {
      const exhaustive: never = observation.controllerState;
      return exhaustive;
    }
  }
};

export const expectedActionForPhaseFailure = (
  phase: PreActivationPhase,
  kind: PhaseFailureKind,
): OperatorNextAction => {
  switch (kind) {
    case "crash-known-uncommitted":
      return "resume";
    case "unknown-commit":
    case "partial-store":
    case "token-failure":
      return "manual-stop";
    case "authorized-whole-state-restore":
      return checkpointHasRecoveryPoint(phase) ? "whole-state-restore" : "manual-stop";
    case "forward-recover":
      return checkpointHasRecoveryPoint(phase) ? "forward-recovery" : "manual-stop";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
};

export const observationForPhaseFailure = (
  phase: PreActivationPhase,
  kind: PhaseFailureKind,
): RecoveryObservation => {
  const lastCheckpoint = kind === "crash-known-uncommitted" ? previousPhase(phase) : phase;
  switch (kind) {
    case "crash-known-uncommitted":
      return {
        controllerState: "executing",
        lastFailureCode: "PCAT-ORC-CRASH",
        commitOutcome: "uncommitted",
        stores: "complete",
        restore: "none",
        recordedAction: "none",
        lastCheckpoint,
        cutoverState: "running",
        guessedOutcome: false,
      };
    case "unknown-commit":
      return {
        controllerState: "executing",
        lastFailureCode: null,
        commitOutcome: "unknown",
        stores: "complete",
        restore: "none",
        recordedAction: "none",
        lastCheckpoint,
        cutoverState: "running",
        guessedOutcome: false,
      };
    case "partial-store":
      return {
        controllerState: "recovery-required",
        lastFailureCode: null,
        commitOutcome: "committed",
        stores: "partial",
        restore: "partial-store",
        recordedAction: "whole-state-restore",
        lastCheckpoint,
        cutoverState: "recovery-required",
        guessedOutcome: false,
      };
    case "authorized-whole-state-restore":
      return {
        controllerState: "recovery-required",
        lastFailureCode: null,
        commitOutcome: "committed",
        stores: "complete",
        restore: "authorized",
        recordedAction: "whole-state-restore",
        lastCheckpoint,
        cutoverState: "recovery-required",
        guessedOutcome: false,
      };
    case "forward-recover":
      return {
        controllerState: "recovery-required",
        lastFailureCode: null,
        commitOutcome: "committed",
        stores: "complete",
        restore: "authorized",
        recordedAction: "forward-recover",
        lastCheckpoint,
        cutoverState: "recovery-required",
        guessedOutcome: false,
      };
    case "token-failure":
      return {
        controllerState: "recovery-required",
        lastFailureCode: null,
        commitOutcome: "committed",
        stores: "complete",
        restore: "token-failure",
        recordedAction: "whole-state-restore",
        lastCheckpoint,
        cutoverState: "recovery-required",
        guessedOutcome: false,
      };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
};

const freezeMatrix = <const Rows extends readonly unknown[]>(rows: Rows): Rows => {
  Object.freeze(rows);
  return rows;
};

export const FAILURE_MATRIX: readonly FailureMatrixRow[] = freezeMatrix(
  PRE_ACTIVATION_PHASES.flatMap((phase, phaseIndex) =>
    PHASE_FAILURE_KINDS.map((kind, kindIndex) =>
      Object.freeze({
        id: phaseIndex * PHASE_FAILURE_KINDS.length + kindIndex + 1,
        phase,
        kind,
        expected: expectedActionForPhaseFailure(phase, kind),
      }),
    ),
  ),
);

export const CONTROLLER_STATE_MATRIX: readonly ControllerStateMatrixRow[] = freezeMatrix([
  Object.freeze({
    id: 1,
    controllerState: "idle" as const,
    commitOutcome: "uncommitted" as const,
    stores: "missing" as const,
    restore: "none" as const,
    recordedAction: "none" as const,
    lastCheckpoint: null,
    expected: "manual-stop" as const,
  }),
  Object.freeze({
    id: 2,
    controllerState: "planned" as const,
    commitOutcome: "uncommitted" as const,
    stores: "missing" as const,
    restore: "none" as const,
    recordedAction: "none" as const,
    lastCheckpoint: null,
    expected: "resume" as const,
  }),
  Object.freeze({
    id: 3,
    controllerState: "executing" as const,
    commitOutcome: "uncommitted" as const,
    stores: "complete" as const,
    restore: "none" as const,
    recordedAction: "none" as const,
    lastCheckpoint: "P2" as const,
    expected: "resume" as const,
  }),
  Object.freeze({
    id: 4,
    controllerState: "executing" as const,
    commitOutcome: "unknown" as const,
    stores: "complete" as const,
    restore: "none" as const,
    recordedAction: "none" as const,
    lastCheckpoint: "P6" as const,
    expected: "manual-stop" as const,
  }),
  Object.freeze({
    id: 5,
    controllerState: "cutover-completed" as const,
    commitOutcome: "committed" as const,
    stores: "complete" as const,
    restore: "none" as const,
    recordedAction: "none" as const,
    lastCheckpoint: "P10" as const,
    expected: "manual-stop" as const,
  }),
  Object.freeze({
    id: 6,
    controllerState: "verification-prepared" as const,
    commitOutcome: "committed" as const,
    stores: "complete" as const,
    restore: "none" as const,
    recordedAction: "none" as const,
    lastCheckpoint: "P10" as const,
    expected: "manual-stop" as const,
  }),
  Object.freeze({
    id: 7,
    controllerState: "verification-ran" as const,
    commitOutcome: "committed" as const,
    stores: "complete" as const,
    restore: "none" as const,
    recordedAction: "none" as const,
    lastCheckpoint: "P10" as const,
    expected: "manual-stop" as const,
  }),
  Object.freeze({
    id: 8,
    controllerState: "recovery-required" as const,
    commitOutcome: "committed" as const,
    stores: "complete" as const,
    restore: "authorized" as const,
    recordedAction: "whole-state-restore" as const,
    lastCheckpoint: "P3" as const,
    expected: "whole-state-restore" as const,
  }),
  Object.freeze({
    id: 9,
    controllerState: "recovery-required" as const,
    commitOutcome: "committed" as const,
    stores: "complete" as const,
    restore: "authorized" as const,
    recordedAction: "forward-recover" as const,
    lastCheckpoint: "P7" as const,
    expected: "forward-recovery" as const,
  }),
  Object.freeze({
    id: 10,
    controllerState: "recovery-required" as const,
    commitOutcome: "committed" as const,
    stores: "missing" as const,
    restore: "none" as const,
    recordedAction: "none" as const,
    lastCheckpoint: "P5" as const,
    expected: "manual-stop" as const,
  }),
  Object.freeze({
    id: 11,
    controllerState: "failed" as const,
    commitOutcome: "committed" as const,
    stores: "complete" as const,
    restore: "authorized" as const,
    recordedAction: "whole-state-restore" as const,
    lastCheckpoint: "P4" as const,
    expected: "whole-state-restore" as const,
  }),
  Object.freeze({
    id: 12,
    controllerState: "failed" as const,
    commitOutcome: "unknown" as const,
    stores: "complete" as const,
    restore: "authorized" as const,
    recordedAction: "whole-state-restore" as const,
    lastCheckpoint: "P8" as const,
    expected: "manual-stop" as const,
  }),
]);
