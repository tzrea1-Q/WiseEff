import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductFeedbackRepository } from "@/application/ports/ProductFeedbackRepository";
import type { ProductFeedback } from "@/domain/productFeedback/types";
import { MyFeedbackView } from "./MyFeedbackView";
import { FeedbackCenterPage } from "./FeedbackCenterPage";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";

function feedback(overrides: Partial<ProductFeedback> = {}): ProductFeedback {
  return { id: "feedback-1", pagePath: "/logs", pageTitle: "日志分析", feedbackType: "experience", description: "日志加载很慢", status: "open", adminNote: null,
    submittedAt: "2026-07-08T00:00:00.000Z", createdAt: "2026-07-08T00:00:00.000Z", updatedAt: "2026-07-08T00:00:00.000Z", attachments: [], ...overrides };
}
function repository(overrides: Partial<ProductFeedbackRepository> = {}): ProductFeedbackRepository {
  return { submit: vi.fn(), list: vi.fn(), get: vi.fn(), update: vi.fn(), getAttachmentObjectUrl: vi.fn().mockResolvedValue("blob:screenshot"),
    listMine: vi.fn().mockResolvedValue({ items: [feedback()] }), getMine: vi.fn().mockResolvedValue(feedback()), ...overrides };
}
async function beginReply(action = "补充说明") {
  await userEvent.click(await screen.findByRole("button", { name: action }));
  return screen.getByLabelText(action === "补充说明" ? "补充说明" : "说明仍未解决的原因");
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });

describe("MyFeedbackView", () => {
  it("deletes a submitted image within its actual message without discarding an unsent reply", async () => {
    const original = feedback({ attachments: [{ id: "shot", feedbackId: "feedback-1", fileName: "submitted.png", contentType: "image/png", sizeBytes: 20, sortOrder: 0, createdAt: "2026-07-08T00:00:00Z", messageId: "submitted", canDelete: true }],
      progressEvents: [{ id: "submitted", feedbackId: "feedback-1", kind: "submitted", createdAt: "2026-07-08T00:00:00Z" }] });
    const deleteAttachment = vi.fn().mockResolvedValue({ ...original, attachments: [{ ...original.attachments[0], deletedAt: "2026-10-20T12:00:00Z", cleanupPending: false }] });
    render(<MyFeedbackView productFeedbackRepository={repository({ getMine: async () => original, replyToMine: vi.fn(), deleteAttachment })} selectedId="feedback-1" onEditDraft={vi.fn()} />);
    fireEvent.change(await beginReply(), { target: { value: "Keep this unsent explanation" } });
    await userEvent.click(await screen.findByRole("button", { name: "删除已提交截图 submitted.png" }));
    await userEvent.click(screen.getByRole("button", { name: "确认删除截图" }));
    expect(await screen.findByText("截图已删除")).toBeInTheDocument();
    expect(screen.getByLabelText("补充说明")).toHaveValue("Keep this unsent explanation");
    expect(deleteAttachment).toHaveBeenCalledWith("feedback-1", "shot");
  });
  it("shows unknown historical images separately and retries only a visible failed-upload receipt", async () => {
    const old = feedback({ attachments: [{ id: "legacy", feedbackId: "feedback-1", fileName: "legacy.png", contentType: "image/png", sizeBytes: 20, sortOrder: 0,
      createdAt: "2026-07-08T00:00:00Z", messageId: null, uploadedByUserId: null }] });
    const retryAttachmentCleanup = vi.fn().mockRejectedValueOnce(new Error("Storage still offline")).mockResolvedValueOnce({ pendingAttachmentCleanupCount: 0 });
    render(<MyFeedbackView productFeedbackRepository={repository({ getMine: async () => old,
      listMine: async () => ({ items: [old], pendingAttachmentCleanupCount: 2 }), retryAttachmentCleanup })} selectedId="feedback-1" onEditDraft={vi.fn()} />);
    expect(await screen.findByText("历史截图（无法确认所属消息）")).toBeVisible();
    await userEvent.click(await screen.findByRole("button", { name: "重试上传清理" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("存储清理失败，请稍后重试。");
    await userEvent.click(screen.getByRole("button", { name: "重试上传清理" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "重试上传清理" })).toBeNull());
    expect(await screen.findByText("未完成上传对象已清理。")).toBeVisible();
    expect(screen.getByText("legacy.png")).toBeVisible();
    expect(screen.queryByRole("button", { name: "移除截图 legacy.png" })).toBeNull();
  });
  it("gives a reply its own five-image allowance and groups persisted images by the actual message", async () => {
    const attachments = Array.from({ length: 5 }, (_, index) => ({ id: `image-${index}`, feedbackId: "feedback-1", fileName: `initial-${index}.png`,
      contentType: "image/png" as const, sizeBytes: 100, sortOrder: index, createdAt: "2026-07-08T00:00:00.000Z", messageId: "submitted", uploadedByUserId: "user" }));
    const original = feedback({ attachments, progressEvents: [{ id: "submitted", feedbackId: "feedback-1", kind: "submitted", createdAt: "2026-07-08T00:00:00.000Z" }] });
    const replyToMine = vi.fn().mockResolvedValue({ ...original, attachments: [...attachments, { ...attachments[0], id: "reply-image", fileName: "reply-0.png", messageId: "reply" }],
      progressEvents: [...original.progressEvents!, { id: "reply", feedbackId: "feedback-1", kind: "progress", author: "submitter", publicMessage: "More evidence", createdAt: "2026-07-08T01:00:00.000Z" }] });
    render(<MyFeedbackView productFeedbackRepository={repository({ getMine: async () => original, replyToMine })} selectedId="feedback-1" onEditDraft={vi.fn()} />);
    fireEvent.change(await beginReply(), { target: { value: "More evidence" } });
    const files = Array.from({ length: 5 }, (_, index) => new File(["png"], `reply-${index}.png`, { type: "image/png" }));
    fireEvent.change(screen.getByLabelText("选择补充截图"), { target: { files } });
    expect(await screen.findByText(/本次回复：5 \/ 5 张/)).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "发送补充" }));
    await waitFor(() => expect(replyToMine).toHaveBeenCalledWith("feedback-1", { message: "More evidence", files, reopen: false }));
    const message = (await screen.findByText("More evidence")).closest("li")!;
    expect(within(message).getByText("reply-0.png")).toBeVisible();
    expect(within(message).queryByText("initial-0.png")).toBeNull();
  });
  it("loads subsequent cursor pages and sends search/status filters to the repository", async () => {
    const first = Array.from({ length: 50 }, (_, index) => feedback({ id: `first-${index}`, description: `问题 ${index}` }));
    const listMine = vi.fn().mockResolvedValueOnce({ items: first, nextCursor: "older" }).mockResolvedValueOnce({ items: [feedback({ id: "older", description: "更早的问题" })] })
      .mockResolvedValue({ items: [] });
    render(<MyFeedbackView productFeedbackRepository={repository({ listMine })} onEditDraft={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "加载更多反馈" }));
    expect(await screen.findByText("更早的问题")).toBeInTheDocument();
    expect(listMine).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: "older", limit: 30 }));
    fireEvent.change(screen.getByLabelText("搜索我的反馈"), { target: { value: "导出" } });
    await waitFor(() => expect(listMine).toHaveBeenLastCalledWith(expect.objectContaining({ q: "导出", cursor: undefined })));
    await userEvent.click(screen.getByRole("combobox", { name: "筛选反馈状态" }));
    await userEvent.click(screen.getByRole("option", { name: "已解决" }));
    await waitFor(() => expect(listMine).toHaveBeenLastCalledWith(expect.objectContaining({ q: "导出", status: "resolved", cursor: undefined })));
  });

  it("opens fresh details, refreshes them, and keeps draft deletion confirmation visible in detail", async () => {
    const draft = feedback({ id: "draft-1", submittedAt: null, description: "草稿描述" });
    const getMine = vi.fn().mockResolvedValueOnce({ ...draft, description: "服务端最新草稿" }).mockResolvedValue({ ...draft, description: "再次刷新后的描述" });
    const listMine = vi.fn().mockResolvedValueOnce({ items: [draft] }).mockResolvedValue({ items: [] });
    const deleteDraft = vi.fn().mockResolvedValue({ ok: true });
    const onCount = vi.fn();
    render(<MyFeedbackView productFeedbackRepository={repository({ listMine, getMine, deleteDraft })} onEditDraft={vi.fn()} onFeedbackCountChange={onCount} />);
    await userEvent.click(await screen.findByRole("button", { name: "查看反馈：草稿描述" }));
    expect(await screen.findByRole("heading", { name: "服务端最新草稿" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "刷新详情" }));
    expect(await screen.findByRole("heading", { name: "再次刷新后的描述" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "删除草稿" }));
    const confirmation = screen.getByRole("dialog", { name: "确认删除草稿？" });
    await userEvent.click(within(confirmation).getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(deleteDraft).toHaveBeenCalledWith("draft-1"));
    expect(await screen.findByText("暂无提交记录或草稿")).toBeInTheDocument();
    expect(onCount).toHaveBeenLastCalledWith(0);
  });

  it("retains failed supplements and sends reopen reason and attachments through the owner endpoint", async () => {
    const closed = feedback({ status: "closed", resolutionCode: "completed" });
    const replyToMine = vi.fn().mockRejectedValueOnce(new Error("网络暂时不可用")).mockResolvedValue({ ...closed, status: "open", resolutionCode: null });
    render(<MyFeedbackView productFeedbackRepository={repository({ getMine: vi.fn().mockResolvedValue(closed), replyToMine })} selectedId={closed.id} onEditDraft={vi.fn()} />);
    const input = await beginReply("补充并重新打开");
    fireEvent.change(input, { target: { value: "重试后问题仍然存在" } });
    const image = new File(["screenshot"], "reopen.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("选择补充截图"), { target: { files: [image] } });
    await userEvent.click(screen.getByRole("button", { name: "发送并重新打开" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("网络暂时不可用");
    expect(screen.getByLabelText("说明仍未解决的原因")).toHaveValue("重试后问题仍然存在");
    expect(screen.getByText("reopen.png")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "发送并重新打开" }));
    await waitFor(() => expect(replyToMine).toHaveBeenLastCalledWith(closed.id, { message: "重试后问题仍然存在", files: [image], reopen: true }));
    expect(await screen.findByText("反馈已重新打开，团队会继续跟进。")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("reports detail failures with an immediate retry path", async () => {
    const getMine = vi.fn().mockRejectedValueOnce(new Error("连接中断")).mockResolvedValue(feedback());
    render(<MyFeedbackView productFeedbackRepository={repository({ getMine })} selectedId="feedback-1" onEditDraft={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("连接中断");
    await userEvent.click(screen.getByRole("button", { name: "刷新详情" }));
    expect(await screen.findByRole("heading", { name: "日志加载很慢" })).toBeInTheDocument();
  });

  it("restores and clears feedback detail deep links in the standalone center", async () => {
    window.history.replaceState(null, "", "/feedback?id=feedback-1");
    const getMine = vi.fn().mockResolvedValue(feedback());
    render(<FeedbackCenterPage productFeedbackRepository={repository({ getMine })} />);
    expect(await screen.findByRole("heading", { name: "日志加载很慢" })).toBeInTheDocument();
    expect(getMine).toHaveBeenCalledWith("feedback-1");
    expect(screen.getByRole("link", { name: "反馈详情链接" })).toHaveAttribute("href", "/feedback?id=feedback-1");
    await userEvent.click(screen.getByRole("button", { name: "返回反馈列表" }));
    expect(window.location.search).toBe("");
    expect(await screen.findByRole("button", { name: "查看反馈：日志加载很慢" })).toBeInTheDocument();
  });

  it("guards both detail back navigation and SPA navigation with an unsent reply", async () => {
    render(<MyFeedbackView productFeedbackRepository={repository({ replyToMine: vi.fn() })} selectedId="feedback-1" onEditDraft={vi.fn()} />);
    fireEvent.change(await beginReply(), { target: { value: "尚未发送的说明" } });
    await userEvent.click(screen.getByRole("button", { name: "返回反馈列表" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "放弃未发送的补充？" })).getByRole("button", { name: "继续填写" }));
    expect(screen.getByLabelText("补充说明")).toHaveValue("尚未发送的说明");
    let decision: boolean | Promise<boolean> = false;
    act(() => { decision = requestSettingsLeave(); });
    await userEvent.click(within(screen.getByRole("dialog", { name: "放弃未发送的补充？" })).getByRole("button", { name: "放弃并离开" }));
    expect(await decision).toBe(true);
  });

  it("does not overwrite a new detail when an earlier reply finishes late", async () => {
    const other = feedback({ id: "other", description: "另一个问题" });
    let complete!: (value: ProductFeedback) => void;
    const repo = repository({ getMine: vi.fn().mockImplementation((id) => Promise.resolve(id === "other" ? other : feedback())),
      replyToMine: vi.fn().mockImplementation(() => new Promise<ProductFeedback>((resolve) => { complete = resolve; })) });
    const edit = vi.fn();
    const { rerender } = render(<MyFeedbackView productFeedbackRepository={repo} selectedId="feedback-1" onEditDraft={edit} />);
    fireEvent.change(await beginReply(), { target: { value: "给第一个问题的补充" } });
    await userEvent.click(screen.getByRole("button", { name: "发送补充" }));
    rerender(<MyFeedbackView productFeedbackRepository={repo} selectedId="other" onEditDraft={edit} />);
    expect(await screen.findByRole("heading", { name: "另一个问题" })).toBeInTheDocument();
    await act(async () => complete(feedback({ description: "迟到的旧响应" })));
    expect(screen.getByRole("heading", { name: "另一个问题" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "迟到的旧响应" })).not.toBeInTheDocument();
  });

  it("focuses detail on its current action and restores list actions after guarded navigation", async () => {
    window.history.replaceState(null, "", "/feedback?id=feedback-1");
    render(<FeedbackCenterPage productFeedbackRepository={repository({ replyToMine: vi.fn() })} />);
    fireEvent.change(await beginReply(), { target: { value: "尚未发送，先不新建" } });
    expect(screen.queryByRole("button", { name: "提交反馈" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "返回反馈列表" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "放弃未发送的补充？" })).getByRole("button", { name: "继续填写" }));
    expect(screen.queryByRole("dialog", { name: "问题反馈" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("补充说明")).toHaveValue("尚未发送，先不新建");
    await userEvent.click(screen.getByRole("button", { name: "返回反馈列表" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "放弃未发送的补充？" })).getByRole("button", { name: "放弃并离开" }));
    expect(screen.getByRole("button", { name: "提交反馈" })).toBeInTheDocument();
  });

  it("uses the shell-approved search prop instead of raw popstate while the shell owns navigation", async () => {
    const repo = repository({ getMine: vi.fn().mockImplementation((id) => Promise.resolve(feedback({ id, description: id === "other" ? "另一个问题" : "当前问题" }))) });
    const { rerender } = render(<FeedbackCenterPage productFeedbackRepository={repo} search="?id=feedback-1" />);
    expect(await screen.findByRole("heading", { name: "当前问题" })).toBeInTheDocument();
    act(() => { window.history.replaceState(null, "", "/feedback?id=other"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(screen.getByRole("heading", { name: "当前问题" })).toBeInTheDocument();
    rerender(<FeedbackCenterPage productFeedbackRepository={repo} search="?id=other" />);
    expect(await screen.findByRole("heading", { name: "另一个问题" })).toBeInTheDocument();
  });

  it("ignores a detail refresh snapshot that returns after a successful supplement", async () => {
    let completeRefresh!: (value: ProductFeedback) => void;
    const getMine = vi.fn().mockResolvedValueOnce(feedback()).mockImplementationOnce(() => new Promise<ProductFeedback>((resolve) => { completeRefresh = resolve; }));
    const updated = feedback({ description: "发送补充后的最新详情", latestPublicProgress: "补充已记录" });
    render(<MyFeedbackView productFeedbackRepository={repository({ getMine, replyToMine: vi.fn().mockResolvedValue(updated) })} selectedId="feedback-1" onEditDraft={vi.fn()} />);
    fireEvent.change(await beginReply(), { target: { value: "新信息" } });
    await userEvent.click(screen.getByRole("button", { name: "刷新详情" }));
    await userEvent.click(screen.getByRole("button", { name: "发送补充" }));
    expect(await screen.findByRole("heading", { name: "发送补充后的最新详情" })).toBeInTheDocument();
    await act(async () => completeRefresh(feedback({ description: "迟到的刷新结果" })));
    expect(screen.getByRole("heading", { name: "发送补充后的最新详情" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "迟到的刷新结果" })).not.toBeInTheDocument();
  });

  it("uses the closed feedback entry as the reopen intent and blocks detail-link navigation during send", async () => {
    let complete!: (value: ProductFeedback) => void;
    const closed = feedback({ status: "closed" });
    const replyToMine = vi.fn().mockImplementation(() => new Promise<ProductFeedback>((resolve) => { complete = resolve; }));
    render(<MyFeedbackView productFeedbackRepository={repository({ getMine: vi.fn().mockResolvedValue(closed), replyToMine })} selectedId="feedback-1" onEditDraft={vi.fn()} />);
    const input = await beginReply("补充并重新打开");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送并重新打开" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "问题仍未解决" } });
    await userEvent.click(screen.getByRole("button", { name: "发送并重新打开" }));
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => { screen.getByRole("link", { name: "反馈详情链接" }).dispatchEvent(click); });
    expect(click.defaultPrevented).toBe(true);
    expect(screen.queryByRole("dialog", { name: "放弃未发送的补充？" })).not.toBeInTheDocument();
    await act(async () => complete(feedback()));
    expect(replyToMine).toHaveBeenCalledWith("feedback-1", { message: "问题仍未解决", files: [], reopen: true });
  });

  it("opens as a reading view and only shows description lines not already used as the title", async () => {
    const description = "导出文件内容缺失\n步骤：在日志页面导出文件。\n实际结果：缺少最后一行。";
    render(<MyFeedbackView productFeedbackRepository={repository({ getMine: vi.fn().mockResolvedValue(feedback({ description })), replyToMine: vi.fn() })} selectedId="feedback-1" onEditDraft={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "导出文件内容缺失" })).toBeInTheDocument();
    expect(screen.getAllByText("导出文件内容缺失")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "问题详情" })).toHaveTextContent("步骤：在日志页面导出文件。");
    expect(screen.getByRole("heading", { name: "处理记录" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加截图" })).not.toBeInTheDocument();
  });

  it("keeps normal supplements separate from the resolved-feedback reopen entry", async () => {
    const resolved = feedback({ status: "resolved", resolutionCode: "completed" });
    const replyToMine = vi.fn().mockResolvedValueOnce(resolved).mockResolvedValueOnce({ ...resolved, status: "in_progress", resolutionCode: null });
    render(<MyFeedbackView productFeedbackRepository={repository({ getMine: vi.fn().mockResolvedValue(resolved), replyToMine })} selectedId="feedback-1" onEditDraft={vi.fn()} />);
    fireEvent.change(await beginReply(), { target: { value: "补充一个已确认的细节" } });
    await userEvent.click(screen.getByRole("button", { name: "发送补充" }));
    await waitFor(() => expect(replyToMine).toHaveBeenLastCalledWith("feedback-1", { message: "补充一个已确认的细节", files: [], reopen: false }));
    fireEvent.change(await beginReply("问题仍未解决"), { target: { value: "重试后依然无法导出" } });
    await userEvent.click(screen.getByRole("button", { name: "发送并重新打开" }));
    await waitFor(() => expect(replyToMine).toHaveBeenLastCalledWith("feedback-1", { message: "重试后依然无法导出", files: [], reopen: true }));
  });

  it("explicitly cancels and discards an unsent reply and attachments", async () => {
    const replyToMine = vi.fn();
    const onStateChange = vi.fn();
    render(<MyFeedbackView productFeedbackRepository={repository({ replyToMine })} selectedId="feedback-1" onEditDraft={vi.fn()} onStateChange={onStateChange} />);
    fireEvent.change(await beginReply(), { target: { value: "决定暂不发送" } });
    fireEvent.change(screen.getByLabelText("选择补充截图"), { target: { files: [new File(["png"], "cancelled.png", { type: "image/png" })] } });
    expect(onStateChange).toHaveBeenLastCalledWith({ dirty: true, pending: false });
    await userEvent.click(screen.getByRole("button", { name: "取消补充" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(replyToMine).not.toHaveBeenCalled();
    expect(onStateChange).toHaveBeenLastCalledWith({ dirty: false, pending: false });
    expect(await beginReply()).toHaveValue("");
    expect(screen.queryByText("cancelled.png")).not.toBeInTheDocument();
  });

  it("preserves a typed supplement and attachment when refresh reveals the feedback was closed", async () => {
    const closed = feedback({ status: "closed", resolutionCode: "completed" });
    const getMine = vi.fn().mockResolvedValueOnce(feedback()).mockResolvedValueOnce(closed);
    const replyToMine = vi.fn().mockResolvedValue({ ...closed, status: "in_progress", resolutionCode: null });
    render(<MyFeedbackView productFeedbackRepository={repository({ getMine, replyToMine })} selectedId="feedback-1" onEditDraft={vi.fn()} />);
    fireEvent.change(await beginReply(), { target: { value: "补充的复现步骤" } });
    const file = new File(["png"], "retained-supplement.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("选择补充截图"), { target: { files: [file] } });
    await userEvent.click(screen.getByRole("button", { name: "刷新详情" }));
    expect(await screen.findByText("此反馈刚刚被关闭。补充内容已保留，发送前需重新打开反馈。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送补充" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "改为补充并重新打开" }));
    expect(screen.getByLabelText("说明仍未解决的原因")).toHaveValue("补充的复现步骤");
    expect(screen.getByLabelText("说明仍未解决的原因")).toHaveFocus();
    expect(screen.getByText("retained-supplement.png")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "发送并重新打开" }));
    await waitFor(() => expect(replyToMine).toHaveBeenCalledWith("feedback-1", { message: "补充的复现步骤", files: [file], reopen: true }));
  });

  it("preserves a reopen draft when refresh reveals that the team already reopened the feedback", async () => {
    const closed = feedback({ status: "closed", resolutionCode: "completed" });
    const reopened = feedback({ status: "in_progress", resolutionCode: null });
    const getMine = vi.fn().mockResolvedValueOnce(closed).mockResolvedValueOnce(reopened);
    const replyToMine = vi.fn().mockResolvedValue(reopened);
    render(<MyFeedbackView productFeedbackRepository={repository({ getMine, replyToMine })} selectedId="feedback-1" onEditDraft={vi.fn()} />);
    fireEvent.change(await beginReply("补充并重新打开"), { target: { value: "还需要补充的步骤" } });
    const file = new File(["png"], "reopen-draft.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("选择补充截图"), { target: { files: [file] } });
    await userEvent.click(screen.getByRole("button", { name: "刷新详情" }));
    expect(await screen.findByText("此反馈已重新打开，无需重复操作。补充内容已保留。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送并重新打开" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "改为普通补充" }));
    expect(screen.getByLabelText("补充说明")).toHaveValue("还需要补充的步骤");
    expect(screen.getByLabelText("补充说明")).toHaveFocus();
    expect(screen.getByText("reopen-draft.png")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "发送补充" }));
    await waitFor(() => expect(replyToMine).toHaveBeenCalledWith("feedback-1", { message: "还需要补充的步骤", files: [file], reopen: false }));
  });
});
