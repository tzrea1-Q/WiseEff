import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptFeedbackFiles, FeedbackAttachments } from "./FeedbackAttachments";

const attachment = { id: "shot-1", feedbackId: "feedback-1", fileName: "problem.png", contentType: "image/png" as const,
  sizeBytes: 100, sortOrder: 0, createdAt: "2026-07-08T00:00:00.000Z" };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("feedback attachments", () => {
  it("confirms the target, keeps a failed deletion retryable, and renders a deleted message marker without fetching content", async () => {
    const getUrl = vi.fn().mockResolvedValue("blob:original"), onDelete = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const { rerender } = render(<FeedbackAttachments feedbackId="feedback-1" attachments={[{ ...attachment, canDelete: true }]} getAttachmentObjectUrl={getUrl} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: "删除已提交截图 problem.png" }));
    expect(screen.getByRole("dialog", { name: "删除这张已提交截图？" })).toHaveTextContent("problem.png");
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "删除已提交截图 problem.png" }));
    await userEvent.click(screen.getByRole("button", { name: "确认删除截图" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("删除截图失败");
    await userEvent.click(screen.getByRole("button", { name: "确认删除截图" }));
    expect(onDelete).toHaveBeenCalledTimes(2);
    rerender(<FeedbackAttachments feedbackId="feedback-1" attachments={[{ ...attachment, canDelete: true, deletedAt: "2026-10-20T12:00:00Z", cleanupPending: true }]} getAttachmentObjectUrl={getUrl} onDelete={onDelete} />);
    expect(screen.getByText("截图已删除")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /下载/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试文件清理" })).toBeInTheDocument();
    expect(getUrl).toHaveBeenCalledTimes(1);
  });
  it("validates image type, count, individual size, and combined retained/new size", () => {
    const image = new File(["image"], "image.png", { type: "image/png" });
    expect(acceptFeedbackFiles([new File(["text"], "text.txt", { type: "text/plain" })], 0, 0).accepted).toEqual([]);
    expect(acceptFeedbackFiles([image], 5, 100).error).toContain("最多可附加 5 张");
    expect(acceptFeedbackFiles([new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })], 0, 0).error).toContain("5 MB");
    expect(acceptFeedbackFiles([image], 3, 15 * 1024 * 1024).error).toContain("15 MB");
    expect(acceptFeedbackFiles([image], 4, 0).accepted).toEqual([image]);
  });
  it("retries failed downloads, opens the original image, and releases object URLs", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const getUrl = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue("blob:original");
    const { unmount } = render(<FeedbackAttachments feedbackId="feedback-1" attachments={[attachment]} getAttachmentObjectUrl={getUrl} />);
    expect(await screen.findByText("截图加载失败")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    await userEvent.click(await screen.findByRole("button", { name: "放大截图 problem.png" }));
    expect(screen.getByRole("dialog", { name: "problem.png" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载截图" })).toHaveAttribute("download", "problem.png");
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:original");
  });
  it("releases an attachment response that arrives after unmount", async () => {
    let complete!: (url: string) => void;
    const getUrl = vi.fn().mockImplementation(() => new Promise<string>((resolve) => { complete = resolve; }));
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { unmount } = render(<FeedbackAttachments feedbackId="feedback-1" attachments={[attachment]} getAttachmentObjectUrl={getUrl} />);
    unmount(); complete("blob:late");
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:late"));
  });
});
