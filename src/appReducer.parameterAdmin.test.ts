import { describe, expect, it } from "vitest";
import { appReducer } from "./App";
import { initialState } from "./mockData";

const adminState = { ...initialState, activeRoleId: "admin" };

describe("parameter-admin reducer actions", () => {
  it("projects API parameter hydration into the admin config draft library", () => {
    const next = appReducer(
      {
        ...adminState,
        activeProjectId: "",
        configDraft: {
          projects: [],
          parameterLibrary: [],
          debugParameters: []
        },
        parameters: []
      },
      {
        type: "HYDRATE_PARAMETER_RUNTIME",
        projects: [
          { id: "aurora", name: "Aurora", code: "AUR" },
          { id: "atlas", name: "Atlas", code: "ATL" }
        ],
        parameters: [
          {
            id: "aurora-fast-charge-current",
            projectId: "aurora",
            name: "fast_charge_current_limit_ma",
            description: "Fast charge current",
            explanation: "Limits fast charging current.",
            configFormat: "JSON",
            module: "Charging Policy",
            currentValue: "3200",
            recommendedValue: "3100",
            range: "0 - 5000",
            unit: "mA",
            risk: "High",
            updatedAt: "2026-06-11T00:00:00.000Z",
            updatedAtTs: "2026-06-11T00:00:00.000Z",
            history: []
          },
          {
            id: "atlas-fast-charge-current",
            projectId: "atlas",
            name: "fast_charge_current_limit_ma",
            description: "Fast charge current",
            explanation: "Limits fast charging current.",
            configFormat: "JSON",
            module: "Charging Policy",
            currentValue: "3000",
            recommendedValue: "3100",
            range: "0 - 5000",
            unit: "mA",
            risk: "High",
            updatedAt: "2026-06-10T00:00:00.000Z",
            updatedAtTs: "2026-06-10T00:00:00.000Z",
            history: []
          }
        ],
        changeRequests: [],
        parameterSubmissionRounds: [],
        parameterDrafts: []
      }
    );

    expect(next.configDraft.projects).toEqual([
      { id: "aurora", name: "Aurora", code: "AUR" },
      { id: "atlas", name: "Atlas", code: "ATL" }
    ]);
    expect(next.configDraft.parameterLibrary).toEqual([
      expect.objectContaining({
        id: "fast-charge-current-limit-ma",
        name: "fast_charge_current_limit_ma",
        values: {
          aurora: {
            currentValue: "3200",
            recommendedValue: "3100",
            updatedAt: "2026-06-11T00:00:00.000Z"
          },
          atlas: {
            currentValue: "3000",
            recommendedValue: "3100",
            updatedAt: "2026-06-10T00:00:00.000Z"
          }
        }
      })
    ]);
  });

  it("assigns a user role and records audit metadata", () => {
    const next = appReducer(adminState, {
      type: "ASSIGN_USER_ROLE",
      userId: "u-zhao-heng",
      roleId: "hardware-committer"
    });

    expect(next.users.find((user) => user.id === "u-zhao-heng")?.roleId).toBe("hardware-committer");
    expect(next.auditEvents[0].kind).toBe("user-role-change");
    expect(next.auditEvents[0].userId).toBe("u-zhao-heng");
    expect(next.auditEvents[0].metadata?.previousRole).toBe("hardware-user");
    expect(next.auditEvents[0].metadata?.newRole).toBe("hardware-committer");
  });

  it("does not let the current user assign their own role", () => {
    const next = appReducer(adminState, {
      type: "ASSIGN_USER_ROLE",
      userId: adminState.currentUserId,
      roleId: "guest"
    });

    expect(next).toBe(adminState);
  });

  it("toggles user active state and writes an audit event", () => {
    const next = appReducer(adminState, {
      type: "TOGGLE_USER_ACTIVE",
      userId: "u-liu-min",
      isActive: false
    });

    expect(next.users.find((user) => user.id === "u-liu-min")?.isActive).toBe(false);
    expect(next.auditEvents[0].kind).toBe("user-toggle");
  });

  it("adds users and rejects duplicate emails", () => {
    const added = appReducer(adminState, {
      type: "ADD_USER",
      name: "Demo Engineer",
      email: "demo@chargelab.cn",
      title: "Prototype User",
      roleId: "hardware-user"
    });

    expect(added.users).toHaveLength(adminState.users.length + 1);
    expect(added.users.at(-1)?.name).toBe("Demo Engineer");
    expect(added.auditEvents[0].kind).toBe("user-add");
    expect(added.auditEvents[0].userId).toBe(added.users.at(-1)?.id);

    const duplicate = appReducer(adminState, {
      type: "ADD_USER",
      name: "Fake",
      email: "xu@chargelab.cn",
      title: "Fake",
      roleId: "guest"
    });

    expect(duplicate).toBe(adminState);
  });

  it("marks exports by snapshotting the current draft and writing audit metadata", () => {
    const dirty = appReducer(adminState, {
      type: "UPDATE_PROJECT_PARAMETER_METADATA",
      projectId: "aurora",
      parameterId: adminState.configDraft.parameterLibrary[0].id,
      patch: { description: "dirty change" }
    });
    const cleared = appReducer(dirty, {
      type: "MARK_EXPORTED",
      snapshotName: "params-demo.json",
      timestamp: "2026-05-10T22:00:00.000Z"
    });

    expect(cleared.lastExportedSnapshot).toBe(JSON.stringify(cleared.configDraft));
    expect(cleared.auditEvents[0].kind).toBe("export");
    expect(cleared.auditEvents[0].metadata?.snapshotName).toBe("params-demo.json");
  });

  it("dismisses insights idempotently and replaces AI flagged ids", () => {
    const once = appReducer(adminState, { type: "DISMISS_INSIGHT", insightId: "high-risk-orphans" });
    const twice = appReducer(once, { type: "DISMISS_INSIGHT", insightId: "high-risk-orphans" });
    const flagged = appReducer(twice, { type: "SET_AI_FLAGGED_IMPORT_IDS", ids: ["p1", "p2"] });

    expect(twice.insightDismissedIds).toEqual(["high-risk-orphans"]);
    expect(flagged.aiFlaggedImportIds).toEqual(["p1", "p2"]);
  });

  it("records agent action execution with viaAgent metadata", () => {
    const next = appReducer(adminState, {
      type: "AGENT_ACTION_EXECUTED",
      actionId: "scan-orphans",
      metadata: { foundOrphans: 2 }
    });

    expect(next.auditEvents[0].kind).toBe("agent-action");
    expect(next.auditEvents[0].viaAgent).toBe(true);
    expect(next.auditEvents[0].metadata?.aiActionId).toBe("scan-orphans");
    expect(next.auditEvents[0].metadata?.foundOrphans).toBe(2);
  });

  it("creates an undo entry for destructive parameter deletion", () => {
    const paramId = adminState.configDraft.parameterLibrary[0].id;
    const next = appReducer(adminState, {
      type: "DELETE_PROJECT_PARAMETER",
      parameterId: paramId
    });

    expect(next.configDraft.parameterLibrary.find((parameter) => parameter.id === paramId)).toBeUndefined();
    expect(next._undoStack?.actionKind).toBe("parameter-delete");
    const expiresIn = new Date(next._undoStack!.expiresAt).getTime() - new Date(next._undoStack!.createdAt).getTime();
    expect(expiresIn).toBeGreaterThanOrEqual(9_500);
    expect(expiresIn).toBeLessThanOrEqual(10_500);
    expect(next.auditEvents[0].kind).toBe("parameter-delete");
  });

  it("undoes the last destructive action before expiry", () => {
    const paramId = adminState.configDraft.parameterLibrary[0].id;
    const deleted = appReducer(adminState, {
      type: "DELETE_PROJECT_PARAMETER",
      parameterId: paramId
    });
    const restored = appReducer(deleted, { type: "UNDO_LAST_DESTRUCTIVE" });

    expect(restored.configDraft.parameterLibrary.find((parameter) => parameter.id === paramId)).toBeTruthy();
    expect(restored._undoStack).toBeNull();
    expect(restored.auditEvents[0].kind).toBe("rollback-undo");
  });

  it("does not undo expired destructive actions and can clear undo manually", () => {
    const paramId = adminState.configDraft.parameterLibrary[0].id;
    const deleted = appReducer(adminState, {
      type: "DELETE_PROJECT_PARAMETER",
      parameterId: paramId
    });
    const expired = {
      ...deleted,
      _undoStack: deleted._undoStack
        ? { ...deleted._undoStack, expiresAt: new Date(Date.now() - 60_000).toISOString() }
        : null
    };

    expect(appReducer(expired, { type: "UNDO_LAST_DESTRUCTIVE" })).toBe(expired);
    expect(appReducer(deleted, { type: "CLEAR_UNDO" })._undoStack).toBeNull();
  });

  it.each([
    [
      "MARK_EXPORTED",
      () => ({
        type: "MARK_EXPORTED" as const,
        snapshotName: "params-demo.json",
        timestamp: "2026-05-10T22:00:00.000Z"
      })
    ],
    ["SET_AI_FLAGGED_IMPORT_IDS", () => ({ type: "SET_AI_FLAGGED_IMPORT_IDS" as const, ids: ["p1", "p2"] })],
    [
      "AGENT_ACTION_EXECUTED",
      () => ({
        type: "AGENT_ACTION_EXECUTED" as const,
        actionId: "scan-orphans",
        metadata: { foundOrphans: 2 }
      })
    ],
    ["UNDO_LAST_DESTRUCTIVE", () => ({ type: "UNDO_LAST_DESTRUCTIVE" as const })],
    ["CLEAR_UNDO", () => ({ type: "CLEAR_UNDO" as const })],
    ["IMPORT_PARAMETERS", () => ({ type: "IMPORT_PARAMETERS" as const })]
  ])("requires admin.access for %s", (_name, buildAction) => {
    const deleted = appReducer(adminState, {
      type: "DELETE_PROJECT_PARAMETER",
      parameterId: adminState.configDraft.parameterLibrary[0].id
    });
    const guestState = { ...deleted, activeRoleId: "guest" };

    expect(appReducer(guestState, buildAction())).toBe(guestState);
  });
});

describe("project parameter initialization reducer actions", () => {
  it("creates and submits an initialization draft for review", () => {
    const next = appReducer(adminState, {
      type: "SUBMIT_PARAMETER_INITIALIZATION",
      draft: {
        projectName: "Zephyr",
        projectCode: "ZEP",
        ownerUserId: "u-xu-yun",
        sourceProjectIds: ["aurora", "nebula"],
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: ["nebula"],
        selectedModules: ["Battery Safety"],
        selectedRisks: ["Medium"],
        selectedParameterIds: ["battery-temp-target"],
        notes: "Initialize from Aurora"
      }
    });

    expect(next.parameterInitializationDrafts).toHaveLength(adminState.parameterInitializationDrafts.length + 1);
    expect(next.parameterInitializationReviews[0]).toMatchObject({
      status: "pending",
      submittedBy: adminState.currentUserId
    });
    expect(next.projectInitializationStatuses[next.parameterInitializationReviews[0].projectId]).toBe(
      "initialization_pending_review"
    );
  });

  it("keeps explicitly selected initialization snapshots when later filters hide them", () => {
    const next = appReducer(adminState, {
      type: "SUBMIT_PARAMETER_INITIALIZATION",
      draft: {
        projectName: "Zephyr",
        projectCode: "ZEP",
        ownerUserId: "u-xu-yun",
        sourceProjectIds: ["aurora"],
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: [],
        selectedModules: ["Charging Policy"],
        selectedRisks: ["High"],
        selectedParameterIds: ["battery-temp-target"],
        notes: "Selected from Battery Safety before narrowing filters"
      }
    });

    expect(next.parameterInitializationDrafts).toHaveLength(adminState.parameterInitializationDrafts.length + 1);
    expect(next.parameterInitializationDrafts[0].parameterSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parameterId: "battery-temp-target",
          module: "Battery Safety",
          risk: "Medium"
        })
      ])
    );
  });

  it("requires admin access, a real project id, and unique active initialization ids to submit", () => {
    const guestState = { ...adminState, activeRoleId: "guest" };
    const action = {
      type: "SUBMIT_PARAMETER_INITIALIZATION" as const,
      draft: {
        projectName: "Zephyr",
        projectCode: "ZEP",
        ownerUserId: "u-xu-yun",
        sourceProjectIds: ["aurora"],
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: [],
        selectedModules: ["Battery Safety"],
        selectedRisks: ["Medium" as const],
        selectedParameterIds: ["battery-temp-target"],
        notes: ""
      }
    };

    expect(appReducer(guestState, action)).toBe(guestState);
    expect(
      appReducer(adminState, {
        ...action,
        draft: { ...action.draft, projectCode: "!!!" }
      })
    ).toBe(adminState);
    expect(
      appReducer(adminState, {
        ...action,
        draft: { ...action.draft, projectCode: "aurora" }
      })
    ).toBe(adminState);

    const submitted = appReducer(adminState, action);
    expect(
      appReducer(submitted, {
        ...action,
        draft: { ...action.draft, projectCode: "ZEP" }
      })
    ).toBe(submitted);
  });

  it("rejects duplicate initialization project codes", () => {
    const existingProjectCode = adminState.configDraft.projects[0].code;
    const next = appReducer(adminState, {
      type: "SUBMIT_PARAMETER_INITIALIZATION",
      draft: {
        projectName: "Aurora Clone",
        projectCode: existingProjectCode,
        ownerUserId: "u-xu-yun",
        sourceProjectIds: ["aurora"],
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: [],
        selectedModules: ["Battery Safety"],
        selectedRisks: ["Medium"],
        selectedParameterIds: ["battery-temp-target"],
        notes: ""
      }
    });

    expect(next).toBe(adminState);
  });

  it("requires parameter review access and pending reviews to approve", () => {
    const submitted = appReducer(adminState, {
      type: "SUBMIT_PARAMETER_INITIALIZATION",
      draft: {
        projectName: "Zephyr",
        projectCode: "ZEP",
        ownerUserId: "u-xu-yun",
        sourceProjectIds: ["aurora"],
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: [],
        selectedModules: ["Battery Safety"],
        selectedRisks: ["Medium"],
        selectedParameterIds: ["battery-temp-target"],
        notes: ""
      }
    });
    const reviewId = submitted.parameterInitializationReviews[0].id;
    const userState = { ...submitted, activeRoleId: "user" };
    expect(appReducer(userState, { type: "APPROVE_PARAMETER_INITIALIZATION", reviewId })).toBe(userState);

    const approved = appReducer(submitted, { type: "APPROVE_PARAMETER_INITIALIZATION", reviewId });
    expect(approved.parameterInitializationReviews[0].status).toBe("approved");
    expect(approved.projectInitializationStatuses[approved.parameterInitializationReviews[0].projectId]).toBe(
      "initialized"
    );
    expect(
      appReducer(approved, { type: "APPROVE_PARAMETER_INITIALIZATION", reviewId })
    ).toBe(approved);
  });

  it("rejects resubmission after an initialization review is approved", () => {
    const submitted = appReducer(adminState, {
      type: "SUBMIT_PARAMETER_INITIALIZATION",
      draft: {
        projectName: "Zephyr",
        projectCode: "ZEP",
        ownerUserId: "u-xu-yun",
        sourceProjectIds: ["aurora"],
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: [],
        selectedModules: ["Battery Safety"],
        selectedRisks: ["Medium"],
        selectedParameterIds: ["battery-temp-target"],
        notes: ""
      }
    });
    const reviewId = submitted.parameterInitializationReviews[0].id;
    const approved = appReducer(submitted, { type: "APPROVE_PARAMETER_INITIALIZATION", reviewId });
    const resubmitted = appReducer(approved, {
      type: "SUBMIT_PARAMETER_INITIALIZATION",
      draft: {
        projectName: "Zephyr",
        projectCode: "ZEP",
        ownerUserId: "u-xu-yun",
        sourceProjectIds: ["aurora"],
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: [],
        selectedModules: ["Battery Safety"],
        selectedRisks: ["Medium"],
        selectedParameterIds: ["battery-temp-target"],
        notes: ""
      }
    });

    expect(resubmitted).toBe(approved);
  });

  it("requires parameter review access and pending reviews to reject", () => {
    const submitted = appReducer(adminState, {
      type: "SUBMIT_PARAMETER_INITIALIZATION",
      draft: {
        projectName: "Zephyr",
        projectCode: "ZEP",
        ownerUserId: "u-xu-yun",
        sourceProjectIds: ["aurora"],
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: [],
        selectedModules: ["Battery Safety"],
        selectedRisks: ["Medium"],
        selectedParameterIds: ["battery-temp-target"],
        notes: ""
      }
    });
    const reviewId = submitted.parameterInitializationReviews[0].id;
    const guestState = { ...submitted, activeRoleId: "guest" };
    expect(appReducer(guestState, { type: "REJECT_PARAMETER_INITIALIZATION", reviewId, reason: "Need source rationale" })).toBe(guestState);

    const rejected = appReducer(submitted, {
      type: "REJECT_PARAMETER_INITIALIZATION",
      reviewId,
      reason: "Need source rationale"
    });

    expect(rejected.parameterInitializationReviews[0]).toMatchObject({
      status: "rejected",
      rejectionReason: "Need source rationale"
    });
    expect(rejected.projectInitializationStatuses[rejected.parameterInitializationReviews[0].projectId]).toBe(
      "initialization_rejected"
    );
    expect(
      appReducer(rejected, {
        type: "REJECT_PARAMETER_INITIALIZATION",
        reviewId,
        reason: "Different reason"
      })
    ).toBe(rejected);
  });

  it("rejects blank initialization rejection reasons", () => {
    const submitted = appReducer(adminState, {
      type: "SUBMIT_PARAMETER_INITIALIZATION",
      draft: {
        projectName: "Zephyr",
        projectCode: "ZEP",
        ownerUserId: "u-xu-yun",
        sourceProjectIds: ["aurora"],
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: [],
        selectedModules: ["Battery Safety"],
        selectedRisks: ["Medium"],
        selectedParameterIds: ["battery-temp-target"],
        notes: ""
      }
    });
    const reviewId = submitted.parameterInitializationReviews[0].id;

    expect(
      appReducer(submitted, {
        type: "REJECT_PARAMETER_INITIALIZATION",
        reviewId,
        reason: "   "
    })
    ).toBe(submitted);
  });

  it("rejects mixed-project submission rounds and stashed rounds", () => {
    const auroraParameter = adminState.parameters.find((item) => item.projectId === "aurora")!;
    const nebulaParameter = adminState.parameters.find((item) => item.projectId === "nebula")!;

    const mixedSubmission = appReducer(adminState, {
      type: "ADD_PARAMETER_SUBMISSION_ROUND",
      items: [
        { parameterId: auroraParameter.id, targetValue: "3650", reason: "Aurora" },
        { parameterId: nebulaParameter.id, targetValue: "3550", reason: "Nebula" }
      ]
    });
    expect(mixedSubmission).toBe(adminState);

    const mixedStash = appReducer(adminState, {
      type: "STASH_PARAMETER_SUBMISSION_ROUND",
      items: [
        { parameterId: auroraParameter.id, targetValue: "3650", reason: "Aurora" },
        { parameterId: nebulaParameter.id, targetValue: "3550", reason: "Nebula" }
      ]
    });
    expect(mixedStash).toBe(adminState);
  });

  it("allows resubmission after an initialization review is rejected", () => {
    const submitted = appReducer(adminState, {
      type: "SUBMIT_PARAMETER_INITIALIZATION",
      draft: {
        projectName: "Zephyr",
        projectCode: "ZEP",
        ownerUserId: "u-xu-yun",
        sourceProjectIds: ["aurora"],
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: [],
        selectedModules: ["Battery Safety"],
        selectedRisks: ["Medium"],
        selectedParameterIds: ["battery-temp-target"],
        notes: ""
      }
    });
    const reviewId = submitted.parameterInitializationReviews[0].id;
    const rejected = appReducer(submitted, {
      type: "REJECT_PARAMETER_INITIALIZATION",
      reviewId,
      reason: "Need source rationale"
    });
    const resubmitted = appReducer(rejected, {
      type: "SUBMIT_PARAMETER_INITIALIZATION",
      draft: {
        projectName: "Zephyr",
        projectCode: "ZEP",
        ownerUserId: "u-xu-yun",
        sourceProjectIds: ["aurora"],
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: [],
        selectedModules: ["Battery Safety"],
        selectedRisks: ["Medium"],
        selectedParameterIds: ["battery-temp-target"],
        notes: ""
      }
    });

    expect(resubmitted.parameterInitializationReviews).toHaveLength(rejected.parameterInitializationReviews.length + 1);
    expect(resubmitted.parameterInitializationReviews[0].status).toBe("pending");
    expect(resubmitted.projectInitializationStatuses[resubmitted.parameterInitializationReviews[0].projectId]).toBe(
      "initialization_pending_review"
    );
  });
});
