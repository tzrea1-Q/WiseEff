import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectControlOption } from "@/test/selectControlOption";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import type { ProductFeedback } from "@/domain/productFeedback/types";
import { FeedbackAdminDrawer, type FeedbackAdminDrawerProps } from "./FeedbackAdminDrawer";

function feedback(overrides: Partial<ProductFeedback> = {}): ProductFeedback {
  return { id: "feedback-1", pagePath: "/logs", pageTitle: "日志智能分析", feedbackType: "experience", description: "上传日志后没有看到进度提示", status: "open", adminNote: null, createdAt: "2026-07-08T08:00:00.000Z", updatedAt: "2026-07-08T08:00:00.000Z", attachments: [], ...overrides };
}
function renderDrawer(overrides: Partial<FeedbackAdminDrawerProps> = {}) {
  const props: FeedbackAdminDrawerProps = { feedback: feedback(), open: true, onClose: vi.fn(), onUpdate: vi.fn().mockResolvedValue(feedback()), onAppendProgress: vi.fn().mockResolvedValue(feedback()), getAttachmentObjectUrl: vi.fn().mockResolvedValue("blob:feedback-image"), ...overrides };
  return { ...props, ...render(<FeedbackAdminDrawer {...props} />) };
}
function beginPublicReply(text: string) {
  fireEvent.click(screen.getByRole("button", { name: /回复提交人/ }));
  fireEvent.change(screen.getByLabelText("公开回复"), { target: { value: text } });
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("FeedbackAdminDrawer", () => {
  it("presents a focused page article with read-only metadata and no default editing fields", () => {
    renderDrawer({ feedback: feedback({ description: "上传日志后没有看到进度提示\n完整步骤与证据", submitter: { id: "user-1", name: "李四", username: "lisi" }, progressEvents: [{ id: "event-1", feedbackId: "feedback-1", kind: "progress", publicMessage: "已定位问题", internalMessage: "仅内部可见", createdAt: "2026-07-08T09:00:00.000Z" }] }) });
    const detail = screen.getByRole("article", { name: "上传日志后没有看到进度提示" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(detail).getAllByText("上传日志后没有看到进度提示")).toHaveLength(1);
    expect(within(detail).getByText("完整步骤与证据")).toBeInTheDocument();
    expect(within(detail).getAllByText("/logs")).toHaveLength(1);
    expect(within(detail).getByText("李四 (@lisi)")).toBeInTheDocument();
    expect(within(detail).getByText("已定位问题")).toBeInTheDocument();
    expect(within(detail).getByText("仅内部可见")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /附件/ })).not.toBeInTheDocument();
  });

  it("keeps all text when the first description line exceeds the 100-character title", () => {
    const longLine = "长".repeat(100) + "不能丢失的尾部内容";
    renderDrawer({ feedback: feedback({ description: `${longLine}\n后续复现步骤` }) });
    expect(screen.getByRole("heading", { name: "长".repeat(100) })).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.tagName === "P" && node.textContent === `${longLine}\n后续复现步骤`)).toHaveTextContent("不能丢失的尾部内容");
  });

  it("keeps public and internal drafts separate and sends only the chosen visibility", async () => {
    const props = renderDrawer({ feedback: feedback({ status: "resolved", adminNote: "历史备注" }) });
    expect(screen.getByText("历史备注")).toBeInTheDocument();
    beginPublicReply("给提交人的公开进展");
    fireEvent.click(screen.getByRole("radio", { name: /^内部备注/ }));
    expect(screen.getByLabelText("内部备注")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("内部备注"), { target: { value: "内部排查信息" } });
    fireEvent.click(screen.getByRole("radio", { name: /^公开回复/ }));
    expect(screen.getByLabelText("公开回复")).toHaveValue("给提交人的公开进展");
    fireEvent.click(screen.getByRole("button", { name: "发送回复" }));
    await waitFor(() => expect(props.onAppendProgress).toHaveBeenCalledWith("feedback-1", { publicMessage: "给提交人的公开进展", internalMessage: null }));
    expect(screen.getByLabelText("公开回复")).toHaveValue("");
    fireEvent.click(screen.getByRole("radio", { name: /^内部备注/ }));
    expect(screen.getByLabelText("内部备注")).toHaveValue("内部排查信息");
    fireEvent.click(screen.getByRole("button", { name: "保存内部备注" }));
    await waitFor(() => expect(props.onAppendProgress).toHaveBeenLastCalledWith("feedback-1", { publicMessage: null, internalMessage: "内部排查信息" }));
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it("starts processing immediately without consuming either reply draft", async () => {
    const props = renderDrawer();
    beginPublicReply("尚未发送的公开回复");
    fireEvent.click(screen.getByRole("radio", { name: /^内部备注/ }));
    fireEvent.change(screen.getByLabelText("内部备注"), { target: { value: "尚未保存的内部备注" } });
    fireEvent.click(screen.getByRole("button", { name: "开始处理" }));
    await waitFor(() => expect(props.onAppendProgress).toHaveBeenCalledWith("feedback-1", { toStatus: "in_progress", publicMessage: null, internalMessage: null }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("内部备注")).toHaveValue("尚未保存的内部备注");
    fireEvent.click(screen.getByRole("radio", { name: /^公开回复/ }));
    expect(screen.getByLabelText("公开回复")).toHaveValue("尚未发送的公开回复");
  });

  it("uses a focused resolve task and renders validation inside that modal", async () => {
    const props = renderDrawer({ feedback: feedback({ status: "in_progress" }) });
    expect(screen.queryByRole("button", { name: "关闭反馈" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "标记解决" }));
    const task = screen.getByRole("dialog", { name: "标记解决" });
    fireEvent.click(within(task).getByRole("button", { name: "确认解决" }));
    expect(within(task).getByRole("alert")).toHaveTextContent("请填写处理说明。");
    expect(props.onAppendProgress).not.toHaveBeenCalled();
    fireEvent.change(within(task).getByLabelText("处理说明"), { target: { value: "已在热修复补丁中解决" } });
    fireEvent.click(within(task).getByRole("button", { name: "确认解决" }));
    await waitFor(() => expect(props.onAppendProgress).toHaveBeenCalledWith("feedback-1", { toStatus: "resolved", resolutionCode: "completed", publicMessage: "已在热修复补丁中解决", internalMessage: null }));
  });

  it("closes resolved feedback with an accurate explanation and keeps its resolution", async () => {
    const props = renderDrawer({ feedback: feedback({ status: "resolved", resolutionCode: "duplicate" }) });
    fireEvent.click(screen.getByRole("button", { name: "关闭反馈" }));
    const task = screen.getByRole("dialog", { name: "关闭反馈" });
    expect(props.onAppendProgress).not.toHaveBeenCalled();
    expect(within(task).getByText(/关闭后仍可重新打开/)).toBeInTheDocument();
    fireEvent.change(within(task).getByLabelText("处理说明"), { target: { value: "已关联到同一问题，确认关闭" } });
    fireEvent.click(within(task).getByRole("button", { name: "确认关闭" }));
    await waitFor(() => expect(props.onAppendProgress).toHaveBeenCalledWith("feedback-1", { toStatus: "closed", resolutionCode: "duplicate", publicMessage: "已关联到同一问题，确认关闭", internalMessage: null }));
  });

  it("reopens closed feedback only after collecting a public reason", async () => {
    const props = renderDrawer({ feedback: feedback({ status: "closed" }) });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新打开" }));
    const task = screen.getByRole("dialog", { name: "重新打开" });
    fireEvent.click(within(task).getByRole("button", { name: "确认重新打开" }));
    expect(within(task).getByRole("alert")).toHaveTextContent("请填写重新打开原因");
    fireEvent.change(within(task).getByLabelText("重新打开原因"), { target: { value: "特定设备仍可复现" } });
    fireEvent.click(within(task).getByRole("button", { name: "确认重新打开" }));
    await waitFor(() => expect(props.onAppendProgress).toHaveBeenCalledWith("feedback-1", { toStatus: "in_progress", publicMessage: "特定设备仍可复现", internalMessage: null }));
  });

  it("preserves typed task reasons on Escape and backdrop until discard is confirmed", () => {
    renderDrawer({ feedback: feedback({ status: "in_progress" }) });
    beginPublicReply("独立的回复草稿");
    fireEvent.click(screen.getByRole("button", { name: "标记解决" }));
    let task = screen.getByRole("dialog", { name: "标记解决" });
    fireEvent.change(within(task).getByLabelText("处理说明"), { target: { value: "未提交的处理说明" } });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(within(task).getByLabelText("处理说明")).toHaveValue("未提交的处理说明");
    const backdrop = task.parentElement!;
    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);
    fireEvent.click(screen.getByRole("button", { name: "放弃说明" }));
    expect(task).not.toBeInTheDocument();
    expect(screen.getByLabelText("公开回复")).toHaveValue("独立的回复草稿");
    fireEvent.click(screen.getByRole("button", { name: "标记解决" }));
    task = screen.getByRole("dialog", { name: "标记解决" });
    expect(within(task).getByLabelText("处理说明")).toHaveValue("");
    fireEvent.change(within(task).getByLabelText("处理说明"), { target: { value: "显式取消的说明" } });
    fireEvent.click(within(task).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("公开回复")).toHaveValue("独立的回复草稿");
  });

  it("keeps independent reply drafts visible and read-only if the feedback closes", async () => {
    const { rerender, ...props } = renderDrawer({ feedback: feedback({ status: "resolved" }) });
    beginPublicReply("关闭前尚未发送的回复");
    fireEvent.click(screen.getByRole("radio", { name: /^内部备注/ }));
    fireEvent.change(screen.getByLabelText("内部备注"), { target: { value: "关闭前的内部草稿" } });
    rerender(<FeedbackAdminDrawer {...props} feedback={feedback({ status: "closed" })} />);
    expect(screen.getByLabelText("内部备注")).toHaveValue("关闭前的内部草稿");
    expect(screen.getByLabelText("内部备注")).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /^公开回复/ }));
    expect(screen.getByLabelText("公开回复")).toHaveValue("关闭前尚未发送的回复");
    expect(screen.getByLabelText("公开回复")).toBeDisabled();
  });

  it("keeps replies after cancelled page leave and discards only on confirmation", () => {
    const props = renderDrawer();
    beginPublicReply("尚未保存");
    fireEvent.click(screen.getByRole("button", { name: "返回反馈列表" }));
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("公开回复")).toHaveValue("尚未保存");
    fireEvent.click(screen.getByRole("button", { name: "返回反馈列表" }));
    fireEvent.click(screen.getByRole("button", { name: "放弃并返回" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("uses the existing shell guard and reuses its pending leave decision", async () => {
    renderDrawer(); beginPublicReply("导航时保留");
    let first!: boolean | Promise<boolean>; let second!: boolean | Promise<boolean>;
    act(() => { first = requestSettingsLeave(); second = requestSettingsLeave(); });
    expect(first).toBe(second); expect(first).toBeInstanceOf(Promise);
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(await first).toBe(false);
    expect(screen.getByLabelText("公开回复")).toHaveValue("导航时保留");
  });

  it("locks page, task dismissal and shell navigation during save, retaining failed input", async () => {
    let reject!: (error: Error) => void;
    const props = renderDrawer({ feedback: feedback({ status: "in_progress" }), onAppendProgress: vi.fn().mockReturnValue(new Promise((_, fail) => { reject = fail; })) });
    fireEvent.click(screen.getByRole("button", { name: "标记解决" }));
    const task = screen.getByRole("dialog", { name: "标记解决" });
    fireEvent.change(within(task).getByLabelText("处理说明"), { target: { value: "待保存说明" } });
    fireEvent.click(within(task).getByRole("button", { name: "确认解决" }));
    expect(screen.getByRole("button", { name: "返回反馈列表" })).toBeDisabled();
    expect(within(task).getByRole("button", { name: "取消" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(task.parentElement!); fireEvent.pointerUp(task.parentElement!);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "放弃未保存的修改？" })).not.toBeInTheDocument();
    expect(requestSettingsLeave()).toBe(false);
    await act(async () => reject(new Error("保存失败")));
    expect(within(task).getByRole("alert")).toHaveTextContent("保存失败");
    expect(within(task).getByLabelText("处理说明")).toHaveValue("待保存说明");
  });

  it("locks both refresh entries while a reply is unsent or its save is pending", async () => {
    let complete!: (value: ProductFeedback) => void;
    const props = renderDrawer({ loadError: "先前刷新失败", onRefresh: vi.fn(), onAppendProgress: vi.fn().mockReturnValue(new Promise<ProductFeedback>((resolve) => { complete = resolve; })) });
    const refresh = screen.getByRole("button", { name: "刷新反馈详情" });
    const retry = screen.getByRole("button", { name: "重新加载详情" });
    expect(refresh).not.toBeDisabled(); expect(retry).not.toBeDisabled();
    beginPublicReply("尚未发送的回复");
    expect(refresh).toBeDisabled(); expect(retry).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "发送回复" }));
    expect(screen.getByLabelText("公开回复")).toBeDisabled();
    expect(refresh).toBeDisabled(); expect(retry).toBeDisabled();
    fireEvent.click(refresh); fireEvent.click(retry);
    expect(props.onRefresh).not.toHaveBeenCalled();
    await act(async () => complete(feedback()));
    expect(refresh).not.toBeDisabled(); expect(retry).not.toBeDisabled();
  });

  it("opens routing edits on demand, then saves priority and eligible assignee explicitly", async () => {
    const props = renderDrawer({ listAssignees: vi.fn().mockResolvedValue([{ id: "owner-1", name: "负责人", username: "owner" }]) });
    expect(props.listAssignees).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    await waitFor(() => expect(screen.getByLabelText("负责人")).not.toBeDisabled());
    await selectControlOption(screen.getByLabelText("优先级"), "high");
    await selectControlOption(screen.getByLabelText("负责人"), "owner-1");
    expect(props.onUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存安排" }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith("feedback-1", { priority: "high", assigneeUserId: "owner-1" }));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("cancels routing edits without changing saved metadata", async () => {
    const props = renderDrawer({ feedback: feedback({ priority: "low" }) });
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    await selectControlOption(screen.getByLabelText("优先级"), "high");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText("低优先级")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByLabelText("优先级")).toHaveAttribute("data-value", "low");
  });

  it("shows the newest four journal entries and expands older evidence newest first", () => {
    renderDrawer({ feedback: feedback({ progressEvents: Array.from({ length: 6 }, (_, index) => ({ id: `event-${index}`, feedbackId: "feedback-1", kind: "progress" as const, publicMessage: `记录 ${index + 1}`, createdAt: `2026-07-08T0${index}:00:00.000Z` })) }) });
    const timeline = screen.getByRole("list", { name: "反馈处理记录" });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(4);
    expect(within(timeline).queryByText("记录 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看更早的 2 条记录" }));
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(6);
    expect(within(timeline).getAllByRole("listitem").map((item) => item.textContent?.match(/记录 \d/)?.[0])).toEqual(["记录 6", "记录 5", "记录 4", "记录 3", "记录 2", "记录 1"]);
  });

  it("shares screenshot retry, zoom, download and focus return without closing the page", async () => {
    const getAttachmentObjectUrl = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("blob:preview-image");
    renderDrawer({ getAttachmentObjectUrl, feedback: feedback({ attachments: [{ id: "attachment-1", feedbackId: "feedback-1", fileName: "image.png", contentType: "image/png", sizeBytes: 1024, sortOrder: 0, createdAt: "2026-07-08T08:01:00.000Z" }] }) });
    fireEvent.click(await screen.findByRole("button", { name: "重试" }));
    const thumbnail = await screen.findByRole("button", { name: "放大截图 image.png" });
    thumbnail.focus(); fireEvent.click(thumbnail);
    const preview = screen.getByRole("dialog", { name: "image.png" });
    expect(within(preview).getByRole("link", { name: "下载截图" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("article", { name: "上传日志后没有看到进度提示" })).toBeInTheDocument();
    expect(thumbnail).toHaveFocus();
  });
});
