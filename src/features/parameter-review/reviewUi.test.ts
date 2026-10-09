import { describe, expect, it } from "vitest";
import { findRetainedSubmissionRound, formatWorkflowDisplayText, getParameterInitializationReviewStatusLabel } from "./reviewUi";
import { initialState } from "@/mockData";

describe("retained submission identity", () => {
  const request = { id: "request-retained", parameterId: "parameter-retained", projectId: "project-retained", submissionRoundId: "round-retained" };
  const round = {
    ...initialState.parameterSubmissionRounds[0], id: request.submissionRoundId, projectId: request.projectId,
    items: [{ ...initialState.parameterSubmissionRounds[0].items[0], requestId: request.id, parameterId: request.parameterId }]
  };

  it("selects the exact retained round and supports requests without current project metadata", () => {
    expect(findRetainedSubmissionRound([round], request)).toBe(round);
    expect(findRetainedSubmissionRound([round], { ...request, projectId: undefined })).toBe(round);
  });

  it.each([
    { identity: "round", candidate: { ...round, id: "other-round" } },
    { identity: "project", candidate: { ...round, projectId: "other-project" } },
    { identity: "request", candidate: { ...round, items: [{ ...round.items[0], requestId: "other-request" }] } },
    { identity: "parameter", candidate: { ...round, items: [{ ...round.items[0], parameterId: "other-parameter" }] } }
  ])("refuses a mismatched $identity identity even when the round name matches", ({ candidate }) => {
    expect(findRetainedSubmissionRound([candidate], request)).toBeNull();
    expect(findRetainedSubmissionRound([candidate, round], request)).toBe(round);
  });

  it("never infers a missing retained round ID from matching request and parameter IDs", () => {
    expect(findRetainedSubmissionRound([round], { ...request, submissionRoundId: undefined })).toBeNull();
    expect(findRetainedSubmissionRound([], request)).toBeNull();
  });
});

describe("review workflow copy", () => {
  it("maps mixed English workflow statuses to product Chinese without leaking Committer/User", () => {
    expect(formatWorkflowDisplayText("硬件Committer检视")).toBe("硬件MDE检视");
    expect(formatWorkflowDisplayText("软件Committer检视")).toBe("软件MDE检视");
    expect(formatWorkflowDisplayText("软件User合入")).toBe("软件开发人员合入");
    expect(formatWorkflowDisplayText("硬件Committer检视")).not.toMatch(/Committer|User/);
    expect(formatWorkflowDisplayText("软件User合入")).not.toMatch(/Committer|User/);
  });

  it("keeps already-localized labels and initialization statuses in Chinese", () => {
    expect(formatWorkflowDisplayText("已合入")).toBe("已合入");
    expect(formatWorkflowDisplayText("已打回")).toBe("已打回");
    expect(getParameterInitializationReviewStatusLabel("pending")).toBe("待审阅");
    expect(getParameterInitializationReviewStatusLabel("approved")).toBe("已通过");
    expect(getParameterInitializationReviewStatusLabel("rejected")).toBe("已驳回");
  });
});
