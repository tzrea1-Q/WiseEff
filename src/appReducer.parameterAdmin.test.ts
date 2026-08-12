import { describe, expect, it } from "vitest";
import { appReducer } from "@/application/state/appState";
import { initialState } from "./mockData";

const adminState = { ...initialState, activeRoleId: "admin" };

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
