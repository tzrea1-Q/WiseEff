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
  reason: "Exercise timeline derivation."
};

function createRound(
  status: ParameterSubmissionRound["status"] | "草稿",
  items: ParameterSubmissionItem[] = []
): ParameterSubmissionRound & { status: ParameterSubmissionRound["status"] | "草稿" } {
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
    expect(SUBMISSION_TIMELINE_STEPS).toEqual(["选择参数", "填写目标值", "提交审阅", "管理员合入"]);
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
    ["待审阅", 2],
    ["已合入", 3],
    ["已打回", 2],
    ["已撤回", 2],
    ["自动检查通过", 2],
    ["等待合入", 2]
  ] as const)("maps %s rounds to timeline index %i", (status, activeIndex) => {
    expect(deriveSubmissionTimeline(createRound(status, [submissionItem])).activeIndex).toBe(activeIndex);
  });
});
