import { describe, expect, it } from "vitest";
import { ApiError } from "../../../shared/http/errors";
import { formatApprovalExecutionFailure } from "./approvalExecutionFailure";

describe("formatApprovalExecutionFailure", () => {
  it("keeps a Chinese ApiError message after the halt prefix", () => {
    expect(
      formatApprovalExecutionFailure(
        new ApiError("CONFLICT", "请刷新后基于本轮最新工作版本继续编辑。", 409, {
          reason: "stale-working-tip"
        })
      )
    ).toBe("操作未能完成：请刷新后基于本轮最新工作版本继续编辑。");
  });

  it("maps English ApiError codes instead of leaking operator prose", () => {
    expect(
      formatApprovalExecutionFailure(new ApiError("NOT_FOUND", "Agent approval was not found.", 404))
    ).toBe("操作未能完成：请求的内容不存在或已被移除。");
  });
});
