import { describe, expect, it } from "vitest";

import { sourceReviewReason } from "./sourceReviewReason";

describe("sourceReviewReason", () => {
  it("directs multi-target single-entry previews to batch review", () => {
    expect(sourceReviewReason("canonical-batch-review-required"))
      .toBe("候选含多个来源目标；请使用批量审核，核对完整证明后一次提交。");
  });

  it("distinguishes a batch candidate without enough changed targets", () => {
    expect(sourceReviewReason("canonical-batch-targets-required"))
      .toBe("当前文件未形成至少两个可验证的变更目标；请检查候选文件。");
  });
});
