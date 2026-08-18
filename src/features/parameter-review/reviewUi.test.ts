import { describe, expect, it } from "vitest";
import { formatWorkflowDisplayText, getParameterInitializationReviewStatusLabel } from "./reviewUi";

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
