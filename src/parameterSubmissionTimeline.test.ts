import { describe, expect, it } from "vitest";
import { deriveSubmissionTimeline, SUBMISSION_TIMELINE_STEPS } from "./parameterSubmissionTimeline";
import type { ParameterSubmissionItem, ParameterSubmissionRound } from "./mockData";

const submissionItem: ParameterSubmissionItem = {
  requestId: "PRQ-test",
  parameterId: "parameter-test",
  name: "test_parameter",
  module: "Test Module",
  currentValue: "1",
  targetValue: "2",
  unit: "",
  risk: "Low",
  valueKind: "scalar",
  reason: "Exercise timeline derivation."
};

type TestParameterSubmissionRound = Omit<ParameterSubmissionRound, "status"> & {
  status: ParameterSubmissionRound["status"] | "草稿";
};

function createRound(
  status: ParameterSubmissionRound["status"] | "草稿",
  items: ParameterSubmissionItem[] = []
): TestParameterSubmissionRound {
  return {
    id: "PRS-test",
    projectId: "project-test",
    projectName: "Test Project",
    submitter: "Tester",
    createdAt: "刚刚",
    status,
    summary: "Test submission round.",
    items
  };
}

describe("parameter submission timeline", () => {
  it("exposes the submission timeline steps", () => {
    expect(SUBMISSION_TIMELINE_STEPS).toEqual([
      "选择参数",
      "填写目标值",
      "硬件Committer检视",
      "软件Committer检视",
      "软件User合入"
    ]);
  });

  it("has no active step without a round", () => {
    expect(deriveSubmissionTimeline(null).activeIndex).toBe(-1);
  });

  it("starts draft rounds without items at parameter selection", () => {
    expect(deriveSubmissionTimeline(createRound("草稿", [])).activeIndex).toBe(0);
  });

  it("moves draft rounds with items to target entry", () => {
    expect(deriveSubmissionTimeline(createRound("草稿", [submissionItem])).activeIndex).toBe(1);
  });

  it.each([
    ["硬件Committer检视", 2],
    ["软件Committer检视", 3],
    ["软件User合入", 4],
    ["已合入", 4],
    ["已打回", 2],
    ["已撤回", 2],
    ["待审阅", 2],
    ["自动检查通过", 3],
    ["等待合入", 4]
  ] as const)("maps %s rounds to timeline index %i", (status, activeIndex) => {
    expect(deriveSubmissionTimeline(createRound(status, [submissionItem])).activeIndex).toBe(activeIndex);
  });
});
