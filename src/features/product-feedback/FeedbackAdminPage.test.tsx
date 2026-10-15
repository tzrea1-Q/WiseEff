import { selectControlOption } from "@/test/selectControlOption";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRequiredRoleForPage } from "@/app/permissions";
import type { ProductFeedbackRepository } from "@/application/ports/ProductFeedbackRepository";
import type { ProductFeedback } from "@/domain/productFeedback/types";
import { FeedbackAdminPage } from "./FeedbackAdminPage";

function feedback(overrides: Partial<ProductFeedback> = {}): ProductFeedback {
  return { id: "feedback-1", pagePath: "/parameter-home", pageTitle: "我的工作台", feedbackType: "experience", description: "页面切换后筛选条件丢失", status: "open", adminNote: null, createdAt: "2026-07-08T08:00:00.000Z", updatedAt: "2026-07-08T08:00:00.000Z", attachments: [], ...overrides };
}
function createRepository(items: ProductFeedback[], overrides: Partial<ProductFeedbackRepository> = {}): ProductFeedbackRepository {
  return {
    submit: vi.fn(), list: vi.fn().mockResolvedValue({ items }),
    get: vi.fn().mockImplementation(async (id: string) => items.find((item) => item.id === id) ?? null),
    update: vi.fn().mockImplementation(async (id: string, patch) => ({ ...items.find((item) => item.id === id), ...patch })),
    appendProgress: vi.fn().mockImplementation(async (id: string, input) => ({ ...items.find((item) => item.id === id), status: input.toStatus ?? "open" })),
    getAttachmentObjectUrl: vi.fn().mockResolvedValue("blob:feedback-image"), ...overrides
  };
}
async function renderPage(repository = createRepository([feedback()])) {
  render(<FeedbackAdminPage productFeedbackRepository={repository} />);
  await waitFor(() => expect(document.querySelector('table[aria-label="产品反馈记录"]')).not.toBeNull());
  return repository;
}
beforeEach(() => window.history.replaceState(null, "", "/feedback-admin"));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("FeedbackAdminPage", () => {
  it("uses the issue summary as the primary row content and one stable detail action", async () => {
    await renderPage(createRepository([feedback({ description: "按钮状态不清楚\n点击没有反馈" }), feedback({ id: "closed", pageTitle: "日志智能分析", pagePath: "/logs", feedbackType: "data", status: "closed", description: "温升结论和证据不一致" })]));
    const table = screen.getByRole("table", { name: "产品反馈记录" });
    expect(within(table).getByText("按钮状态不清楚")).toHaveClass("feedback-admin-summary__title");
    expect(within(table).getByText("我的工作台")).toBeInTheDocument();
    expect(within(table).getByText("/parameter-home")).toBeInTheDocument();
    expect(within(table).getByText(/数据问题/)).toBeInTheDocument();
    expect(within(table).getAllByRole("button", { name: "查看" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /查看进展|更多/ })).not.toBeInTheDocument();
  });

  it.each([
    [{ submitterUserId: null }, "已注销用户"],
    [{}, "内测用户"],
    [{ submitter: { id: "user-1", name: "张三", username: "zhangsan" } }, "张三 (@zhangsan)"]
  ])("keeps submitter provenance meaningful (%s)", async (overrides, label) => {
    await renderPage(createRepository([feedback(overrides)]));
    expect(within(screen.getByRole("table")).getByText(label)).toBeInTheDocument();
  });

  it("uses compact state counts to filter and persists filters in the URL", async () => {
    await renderPage(createRepository([feedback(), feedback({ id: "progress", description: "正在排查的问题", status: "in_progress", priority: "high" })], { getStats: vi.fn().mockResolvedValue({ total: 2, open: 1, inProgress: 1, resolved: 0, closed: 0 }) }));
    fireEvent.click(screen.getByRole("button", { name: "处理中 1" }));
    expect(within(screen.getByRole("table")).queryByText("页面切换后筛选条件丢失")).not.toBeInTheDocument();
    expect(screen.getByText("显示 1 / 2 条")).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("status")).toBe("in_progress");
    await selectControlOption(screen.getByLabelText("优先级筛选"), "high");
    expect(new URLSearchParams(window.location.search).get("priority")).toBe("high");
  });

  it("loads all cursor pages before searching, including feedback after the first 50 rows", async () => {
    const first = Array.from({ length: 50 }, (_, index) => feedback({ id: `first-${index}`, description: `普通记录 ${index}` }));
    const repository = createRepository([], { list: vi.fn().mockResolvedValueOnce({ items: first, nextCursor: "cursor-50" }).mockResolvedValueOnce({ items: [feedback({ id: "older", description: "旧反馈仍可检索" })] }) });
    await renderPage(repository);
    expect(repository.list).toHaveBeenNthCalledWith(2, { cursor: "cursor-50" });
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索反馈" }), { target: { value: "旧反馈" } });
    expect(screen.getByText("旧反馈仍可检索")).toBeInTheDocument();
    expect(screen.getByText("显示 1 / 51 条")).toBeInTheDocument();
  });

  it("loads bookmarked details independently from the inbox and refreshes the detail", async () => {
    window.history.replaceState(null, "", "/feedback-admin?id=older&status=resolved");
    const repository = createRepository([], { get: vi.fn().mockResolvedValueOnce(feedback({ id: "older", description: "链接打开的问题" })).mockResolvedValueOnce(feedback({ id: "older", description: "链接打开的问题", latestPublicProgress: "已更新" })) });
    await renderPage(repository);
    const detail = await screen.findByRole("article", { name: "链接打开的问题" });
    expect(repository.get).toHaveBeenCalledWith("older");
    fireEvent.click(within(detail).getByRole("button", { name: "刷新反馈详情" }));
    await waitFor(() => expect(repository.get).toHaveBeenCalledTimes(2));
  });

  it("follows shell-approved same-route deep links and synchronizes local search changes", async () => {
    const repository = createRepository([feedback(), feedback({ id: "feedback-2", description: "通知链接打开的问题", status: "in_progress" })]);
    const onSearchChange = vi.fn();
    const { rerender } = render(<FeedbackAdminPage productFeedbackRepository={repository} search="" onSearchChange={onSearchChange} />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索反馈" }), { target: { value: "通知" } });
    expect(onSearchChange).toHaveBeenCalledWith("?q=%E9%80%9A%E7%9F%A5");
    rerender(<FeedbackAdminPage productFeedbackRepository={repository} search="?id=feedback-2&status=in_progress" onSearchChange={onSearchChange} />);
    const detail = await screen.findByRole("article", { name: "通知链接打开的问题" });
    expect(detail).toBeInTheDocument();
    expect(repository.get).toHaveBeenCalledWith("feedback-2");
    fireEvent.click(within(detail).getByRole("button", { name: "返回反馈列表" }));
    expect(screen.getByRole("button", { name: "处理中 1" })).toHaveAttribute("aria-pressed", "true");
  });

  it("records status changes through the journal and refreshes stats after all mutations", async () => {
    const repository = createRepository([feedback()], { getStats: vi.fn().mockResolvedValueOnce({ total: 1, open: 1, inProgress: 0, resolved: 0, closed: 0 }).mockResolvedValue({ total: 1, open: 0, inProgress: 1, resolved: 0, closed: 0 }) });
    await renderPage(repository);
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "查看" }));
    const detail = await screen.findByRole("article", { name: "页面切换后筛选条件丢失" });
    fireEvent.click(within(detail).getByRole("button", { name: "开始处理" }));
    await waitFor(() => expect(repository.appendProgress).toHaveBeenCalledWith("feedback-1", { toStatus: "in_progress", publicMessage: null, internalMessage: null }));
    expect(repository.update).not.toHaveBeenCalled();
    await waitFor(() => expect(repository.getStats).toHaveBeenCalledTimes(2));
    await within(detail).findByText("已开始处理。");
    fireEvent.click(within(detail).getByRole("button", { name: "返回反馈列表" }));
    expect(screen.getByRole("button", { name: "处理中 1" })).toBeInTheDocument();
  });

  it("restores filters on browser history navigation", async () => {
    await renderPage(createRepository([feedback(), feedback({ id: "closed", description: "已关闭的问题", status: "closed" })]));
    act(() => { window.history.replaceState(null, "", "/feedback-admin?status=closed"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(screen.getByRole("button", { name: "已关闭 1" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("table")).queryByText("页面切换后筛选条件丢失")).not.toBeInTheDocument();
  });

  it("hides the mounted inbox and restores its filters, page and trigger focus on return", async () => {
    const items = Array.from({ length: 25 }, (_, index) => feedback({ id: `feedback-${index}`, description: `保留的问题 ${index}`, status: "in_progress" }));
    await renderPage(createRepository(items));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索反馈" }), { target: { value: "保留" } });
    fireEvent.click(screen.getByRole("button", { name: "处理中 25" }));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("第 2 / 3 页 · 共 25 条")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "产品反馈记录" });
    const trigger = within(table).getAllByRole("button", { name: "查看" })[2];
    const title = trigger.closest("tr")!.querySelector(".feedback-admin-summary__title")!.textContent!;
    trigger.focus(); fireEvent.click(trigger);
    const detail = await screen.findByRole("article", { name: title });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(table).toBeInTheDocument();
    expect(table.closest(".feedback-admin-inbox")).toHaveAttribute("hidden");
    expect(within(detail).getByRole("heading", { name: title })).toHaveFocus();
    fireEvent.click(within(detail).getByRole("button", { name: "返回反馈列表" }));
    expect(screen.getByRole("searchbox", { name: "搜索反馈" })).toHaveValue("保留");
    expect(screen.getByRole("button", { name: "处理中 25" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("第 2 / 3 页 · 共 25 条")).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(new URLSearchParams(window.location.search).get("id")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("q")).toBe("保留");
  });

  it("keeps the issue and hidden inbox intact when unsent reply leave is cancelled", async () => {
    await renderPage();
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "查看" }));
    const detail = await screen.findByRole("article", { name: "页面切换后筛选条件丢失" });
    fireEvent.click(within(detail).getByRole("button", { name: /回复提交人/ }));
    fireEvent.change(within(detail).getByLabelText("公开回复"), { target: { value: "需要保留的草稿" } });
    fireEvent.click(within(detail).getByRole("button", { name: "返回反馈列表" }));
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(within(detail).getByLabelText("公开回复")).toHaveValue("需要保留的草稿");
    expect(new URLSearchParams(window.location.search).get("id")).toBe("feedback-1");
  });

  it("refreshes statistics after explicitly saved routing changes", async () => {
    const repository = await renderPage(createRepository([feedback()], { getStats: vi.fn().mockResolvedValue({ total: 1, open: 1, inProgress: 0, resolved: 0, closed: 0 }) }));
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "查看" }));
    const detail = await screen.findByRole("article", { name: "页面切换后筛选条件丢失" });
    fireEvent.click(within(detail).getByRole("button", { name: "编辑" }));
    await selectControlOption(within(detail).getByLabelText("优先级"), "high");
    fireEvent.click(within(detail).getByRole("button", { name: "保存安排" }));
    await within(detail).findByText("处理安排已保存。");
    expect(repository.update).toHaveBeenCalledWith("feedback-1", { priority: "high", assigneeUserId: null });
    expect(repository.getStats).toHaveBeenCalledTimes(2);
    fireEvent.click(within(detail).getByRole("button", { name: "返回反馈列表" }));
    expect(within(screen.getByRole("table")).getByText("高优先级")).toBeInTheDocument();
  });

  it("keeps a saved mutation when an older inbox request finishes afterwards", async () => {
    window.history.replaceState(null, "", "/feedback-admin?id=feedback-1");
    let finishList!: (result: { items: ProductFeedback[] }) => void;
    const repository = createRepository([feedback()], {
      list: vi.fn().mockReturnValue(new Promise((resolve) => { finishList = resolve; })),
      appendProgress: vi.fn().mockResolvedValue(feedback({ status: "in_progress", updatedAt: "2026-07-08T09:00:00.000Z" }))
    });
    render(<FeedbackAdminPage productFeedbackRepository={repository} />);
    const detail = await screen.findByRole("article", { name: "页面切换后筛选条件丢失" });
    fireEvent.click(within(detail).getByRole("button", { name: "开始处理" }));
    await screen.findByText("已开始处理。");
    await act(async () => finishList({ items: [feedback()] }));
    fireEvent.click(within(detail).getByRole("button", { name: "返回反馈列表" }));
    expect(within(screen.getByRole("table")).getByText("处理中")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByText("待处理")).not.toBeInTheDocument();
  });

  it("ignores an older stats response after the mutation stats have arrived", async () => {
    let finishStats!: (result: { total: number; open: number; inProgress: number; resolved: number; closed: number }) => void;
    const getStats = vi.fn().mockReturnValueOnce(new Promise((resolve) => { finishStats = resolve; })).mockResolvedValue({ total: 1, open: 0, inProgress: 1, resolved: 0, closed: 0 });
    const repository = await renderPage(createRepository([feedback()], { getStats }));
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "查看" }));
    const detail = await screen.findByRole("article", { name: "页面切换后筛选条件丢失" });
    fireEvent.click(within(detail).getByRole("button", { name: "开始处理" }));
    await screen.findByText("已开始处理。");
    expect(repository.getStats).toHaveBeenCalledTimes(2);
    await act(async () => finishStats({ total: 1, open: 1, inProgress: 0, resolved: 0, closed: 0 }));
    fireEvent.click(within(detail).getByRole("button", { name: "返回反馈列表" }));
    expect(screen.getByRole("button", { name: "待处理 0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "处理中 1" })).toBeInTheDocument();
  });

  it("shows local retry paths for list and detail errors", async () => {
    const { WiseEffApiError } = await import("@/infrastructure/http/apiClient");
    const repository = createRepository([], { list: vi.fn().mockRejectedValueOnce(new WiseEffApiError("FORBIDDEN", "Forbidden", {}, "req-feedback-list")).mockResolvedValue({ items: [] }) });
    render(<FeedbackAdminPage productFeedbackRepository={repository} />);
    expect(await screen.findByText("没有权限执行该操作。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() => expect(repository.list).toHaveBeenCalledTimes(2));
  });

  it("retries unavailable deep-linked detail without needing it in the inbox", async () => {
    window.history.replaceState(null, "", "/feedback-admin?id=older");
    const repository = createRepository([], { get: vi.fn().mockRejectedValueOnce(new Error("详情暂不可用")).mockResolvedValue(feedback({ id: "older", description: "恢复后可查看的问题" })) });
    await renderPage(repository);
    expect(await screen.findByText("详情暂不可用")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载详情" }));
    expect(await screen.findByRole("article", { name: "恢复后可查看的问题" })).toBeInTheDocument();
    expect(repository.get).toHaveBeenCalledTimes(2);
  });

  it("requires admin access", () => expect(getRequiredRoleForPage("feedback-admin")).toBe("admin"));
});
