import { describe, expect, it } from "vitest";

import {
  PRE_ACTIVATION_PHASES,
  UNAVAILABLE_PHASES,
} from "../../../../server/modules/catalog-cutover/interface";
import { CONTROLLER_STATES } from "./stateMachine";
import {
  CONTROLLER_STATE_MATRIX,
  FAILURE_MATRIX,
  OPERATOR_NEXT_ACTIONS,
  PHASE_FAILURE_KINDS,
  classifyUpgradeRecovery,
  expectedActionForPhaseFailure,
  observationForPhaseFailure,
  observationFromRecordedState,
  type ControllerStateMatrixRow,
  type RecoveryObservation,
} from "./nextAction";

const observationFromControllerRow = (row: ControllerStateMatrixRow): RecoveryObservation => ({
  controllerState: row.controllerState,
  lastFailureCode:
    row.controllerState === "executing" && row.commitOutcome === "uncommitted"
      ? "PCAT-ORC-CRASH"
      : null,
  commitOutcome: row.commitOutcome,
  stores: row.stores,
  restore: row.restore,
  recordedAction: row.recordedAction,
  lastCheckpoint: row.lastCheckpoint,
  cutoverState:
    row.controllerState === "executing"
      ? "running"
      : row.controllerState === "recovery-required"
        ? "recovery-required"
        : row.controllerState === "failed"
          ? "failed"
          : null,
  guessedOutcome: false,
});

describe("S11-REC operator next-action matrix", () => {
  it("freezes the four operator actions and both recorded-state matrices", () => {
    expect(Object.isFrozen(OPERATOR_NEXT_ACTIONS)).toBe(true);
    expect([...OPERATOR_NEXT_ACTIONS]).toEqual([
      "resume",
      "forward-recovery",
      "whole-state-restore",
      "manual-stop",
    ]);
    expect(Object.isFrozen(FAILURE_MATRIX)).toBe(true);
    expect(Object.isFrozen(CONTROLLER_STATE_MATRIX)).toBe(true);
    expect(FAILURE_MATRIX).toHaveLength(PRE_ACTIVATION_PHASES.length * PHASE_FAILURE_KINDS.length);
    expect(new Set(CONTROLLER_STATE_MATRIX.map((row) => row.controllerState))).toEqual(
      new Set(CONTROLLER_STATES),
    );
  });

  it("maps every controller state to exactly one operator next action", () => {
    for (const row of CONTROLLER_STATE_MATRIX) {
      const decision = classifyUpgradeRecovery(observationFromControllerRow(row));
      expect(decision.action, row.controllerState).toBe(row.expected);
      expect(decision.autoResume).toBe(decision.action === "resume");
      if (row.commitOutcome === "unknown" || row.stores === "partial") {
        expect(decision.action).toBe("manual-stop");
        expect(decision.autoResume).toBe(false);
      }
    }
  });

  it("maps failure after each pre-activation phase to one legal next action", () => {
    for (const row of FAILURE_MATRIX) {
      const decision = classifyUpgradeRecovery(observationForPhaseFailure(row.phase, row.kind));
      expect(decision.action, `${row.phase}:${row.kind}`).toBe(row.expected);
      expect(decision.action).toBe(expectedActionForPhaseFailure(row.phase, row.kind));
      expect(decision.autoResume).toBe(decision.action === "resume");
      if (row.kind === "unknown-commit" || row.kind === "partial-store" || row.kind === "token-failure") {
        expect(decision.autoResume).toBe(false);
        expect(decision.action).toBe("manual-stop");
      }
    }
  });

  it("never auto-resumes an unknown commit, partial store, or guessed outcome", () => {
    const unknown = classifyUpgradeRecovery(
      observationFromRecordedState({
        controllerState: "executing",
        commitOutcome: "unknown",
        stores: "complete",
      }),
    );
    expect(unknown.action).toBe("manual-stop");
    expect(unknown.autoResume).toBe(false);
    expect(unknown.refusalCode).toBe("PCAT-REC-UNKNOWN-OUTCOME");

    const partial = classifyUpgradeRecovery(
      observationFromRecordedState({
        controllerState: "executing",
        commitOutcome: "uncommitted",
        stores: "partial",
        restore: "partial-store",
      }),
    );
    expect(partial.action).toBe("manual-stop");
    expect(partial.autoResume).toBe(false);
    expect(partial.refusalCode).toBe("PCAT-REC-PARTIAL-STORE");

    const guessed = classifyUpgradeRecovery(
      observationFromRecordedState({
        controllerState: "planned",
        guessedOutcome: true,
        stores: "complete",
      }),
    );
    expect(guessed.action).toBe("manual-stop");
    expect(guessed.autoResume).toBe(false);
    expect(guessed.refusalCode).toBe("PCAT-REC-UNKNOWN-OUTCOME");
  });

  it("selects whole-state-restore or forward-recovery only with an authorized three-store token", () => {
    const restored = classifyUpgradeRecovery(
      observationFromRecordedState({
        controllerState: "recovery-required",
        commitOutcome: "committed",
        stores: "complete",
        restore: "authorized",
        recordedAction: "whole-state-restore",
        cutoverInspect: {
          state: "recovery-required",
          currentPhase: "P3",
          liveRun: false,
          runBoundToken: "token-1",
          checkpoints: [{ phase: "P3", checkpointDigest: "sha256:p3", payload: {}, committedAt: "t" }],
        },
      }),
    );
    expect(restored.action).toBe("whole-state-restore");
    expect(restored.autoResume).toBe(false);

    const forward = classifyUpgradeRecovery(
      observationFromRecordedState({
        controllerState: "recovery-required",
        commitOutcome: "committed",
        stores: "complete",
        restore: "authorized",
        recordedAction: "forward-recover",
        cutoverInspect: {
          state: "recovery-required",
          currentPhase: "P7",
          liveRun: false,
          runBoundToken: "token-1",
          checkpoints: [{ phase: "P7", checkpointDigest: "sha256:p7", payload: {}, committedAt: "t" }],
        },
      }),
    );
    expect(forward.action).toBe("forward-recovery");
    expect(forward.autoResume).toBe(false);
  });

  it("keeps verification-ran and activation phases on manual-stop", () => {
    const ran = classifyUpgradeRecovery(
      observationFromRecordedState({
        controllerState: "verification-ran",
        commitOutcome: "committed",
        stores: "complete",
      }),
    );
    expect(ran.action).toBe("manual-stop");
    expect(ran.autoResume).toBe(false);
    for (const phase of UNAVAILABLE_PHASES) {
      expect(OPERATOR_NEXT_ACTIONS as readonly string[]).not.toContain(phase);
    }
  });
});
