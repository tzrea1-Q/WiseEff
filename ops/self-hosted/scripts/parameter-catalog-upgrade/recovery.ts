import type {
  CutoverRunSnapshot,
  InspectCutoverInput,
  RecoverCutoverInput,
} from "../../../../server/modules/catalog-cutover/interface";
import {
  isForbiddenComposeAppPostgres,
  restoreCheck,
  type RecoveryPointCapture,
  type RecoveryPointResult,
  type RestoreCheckSuccess,
  type RestoreCheckTargets,
  type StoreSnapshotPort,
} from "../../storage/recoveryPoint";
import type { CutoverPorts, VerificationPorts } from "./actions";
import {
  openCatalogUpgradeController,
  type ControllerDeps,
  type ControllerSnapshot,
} from "./controller";
import {
  classifyUpgradeRecovery,
  observationFromRecordedState,
  type OperatorNextAction,
  type OperatorNextActionDecision,
  type RecordedRecoveryAction,
  type RecoveryRefusalCode,
  type RestoreObservation,
  type StoreCompleteness,
} from "./nextAction";

const freezeMatrix = <const Rows extends readonly unknown[]>(rows: Rows): Rows => {
  Object.freeze(rows);
  return rows;
};

export const THREAT_MATRIX = freezeMatrix([
  {
    id: 1,
    name: "unknown-commit-cannot-auto-resume",
    attack: "guess or auto-resume when inspect cannot prove committed versus uncommitted",
    expected: "typed manual-stop; controller resume is not dispatched",
    evidenceOwner: "L",
  },
  {
    id: 2,
    name: "partial-cross-store-cannot-restore",
    attack:
      "resume or restore with PostgreSQL without object-store, object-store without Redis, or any missing store",
    expected: "typed manual-stop; no auto-resume; restore token is unused",
    evidenceOwner: "L+PG",
  },
  {
    id: 3,
    name: "crash-inspect-then-resume",
    attack: "crash during execute, inspect the same journal, then take the classified next action",
    expected: "resume of the same run identity after inspect proves the last checkpoint",
    evidenceOwner: "L",
  },
  {
    id: 4,
    name: "recovery-required-whole-state-restore",
    attack:
      "recovery-required with a verified three-store recovery point and the run-bound restore token",
    expected: "whole-state-restore; resume remains illegal",
    evidenceOwner: "L+PG",
  },
  {
    id: 5,
    name: "forward-recovery-when-restore-unsafe",
    attack: "recovery-required with recordedAction forward-recover after an unsafe mutation boundary",
    expected: "forward-recovery; no auto-resume; no partial restore",
    evidenceOwner: "L",
  },
  {
    id: 6,
    name: "stale-token-or-wrong-target-manual-stop",
    attack:
      "stale recovery point, checksum drift, wrong-target identity, compose 5432/wiseeff restore, or a token minted for another run",
    expected: "manual-stop; stores are not mutated",
    evidenceOwner: "L+PG",
  },
  {
    id: 7,
    name: "consume-frozen-inspect-recover-resume-ports",
    attack:
      "scan production sources for reimplemented plan/execute/prepare/run or inspectCutover/recoverCutover",
    expected:
      "ports consume S11-UPG inspect/recover/resume, S7-ORC inspect/recover types, and S11-RP restore tokens; those functions are not reimplemented",
    evidenceOwner: "L",
  },
  {
    id: 8,
    name: "verification-ran-activation-manual-stop",
    attack: "auto-resume or auto-activate after verification-ran, including P12-P15",
    expected: "manual-stop; P12-P15 stay unexecuted",
    evidenceOwner: "L",
  },
] as const);

export type ThreatMatrixRow = (typeof THREAT_MATRIX)[number];
export type ThreatMatrixId = ThreatMatrixRow["id"];

export type ConsumedS11RpRestoreCheckSuccess = RestoreCheckSuccess;
export type ConsumedS11RpRecoveryPointCapture = RecoveryPointCapture;
export type ConsumedS7OrcInspectInput = InspectCutoverInput;
export type ConsumedS7OrcRecoverInput = RecoverCutoverInput;

export type RecoveryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: RecoveryRefusalCode; readonly detail: string } };

export type InspectedUpgradeRecovery = {
  readonly snapshot: ControllerSnapshot;
  readonly cutover: CutoverRunSnapshot | null;
  readonly decision: OperatorNextActionDecision;
};

export type AppliedUpgradeRecovery = {
  readonly snapshot: ControllerSnapshot;
  readonly decision: OperatorNextActionDecision;
  readonly dispatched: boolean;
};

export type UpgradeRecoveryDeps = ControllerDeps;

const fail = (code: RecoveryRefusalCode, detail: string): RecoveryResult<never> => ({
  ok: false,
  error: { code, detail },
});

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const recordedActionFrom = (value: unknown): RecordedRecoveryAction => {
  const record = asRecord(value);
  const action = record?.recordedAction;
  if (action === "forward-recover" || action === "whole-state-restore") {
    return action;
  }
  return "none";
};

export const observeRestoreCheck = async (input: {
  readonly capture: RecoveryPointCapture;
  readonly restoreTargets: RestoreCheckTargets;
  readonly stores: readonly StoreSnapshotPort[];
  readonly now?: () => Date;
}): Promise<{ readonly stores: StoreCompleteness; readonly restore: RestoreObservation }> => {
  const kinds = new Set(input.stores.map((store) => store.kind));
  if (input.stores.length !== 3 || kinds.size !== 3) {
    return { stores: "partial", restore: "partial-store" };
  }
  if (
    input.restoreTargets.restoreDatabaseUrl &&
    isForbiddenComposeAppPostgres(input.restoreTargets.restoreDatabaseUrl)
  ) {
    return { stores: "complete", restore: "wrong-target" };
  }
  const checked: RecoveryPointResult<RestoreCheckSuccess> = await restoreCheck({
    manifest: input.capture.manifest,
    restoreToken: input.capture.restoreToken,
    restoreTargets: input.restoreTargets,
    stores: input.stores,
    now: input.now,
  });
  if (!checked.ok) {
    return { stores: "complete", restore: checked.error.kind };
  }
  return { stores: "complete", restore: "authorized" };
};

const inspectCutoverSnapshot = async (
  deps: UpgradeRecoveryDeps,
  snapshot: ControllerSnapshot,
): Promise<CutoverRunSnapshot | null> => {
  if (!snapshot.planDigest && !snapshot.cutoverRunId) {
    return null;
  }
  const inspected = await deps.cutover.inspect({
    runId: snapshot.cutoverRunId ?? undefined,
    planDigest: snapshot.planDigest ?? undefined,
  } as InspectCutoverInput);
  if (!inspected.ok) {
    return null;
  }
  return inspected.value;
};

export const inspectUpgradeRecovery = async (
  deps: UpgradeRecoveryDeps,
  options: {
    readonly stores?: StoreCompleteness;
    readonly restore?: RestoreObservation;
    readonly recordedAction?: RecordedRecoveryAction;
    readonly recoverInput?: unknown;
    readonly guessedOutcome?: boolean;
  } = {},
): Promise<RecoveryResult<InspectedUpgradeRecovery>> => {
  const opened = openCatalogUpgradeController(deps);
  if (!opened.ok) {
    return fail("PCAT-REC-UNKNOWN-OUTCOME", opened.error.detail);
  }
  const inspected = await opened.value.dispatch({ action: "inspect" });
  if (!inspected.ok) {
    return fail("PCAT-REC-UNKNOWN-OUTCOME", inspected.error.detail);
  }
  const cutover = await inspectCutoverSnapshot(deps, inspected.value);
  const decision = classifyUpgradeRecovery(
    observationFromRecordedState({
      controllerState: inspected.value.state,
      lastFailureCode: inspected.value.lastFailureCode,
      cutoverInspect: cutover,
      stores: options.stores,
      restore: options.restore,
      recordedAction: options.recordedAction ?? recordedActionFrom(options.recoverInput),
      guessedOutcome: options.guessedOutcome,
    }),
  );
  return { ok: true, value: { snapshot: inspected.value, cutover, decision } };
};

export const applyUpgradeRecovery = async (
  deps: UpgradeRecoveryDeps,
  options: {
    readonly stores?: StoreCompleteness;
    readonly restore?: RestoreObservation;
    readonly recordedAction?: RecordedRecoveryAction;
    readonly recoverInput?: unknown;
    readonly executeInput?: unknown;
    readonly guessedOutcome?: boolean;
    readonly requested?: OperatorNextAction;
  } = {},
): Promise<RecoveryResult<AppliedUpgradeRecovery>> => {
  const inspected = await inspectUpgradeRecovery(deps, options);
  if (!inspected.ok) {
    return inspected;
  }
  const { snapshot, decision } = inspected.value;
  if (options.requested && options.requested !== decision.action) {
    return fail(
      options.requested === "resume" ? "PCAT-REC-ILLEGAL-RESUME" : "PCAT-REC-UNKNOWN-OUTCOME",
      `requested ${options.requested} is not the classified next action ${decision.action}`,
    );
  }
  if (decision.action === "manual-stop") {
    return { ok: true, value: { snapshot, decision, dispatched: false } };
  }

  const opened = openCatalogUpgradeController(deps);
  if (!opened.ok) {
    return fail("PCAT-REC-UNKNOWN-OUTCOME", opened.error.detail);
  }

  if (decision.action === "resume") {
    const resumed = await opened.value.dispatch({
      action: "resume",
      input: options.executeInput,
    });
    if (!resumed.ok) {
      return fail("PCAT-REC-ILLEGAL-RESUME", resumed.error.detail);
    }
    return { ok: true, value: { snapshot: resumed.value, decision, dispatched: true } };
  }

  const recordedAction =
    decision.action === "forward-recovery" ? "forward-recover" : "whole-state-restore";
  const recoverRecord = asRecord(options.recoverInput) ?? {};
  const recovered = await opened.value.dispatch({
    action: "recover",
    input: {
      ...recoverRecord,
      runId: typeof recoverRecord.runId === "string" ? recoverRecord.runId : snapshot.cutoverRunId,
      recordedAction,
    },
  });
  if (!recovered.ok) {
    return fail("PCAT-REC-UNKNOWN-OUTCOME", recovered.error.detail);
  }
  return { ok: true, value: { snapshot: recovered.value, decision, dispatched: true } };
};

export type ConsumedCutoverPorts = CutoverPorts;
export type ConsumedVerificationPorts = VerificationPorts;
