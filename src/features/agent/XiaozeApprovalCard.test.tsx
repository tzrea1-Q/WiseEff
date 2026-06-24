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
});
