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

  it("closes in-progress feedback only after the irreversibility confirmation", async () => {
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
    fireEvent.click(within(drawer).getByRole("button", { name: "关闭反馈" }));

    // Closing is irreversible: nothing happens before the confirm dialog.
    expect(onUpdate).not.toHaveBeenCalled();
    const confirmDialog = screen.getByRole("dialog", { name: "确认关闭反馈" });
    expect(confirmDialog).toHaveTextContent(/只读状态/);
    expect(confirmDialog).toHaveTextContent(/处理备注将随关闭一并保存/);

    fireEvent.click(within(confirmDialog).getByRole("button", { name: "确认关闭" }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith("feedback-1", {
        status: "closed",
        adminNote: "已确认修复"
      })
    );
  });

  it("keeps the drawer mounted while the close confirmation is stacked above it", async () => {
    const onClose = vi.fn();
    const onUpdate = vi.fn().mockResolvedValue(feedback({ status: "closed" }));

    render(
      <FeedbackAdminDrawer
        feedback={feedback({ status: "in_progress" })}
        open
        onClose={onClose}
        onUpdate={onUpdate}
        getAttachmentObjectUrl={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭反馈" }));
    const confirmDialog = screen.getByRole("dialog", { name: "确认关闭反馈" });

    // The confirmation renders in its own portal, so both its pointer interactions
    // and Escape reach the Radix sheet as dismissal requests. While the confirmation
    // is stacked, those requests must not dismiss the drawer — that would unmount the
    // confirm button before its click can land and the close would never reach the
    // server (the PFB-ADMIN-001 acceptance regression). jsdom can only exercise the
    // Escape vector; the pointer vector is covered by the product-feedback browser
    // acceptance. Matching FeedbackDialog's dirty-state stack, the swallowed request
    // leaves the confirmation itself up as well.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "确认关闭反馈" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "日志智能分析" })).toBeInTheDocument();

    // The surviving confirmation can then complete the close.
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "确认关闭" }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith("feedback-1", { status: "closed", adminNote: null })
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close feedback when the confirmation is cancelled", () => {
    const onUpdate = vi.fn();

    render(
      <FeedbackAdminDrawer
        feedback={feedback({ status: "in_progress" })}
        open
        onClose={vi.fn()}
        onUpdate={onUpdate}
        getAttachmentObjectUrl={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭反馈" }));
    const confirmDialog = screen.getByRole("dialog", { name: "确认关闭反馈" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "取消" }));

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "确认关闭反馈" })).not.toBeInTheDocument();
  });

  it("opens attachment preview when thumbnail is clicked", async () => {
    const getAttachmentObjectUrl = vi.fn().mockResolvedValue("blob:preview-image");

    render(
      <FeedbackAdminDrawer
        feedback={feedback({
          attachments: [
            {
              id: "attachment-1",
              feedbackId: "feedback-1",
              fileName: "image.png",
              contentType: "image/png",
              sizeBytes: 1024,
              sortOrder: 0,
              createdAt: "2026-07-08T08:01:00.000Z"
            }
          ]
        })}
        open
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        getAttachmentObjectUrl={getAttachmentObjectUrl}
      />
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "放大查看 image.png" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "放大查看 image.png" }));

    const preview = screen.getByRole("dialog", { name: "反馈截图预览" });
    expect(preview).toHaveClass("feedback-attachment-preview-dialog");
    expect(within(preview).getByRole("button", { name: "关闭" })).toBeInTheDocument();
    expect(within(preview).queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(within(preview).getByAltText("反馈截图 image.png")).toBeInTheDocument();
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
    expect(within(drawer).queryByRole("button", { name: "关闭反馈" })).not.toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "关闭" })).toBeInTheDocument();
    expect(within(drawer).getByText("已关闭的反馈仅可查看。")).toBeInTheDocument();
  });
});
