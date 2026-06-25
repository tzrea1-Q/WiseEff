import { describe, expect, it } from "vitest";
import { localizeStepSummary, presentRunStep } from "./xiaozeStepPresentation";

describe("xiaozeStepPresentation", () => {
  it("localizes search parameter summaries", () => {
    expect(localizeStepSummary('Found 4 parameters matching "charge".')).toBe("找到 4 个匹配参数");
  });

  it("drops redundant English summaries for known tools", () => {
    expect(
      presentRunStep({
        id: "s1",
        kind: "tool",
        label: "搜索参数定义",
        toolName: "perception.searchParameters",
        status: "succeeded",
        summary: 'Found 4 parameters matching "charge".',
        startedAtMs: 0
      }).summary
    ).toBe("找到 4 个匹配参数");
  });
});
