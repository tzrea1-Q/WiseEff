import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XiaozeApprovalCardContent } from "./XiaozeApprovalCardContent";

describe("XiaozeApprovalCard", () => {
  it("resolves approve with edited value", async () => {
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
    fireEvent.change(screen.getByLabelText(/target value/i), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(resolve).toHaveBeenCalledWith({
      decision: "approve",
      editedArgs: expect.objectContaining({ targetValue: "50" })
    });
  });

  it("resolves reject without mutation args", () => {
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
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ decision: "reject" }));
  });

  it("renders the knowledge-draft variant with draft fields and approves with the edited title", () => {
    const resolve = vi.fn();
    render(
      <XiaozeApprovalCardContent
        interrupt={{
          approvalId: "a2",
          toolName: "action.createKnowledgeDraft",
          payload: {
            title: "快充温控排查经验",
            contentMarkdown: "## 结论\n\n温度超过 45 度时降流。",
            tags: ["日志分析", "快充"],
            sourceLogId: "log-9"
          },
          citations: []
        }}
        resolve={resolve}
      />
    );

    expect(screen.getByText("确认创建知识草稿")).toBeInTheDocument();
    expect(screen.getByText(/批准只创建草稿/)).toBeInTheDocument();
    expect(screen.getByText(/日志分析、快充/)).toBeInTheDocument();
    expect(screen.getByText("log-9")).toBeInTheDocument();
    expect(screen.getByText(/温度超过 45 度时降流/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("草稿标题"), { target: { value: "快充温控排查经验(已审阅)" } });
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(resolve).toHaveBeenCalledWith({
      decision: "approve",
      editedArgs: expect.objectContaining({ title: "快充温控排查经验(已审阅)", sourceLogId: "log-9" })
    });
  });
});
