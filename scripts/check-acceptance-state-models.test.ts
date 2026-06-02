import { describe, expect, it } from "vitest";
import {
  applyDebuggingModelStep,
  applyLogTaskModelStep,
  applyParameterModelStep,
  applyPermissionModelStep,
  evaluateAcceptanceStateModels,
  formatStateModelFailure,
  initialDebuggingModelState,
  initialLogTaskModelState,
  initialParameterModelState,
  initialPermissionModelState,
  type StateModelFailure
} from "./check-acceptance-state-models";

describe("acceptance state models", () => {
  it("passes every deterministic model with default seeds", () => {
    const result = evaluateAcceptanceStateModels({ numRuns: 50 });

    expect(result.status).toBe("passed");
    expect(result.seed).toBe(20260601);
    expect(result.models.map((model) => model.name)).toEqual([
      "parameter-approval",
      "log-analysis-task",
      "debugging-session",
      "permission-visibility"
    ]);
    expect(result.models.every((model) => model.status === "passed")).toBe(true);
  });

  it("blocks duplicate terminal parameter transitions and requires audit for production writes", () => {
    const submitted = applyParameterModelStep(initialParameterModelState(), {
      type: "submit",
      actorRole: "hardware-user"
    });
    const hardwareReviewed = applyParameterModelStep(submitted, {
      type: "advance",
      actorRole: "hardware-committer"
    });
    const softwareReviewed = applyParameterModelStep(hardwareReviewed, {
      type: "advance",
      actorRole: "software-committer"
    });
    const merged = applyParameterModelStep(softwareReviewed, {
      type: "merge",
      actorRole: "software-user"
    });
    const doubleMerged = applyParameterModelStep(merged, {
      type: "merge",
      actorRole: "software-user"
    });
    const rejectedAfterMerge = applyParameterModelStep(merged, {
      type: "reject",
      actorRole: "hardware-committer"
    });

    expect(merged.status).toBe("merged");
    expect(merged.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "submit" }),
        expect.objectContaining({ action: "advance" }),
        expect.objectContaining({ action: "merge" })
      ])
    );
    expect(doubleMerged.violations).toContain("parameter terminal states cannot be transitioned again");
    expect(rejectedAfterMerge.violations).toContain("parameter terminal states cannot be transitioned again");
  });

  it("rejects invalid log task writes and audits feedback, archive, and reanalysis", () => {
    const uploaded = applyLogTaskModelStep(initialLogTaskModelState(), {
      type: "upload",
      actorRole: "hardware-user"
    });
    const archiveTooEarly = applyLogTaskModelStep(uploaded, {
      type: "archive",
      actorRole: "admin"
    });
    const analyzing = applyLogTaskModelStep(uploaded, {
      type: "startAnalysis",
      actorRole: "admin"
    });
    const complete = applyLogTaskModelStep(analyzing, {
      type: "complete",
      actorRole: "admin"
    });
    const withFeedback = applyLogTaskModelStep(complete, {
      type: "feedback",
      actorRole: "software-user"
    });
    const archived = applyLogTaskModelStep(withFeedback, {
      type: "archive",
      actorRole: "admin"
    });
    const reanalyzed = applyLogTaskModelStep(archived, {
      type: "reanalyze",
      actorRole: "admin"
    });

    expect(archiveTooEarly.violations).toContain("log archive requires a terminal result");
    expect(reanalyzed.auditEvents.map((event) => event.action)).toEqual(
      expect.arrayContaining(["upload", "startAnalysis", "complete", "feedback", "archive", "reanalyze"])
    );
  });

  it("requires debugging writers and a valid snapshot before rollback", () => {
    const detected = applyDebuggingModelStep(initialDebuggingModelState(), {
      type: "detect",
      actorRole: "hardware-user"
    });
    const read = applyDebuggingModelStep(detected, {
      type: "read",
      actorRole: "hardware-user"
    });
    const unauthorizedWrite = applyDebuggingModelStep(read, {
      type: "write",
      actorRole: "hardware-user"
    });
    const rollbackWithoutSnapshot = applyDebuggingModelStep(read, {
      type: "rollback",
      actorRole: "hardware-committer"
    });
    const written = applyDebuggingModelStep(read, {
      type: "write",
      actorRole: "hardware-committer"
    });
    const rolledBack = applyDebuggingModelStep(written, {
      type: "rollback",
      actorRole: "hardware-committer"
    });

    expect(unauthorizedWrite.violations).toContain("debugging write requires debugging:write");
    expect(rollbackWithoutSnapshot.violations).toContain("rollback requires a valid snapshot");
    expect(rolledBack.auditEvents.map((event) => event.action)).toEqual(
      expect.arrayContaining(["detect", "read", "write", "rollback"])
    );
    expect(rolledBack.hasValidSnapshot).toBe(false);
  });

  it("keeps UI route visibility no stronger than backend API eligibility", () => {
    const guest = applyPermissionModelStep(initialPermissionModelState(), {
      type: "setRole",
      roleId: "guest"
    });
    const admin = applyPermissionModelStep(guest, {
      type: "setRole",
      roleId: "admin"
    });
    const apiDenied = applyPermissionModelStep(admin, {
      type: "forceApiPermission",
      permission: "users:manage",
      allowed: false
    });
    const visibleWithoutApi = applyPermissionModelStep(apiDenied, {
      type: "forceVisibleRoute",
      route: "/user-permissions",
      visible: true
    });

    expect(guest.visibleRoutes).not.toContain("/user-permissions");
    expect(admin.visibleRoutes).toContain("/user-permissions");
    expect(visibleWithoutApi.violations).toContain("UI route visibility cannot exceed API eligibility");
  });

  it("formats failures with model name, seed, path, and reproduction steps", () => {
    const failure: StateModelFailure = {
      model: "parameter-approval",
      seed: 20260601,
      path: "12:3",
      message: "parameter terminal states cannot be transitioned again",
      steps: ["submit(hardware-user)", "merge(software-user)", "merge(software-user)"]
    };

    expect(formatStateModelFailure(failure)).toContain("parameter-approval");
    expect(formatStateModelFailure(failure)).toContain("seed=20260601");
    expect(formatStateModelFailure(failure)).toContain("path=12:3");
    expect(formatStateModelFailure(failure)).toContain("submit(hardware-user)");
  });

  it("reports minimal reproduction details when a model invariant fails", () => {
    const result = evaluateAcceptanceStateModels({
      numRuns: 5,
      modelOverrides: {
        "parameter-approval": {
          invariant: () => "intentional invariant failure"
        }
      }
    });

    expect(result.status).toBe("failed");
    expect(result.failures[0]).toMatchObject({
      model: "parameter-approval",
      seed: 20260601,
      message: "intentional invariant failure"
    });
    expect(result.failures[0].path).toEqual(expect.any(String));
    expect(result.failures[0].steps.length).toBeGreaterThan(0);
    expect(formatStateModelFailure(result.failures[0])).toContain("reproduction:");
  });
});
