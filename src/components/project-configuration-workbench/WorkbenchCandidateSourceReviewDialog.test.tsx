import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkbenchCandidateSourceReviewDialog } from "./WorkbenchCandidateSourceReviewDialog";

describe("WorkbenchCandidateSourceReviewDialog", () => {
  it("starts without an error and requires a reason before submitting the source change", () => {
    const onConfirm = vi.fn();
    render(<WorkbenchCandidateSourceReviewDialog open
      activeCandidate={{ fileName: "board.dts" } as never}
      sourcePreview={{ kind: "canonical", bindingId: "binding", sourcePinId: "pin", baseVersionId: "version" } as never}
      submitting={false} error="" onCancel={vi.fn()} onConfirm={onConfirm} />);
    const dialog = screen.getByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "提交审核" });
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "来源变更原因" }), { target: { value: "   " } });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "来源变更原因" }), { target: { value: " 更新充电参数 " } });
    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledWith("更新充电参数");
  });
});
