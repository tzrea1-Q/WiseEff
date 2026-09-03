import { describe, expect, it } from "vitest";

import { THREAT_MATRIX } from "./controller";
import {
  CONTROLLER_STATES,
  FORBIDDEN_ACTIONS,
  LEGAL_ACTIONS,
  isLegalAction,
  nextActionFor,
  resolveAction,
  transition,
} from "./stateMachine";

describe("S11-UPG state machine", () => {
  it("freezes controller states and legal actions before production transitions", () => {
    expect(Object.isFrozen(CONTROLLER_STATES)).toBe(true);
    expect(Object.isFrozen(LEGAL_ACTIONS)).toBe(true);
    expect(Object.isFrozen(FORBIDDEN_ACTIONS)).toBe(true);
    expect([...CONTROLLER_STATES]).toEqual([
      "idle",
      "planned",
      "executing",
      "cutover-completed",
      "verification-prepared",
      "verification-ran",
      "recovery-required",
      "failed",
    ]);
    expect([...LEGAL_ACTIONS]).toEqual([
      "plan",
      "execute",
      "inspect",
      "recover",
      "prepareVerification",
      "runVerification",
      "resume",
    ]);
    expect([...FORBIDDEN_ACTIONS]).toEqual([
      "selectGates",
      "migrateViaApi",
      "guessUnknownCommit",
    ]);
  });

  it("T1 allows legal plan/execute/prepare/run transitions", () => {
    expect(isLegalAction("idle", "plan")).toBe(true);
    expect(transition("idle", "plan")).toEqual({ ok: true, value: "planned" });
    expect(transition("planned", "execute")).toEqual({ ok: true, value: "executing" });
    expect(transition("executing", "execute", { executeCompleted: true })).toEqual({
      ok: true,
      value: "cutover-completed",
    });
    expect(transition("cutover-completed", "prepareVerification")).toEqual({
      ok: true,
      value: "verification-prepared",
    });
    expect(transition("verification-prepared", "runVerification")).toEqual({
      ok: true,
      value: "verification-ran",
    });
  });

  it("T2 refuses illegal actions without proposing a next state", () => {
    const refused = transition("idle", "execute");
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("PCAT-UPG-ILLEGAL-ACTION");
    expect(isLegalAction("planned", "prepareVerification")).toBe(false);
    expect(isLegalAction("verification-ran", "execute")).toBe(false);
    expect(isLegalAction("recovery-required", "resume")).toBe(false);
  });

  it("T3 maps crash resume onto inspect then same-plan execute", () => {
    expect(nextActionFor("executing", "crash")).toBe("inspect");
    expect(resolveAction("executing", "resume")).toEqual({ ok: true, value: "execute" });
    expect(transition("executing", "inspect")).toEqual({ ok: true, value: "executing" });
    expect(nextActionFor("planned")).toBe("execute");
  });

  it("T4-T5 never treat gate selection, API migrate, or unknown-commit guess as legal", () => {
    for (const state of CONTROLLER_STATES) {
      expect(isLegalAction(state, "selectGates")).toBe(false);
      expect(isLegalAction(state, "migrateViaApi")).toBe(false);
      expect(isLegalAction(state, "guessUnknownCommit")).toBe(false);
      expect(isLegalAction(state, "P12")).toBe(false);
      expect(isLegalAction(state, "P13")).toBe(false);
    }
    const guess = transition("recovery-required", "execute");
    expect(guess.ok).toBe(false);
    if (guess.ok) return;
    expect(guess.error.code).toBe("PCAT-UPG-UNKNOWN-OUTCOME");
    expect(nextActionFor("recovery-required")).toBe("none");
    expect(nextActionFor("verification-ran")).toBe("none");
  });

  it("keeps threat-matrix names aligned with the frozen controller rows", () => {
    expect(THREAT_MATRIX.map((row) => row.name)).toContain("legal-journal-transition-idempotent");
    expect(THREAT_MATRIX.map((row) => row.name)).toContain("cannot-select-verification-gates");
  });
});
