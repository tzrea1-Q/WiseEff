import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductFeedback } from "@/domain/productFeedback/types";
import { FeedbackAdminDrawer } from "./FeedbackAdminDrawer";

function feedback(overrides: Partial<ProductFeedback> = {}): ProductFeedback {
  return {
    id: "feedback-1",
    pagePath: "/logs",
    pageTitle: "日志智能分析",
    feedbackType: "experience",
    description: "上传日志后没有看到进度提示",
    status: "open",
    adminNote: null,
    createdAt: "2026-07-08T08:00:00.000Z",
    updatedAt: "2026-07-08T08:00:00.000Z",
    attachments: [],
    ...overrides
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FeedbackAdminDrawer", () => {
  it("starts handling open feedback and persists the admin note", async () => {
    const onUpdate = vi.fn().mockResolvedValue(feedback({ status: "in_progress", adminNote: "已分配给日志团队" }));

    render(
      <FeedbackAdminDrawer
        feedback={feedback()}
        open
        onClose={vi.fn()}
        onUpdate={onUpdate}
        getAttachmentObjectUrl={vi.fn()}
      />
    );

    const drawer = screen.getByRole("dialog", { name: "日志智能分析" });
    fireEvent.change(within(drawer).getByLabelText("处理备注"), { target: { value: "已分配给日志团队" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "开始处理" }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith("feedback-1", {
        status: "in_progress",
        adminNote: "已分配给日志团队"
      })
    );
  });

  it("closes in-progress feedback", async () => {
    const onUpdate = vi.fn().mockResolvedValue(feedback({ status: "closed", adminNote: "已确认修复" }));

    render(
      <FeedbackAdminDrawer
        feedback={feedback({ status: "in_progress", adminNote: "处理中" })}
        open
        onClose={vi.fn()}
        onUpdate={onUpdate}
        getAttachmentObjectUrl={vi.fn()}
      />
    );

    const drawer = screen.getByRole("dialog", { name: "日志智能分析" });
    fireEvent.change(within(drawer).getByLabelText("处理备注"), { target: { value: "已确认修复" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "关闭" }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith("feedback-1", {
        status: "closed",
        adminNote: "已确认修复"
      })
    );
  });

  it("renders closed feedback as read-only", () => {
    render(
      <FeedbackAdminDrawer
        feedback={feedback({ status: "closed", adminNote: "已关闭归档" })}
        open
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        getAttachmentObjectUrl={vi.fn()}
      />
    );

    const drawer = screen.getByRole("dialog", { name: "日志智能分析" });

    expect(within(drawer).getByLabelText("处理备注")).toBeDisabled();
    expect(within(drawer).queryByRole("button", { name: "开始处理" })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
    expect(within(drawer).getByText("已关闭的反馈仅可查看。")).toBeInTheDocument();
  });
});
