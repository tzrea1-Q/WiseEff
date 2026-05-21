import { describe, expect, it } from "vitest";
import { createPrototypeState, projects, roles } from "@/mockData";
import { submitParameterRound, type BuildRuntimeReviewFields } from "./commands";

const buildRuntimeReviewFields: BuildRuntimeReviewFields = (summary, module) => ({
  createdAtTs: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  waitingHours: 0,
  aiSummary: summary,
  aiSuggestion: {
    recommendation: "needs-review",
    confidence: "mid",
    summary,
    reasons: ["deterministic-test-builder"],
    similarRequests: []
  },
  impact: [{ kind: "module", name: module, note: "deterministic impact", risk: "Medium" }]
});

describe("submitParameterRound", () => {
  it("submits a parameter round and creates linked requests", () => {
    const state = createPrototypeState();
    const parameter = state.parameters.find((item) => item.projectId === "aurora")!;

    const next = submitParameterRound(state, {
      projects,
      roles,
      buildRuntimeReviewFields,
      items: [
        {
          parameterId: parameter.id,
          targetValue: "3650",
          reason: "验证高温快充边界"
        }
      ]
    });

    const [round] = next.parameterSubmissionRounds;
    const [request] = next.changeRequests;

    expect(round.status).toBe("待审阅");
    expect(round.items[0]).toMatchObject({
      parameterId: parameter.id,
      targetValue: "3650"
    });
    expect(request.submissionRoundId).toBe(round.id);
    expect(request.targetValue).toBe("3650");
  });

  it("stores selected hardware and software workflow assignees on the round and linked requests", () => {
    const state = createPrototypeState();
    const parameter = state.parameters.find((item) => item.projectId === "aurora")!;

    const next = submitParameterRound(state, {
      projects,
      roles,
      buildRuntimeReviewFields,
      assignees: {
        hardwareCommitterId: "u-wang-jie",
        softwareCommitterId: "u-sun-mei",
        softwareUserId: "u-chen-na"
      },
      items: [
        {
          parameterId: parameter.id,
          targetValue: "3650",
          reason: "验证四段审批指派"
        }
      ]
    });

    const [round] = next.parameterSubmissionRounds;
    const [request] = next.changeRequests;

    expect(round.workflowAssignees).toEqual({
      hardwareCommitterId: "u-wang-jie",
      softwareCommitterId: "u-sun-mei",
      softwareUserId: "u-chen-na"
    });
    expect(round.status).toBe("硬件Committer检视");
    expect(request.workflowAssignees).toEqual(round.workflowAssignees);
    expect(request.assignedTo).toBe("u-wang-jie");
    expect(request.status).toBe("硬件Committer检视");
  });

  it("keeps state unchanged when no draft item matches", () => {
    const state = createPrototypeState();

    const next = submitParameterRound(state, {
      projects,
      roles,
      buildRuntimeReviewFields,
      items: [{ parameterId: "missing-parameter", targetValue: "3650", reason: "ignored" }]
    });

    expect(next).toBe(state);
  });

  it("uses each item reason instead of the shared input reason", () => {
    const state = createPrototypeState();
    const parameter = state.parameters.find((item) => item.projectId === "aurora")!;

    const next = submitParameterRound(state, {
      projects,
      roles,
      buildRuntimeReviewFields,
      items: [
        {
          parameterId: parameter.id,
          targetValue: "3650",
          reason: "单项原因"
        }
      ],
      reason: "共享原因不应生效"
    });

    expect(next.parameterSubmissionRounds[0].items[0].reason).toBe("单项原因");
    expect(next.changeRequests[0].aiSummary).toBe("单项原因");
  });

  it("uses caller-provided project and role context", () => {
    const state = createPrototypeState();
    const parameter = state.parameters.find((item) => item.projectId === "aurora")!;

    const next = submitParameterRound(state, {
      projects: [{ id: parameter.projectId, name: "Injected Project Name" }],
      roles: [{ id: state.activeRoleId, name: "Injected Submitter" }],
      buildRuntimeReviewFields,
      items: [
        {
          parameterId: parameter.id,
          targetValue: "3650",
          reason: "Injected context reason"
        }
      ]
    });

    expect(next.parameterSubmissionRounds[0].projectName).toBe("Injected Project Name");
    expect(next.parameterSubmissionRounds[0].submitter).toBe("Injected Submitter");
    expect(next.changeRequests[0].submitter).toBe("Injected Submitter");
  });
});
