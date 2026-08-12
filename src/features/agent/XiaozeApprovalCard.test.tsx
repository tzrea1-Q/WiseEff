import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  XIAOZE_APPROVAL_DEFAULT_REJECT_REASON,
  XiaozeApprovalCardContent
} from "./XiaozeApprovalCardContent";

describe("XiaozeApprovalCard", () => {
  it("resolves approve with edited value through the Chinese action buttons", async () => {
    const resolve = vi.fn();
    render(
      <XiaozeApprovalCardContent
        interrupt={{
          approvalId: "a1",
          toolName: "action.submitParameterChange",
          payload: { projectId: "p1", parameterId: "pd1", targetValue: "42" },
          citations: []
        }}
        resolve={resolve}
      />
    );
    fireEvent.change(screen.getByLabelText("目标值"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "批准" }));
    expect(resolve).toHaveBeenCalledWith({
      decision: "approve",
      editedArgs: expect.objectContaining({ targetValue: "50" })
    });
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reject/i })).not.toBeInTheDocument();
  });

  it("renders the AI change reason when the payload provides one", () => {
    render(
      <XiaozeApprovalCardContent
        interrupt={{
          approvalId: "a1",
          toolName: "action.submitParameterChange",
          payload: {
            projectId: "p1",
            parameterId: "pd1",
            targetValue: "42",
            reason: "快充温升超阈值，需要下调输入电流"
          },
          citations: []
        }}
        resolve={vi.fn()}
      />
    );

    const reasonBlock = screen.getByRole("note", { name: "变更理由" });
    expect(reasonBlock).toHaveTextContent("快充温升超阈值，需要下调输入电流");
  });

  it("omits the reason block when the payload has no reason", () => {
    render(
      <XiaozeApprovalCardContent
        interrupt={{
          approvalId: "a1",
          toolName: "action.submitParameterChange",
          payload: { projectId: "p1", parameterId: "pd1", targetValue: "42" },
          citations: []
        }}
        resolve={vi.fn()}
      />
    );

    expect(screen.queryByRole("note", { name: "变更理由" })).not.toBeInTheDocument();
  });

  it("sends the typed reject reason, falling back to the Chinese default", () => {
    const resolve = vi.fn();
    const { unmount } = render(
      <XiaozeApprovalCardContent
        interrupt={{
          approvalId: "a1",
          toolName: "action.submitParameterChange",
          payload: { projectId: "p1", parameterId: "pd1", targetValue: "42" },
          citations: []
        }}
        resolve={resolve}
      />
    );
    fireEvent.change(screen.getByLabelText("拒绝理由"), {
      target: { value: "目标值超出该项目安全范围" }
    });
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    expect(resolve).toHaveBeenCalledWith({
      decision: "reject",
      reason: "目标值超出该项目安全范围"
    });
    unmount();

    const fallbackResolve = vi.fn();
    render(
      <XiaozeApprovalCardContent
        interrupt={{
          approvalId: "a2",
          toolName: "action.submitParameterChange",
          payload: { projectId: "p1", parameterId: "pd1", targetValue: "42" },
          citations: []
        }}
        resolve={fallbackResolve}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    expect(fallbackResolve).toHaveBeenCalledWith({
      decision: "reject",
      reason: XIAOZE_APPROVAL_DEFAULT_REJECT_REASON
    });
  });
});
