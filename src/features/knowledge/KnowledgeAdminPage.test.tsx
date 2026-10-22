import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KnowledgeCapability } from "@/domain/knowledge/rules";
import { createMockKnowledgeRepository } from "@/infrastructure/mock/mockKnowledgeRepository";
import { KnowledgeAdminPage } from "./KnowledgeAdminPage";

const manageCapability: KnowledgeCapability = { userId: "u-xu-yun", canView: true, canEdit: true, canManage: true };
const editorCapability: KnowledgeCapability = { userId: "u-xu-yun", canView: true, canEdit: true, canManage: false };

describe("KnowledgeAdminPage", () => {
  beforeEach(() => window.history.replaceState(null, "", "/knowledge-admin"));

  it("identifies completed zero-chunk entries as unsearchable without warning on pending or archived entries", async () => {
    window.history.replaceState(null, "", "/knowledge-admin?tab=index");
    const repository = createMockKnowledgeRepository();
    const health = await repository.getIndexHealth();
    const template = health.items[0];
    vi.spyOn(repository, "getIndexHealth").mockResolvedValue({ ...health, items: [
      { ...template, entryId: "legacy-empty", title: "旧扫描文件", entryStatus: "published", status: "succeeded", chunkCount: 0 },
      { ...template, entryId: "failed-empty", title: "提取失败文件", entryStatus: "published", status: "failed", chunkCount: 0 },
      { ...template, entryId: "pending", title: "待索引文件", entryStatus: "published", status: "pending", chunkCount: 0 },
      { ...template, entryId: "archived", title: "已归档文件", entryStatus: "archived", status: "succeeded", chunkCount: 0 },
      { ...template, entryId: "normal", title: "正常文件", entryStatus: "published", status: "succeeded", chunkCount: 2 }
    ] });
    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);
    const table = await screen.findByRole("table", { name: "知识索引状态" });
    const row = within(table).getByText("旧扫描文件").closest("tr")!;
    expect(within(row).getByText("不可检索")).toBeInTheDocument();
    expect(within(row).getByText("无已索引分块，请检查文件是否包含可提取文本并替换文件。")).toBeInTheDocument();
    expect(within(table).getAllByText("不可检索")).toHaveLength(2);
  });

  it.each(["drafts", "index", "archived"])("keeps tabs, header, filter context and table in order on %s", async (tab) => {
    window.history.replaceState(null, "", `/knowledge-admin?tab=${tab}`);
    render(<KnowledgeAdminPage repository={createMockKnowledgeRepository()} capability={manageCapability} />);
    const table = await screen.findByRole("table");
    const panel = screen.getByRole("tabpanel");
    const header = within(panel).getByRole("group", { name: /操作$/ });
    const filters = within(panel).getByRole("group", { name: /筛选$/ });
    for (const [before, after] of [[screen.getByRole("tablist"), header], [header, filters], [filters, table]]) {
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(filters).not.toBeEmptyDOMElement();
  });

  it("follows same-page router navigation and falls back from unknown tabs", async () => {
    window.history.replaceState(null, "", "/knowledge-admin?tab=index");
    const repository = createMockKnowledgeRepository();
    const page = render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);
    expect(await screen.findByRole("table", { name: "知识索引状态" })).toBeVisible();
    window.history.pushState(null, "", "/knowledge-admin?tab=unknown");
    page.rerender(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);
    expect(screen.getByRole("tab", { name: "Agent 草稿发布队列" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("table")).toHaveLength(1);
  });

  it("restores URL collection tabs without showing stacked collections", async () => {
    window.history.replaceState(null, "", "/knowledge-admin?tab=archived&keep=1#detail");
    render(<KnowledgeAdminPage repository={createMockKnowledgeRepository()} capability={manageCapability} />);
    expect(await screen.findByRole("table", { name: "已归档知识条目" })).toBeVisible();
    expect(screen.queryByRole("table", { name: "Agent 知识草稿队列" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "检索索引健康" }));
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("检索索引健康");
    expect(window.location.search).toBe("?tab=index&keep=1");
    expect(window.location.hash).toBe("#detail");
    act(() => {
      window.history.replaceState(null, "", "/knowledge-admin?tab=archived");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("tab", { name: "已归档条目" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("table")).toHaveLength(1);
  });
  it("lists archived entries only", async () => {
    window.history.replaceState(null, "", "/knowledge-admin?tab=archived");
    const repository = createMockKnowledgeRepository();
    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);

    const table = await screen.findByRole("table", { name: "已归档知识条目" });
    expect(within(table).getByText("已归档:旧平台日志格式说明")).toBeInTheDocument();
    expect(within(table).queryByText("快充温控调参经验")).not.toBeInTheDocument();
  });

  it("restores an archived entry back to published", async () => {
    window.history.replaceState(null, "", "/knowledge-admin?tab=archived");
    const repository = createMockKnowledgeRepository();
    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);
    const user = userEvent.setup();

    const table = await screen.findByRole("table", { name: "已归档知识条目" });
    await user.click(within(table).getByRole("button", { name: "恢复" }));

    await waitFor(async () => {
      const entry = await repository.get("mock-kb-5");
      expect(entry?.status).toBe("published");
    });
    expect(within(table).queryByText("已归档:旧平台日志格式说明")).not.toBeInTheDocument();
  });

  it("hard deletes after an acknowledged confirmation", async () => {
    window.history.replaceState(null, "", "/knowledge-admin?tab=archived");
    const repository = createMockKnowledgeRepository();
    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);
    const user = userEvent.setup();

    const table = await screen.findByRole("table", { name: "已归档知识条目" });
    await user.click(within(table).getByRole("button", { name: /：更多$/ }));
    await user.click(screen.getByRole("menuitem", { name: "彻底删除" }));

    const confirm = await screen.findByRole("dialog", { name: /彻底删除/ });
    const confirmButton = within(confirm).getByRole("button", { name: "彻底删除" });
    expect(confirmButton).toBeDisabled();
    await user.click(within(confirm).getByRole("checkbox"));
    await user.click(confirmButton);

    await waitFor(async () => {
      expect(await repository.get("mock-kb-5")).toBeNull();
    });
  });

  it("hides hard delete without manage capability", async () => {
    window.history.replaceState(null, "", "/knowledge-admin?tab=archived");
    const repository = createMockKnowledgeRepository();
    render(<KnowledgeAdminPage repository={repository} capability={editorCapability} />);

    await screen.findByRole("table", { name: "已归档知识条目" });
    expect(screen.queryByRole("button", { name: "彻底删除" })).not.toBeInTheDocument();
    expect(screen.getByText(/没有知识治理权限/)).toBeInTheDocument();
  });

  it("retains the delete confirmation and entry when the write fails", async () => {
    window.history.replaceState(null, "", "/knowledge-admin?tab=archived");
    const repository = createMockKnowledgeRepository();
    vi.spyOn(repository, "hardDelete").mockRejectedValue(new Error("failure"));
    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);
    const table = await screen.findByRole("table", { name: "已归档知识条目" });
    await userEvent.click(within(table).getByRole("button", { name: /：更多$/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "彻底删除" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("checkbox"));
    await userEvent.click(within(dialog).getByRole("button", { name: "彻底删除" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("操作失败，请重试。");
    expect(await repository.get("mock-kb-5")).not.toBeNull();
  });

  it("lists the agent-draft publish queue with creator, session origin, and source analysis link", async () => {
    const repository = createMockKnowledgeRepository();
    const onNavigate = vi.fn();
    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} onNavigate={onNavigate} />);
    const user = userEvent.setup();

    const queue = await screen.findByRole("table", { name: "Agent 知识草稿队列" });
    const ownRow = within(queue).getByText("小泽沉淀:充电异常断电根因排查").closest("tr")! as HTMLElement;
    expect(within(ownRow).getByText(/创建人 u-xu-yun/)).toBeInTheDocument();
    expect(within(ownRow).getByText("mock-xiaoze-session-1")).toBeInTheDocument();
    expect(within(queue).getByText("小泽沉淀:无线充异物检测误报处置")).toBeInTheDocument();

    // Human drafts never enter the queue.
    expect(within(queue).queryByText("SC8562 充电泵比率切换草稿")).not.toBeInTheDocument();

    await user.click(within(ownRow).getByRole("button", { name: "查看日志分析" }));
    expect(onNavigate).toHaveBeenCalledWith("/logs?logId=log-auth");

    await user.click(within(ownRow).getByRole("button", { name: "审阅" }));
    expect(onNavigate).toHaveBeenCalledWith("/knowledge?entryId=mock-kb-agent-1");
  });

  it("labels a retained draft whose creator account was deleted", async () => {
    const repository = createMockKnowledgeRepository();
    const list = repository.list.bind(repository);
    vi.spyOn(repository, "list").mockImplementation(async (query) => {
      const result = await list(query);
      return {
        ...result,
        items: result.items.map((entry) =>
          entry.id === "mock-kb-agent-1"
            ? { ...entry, createdByUserId: null }
            : entry
        )
      };
    });

    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);

    const queue = await screen.findByRole("table", { name: "Agent 知识草稿队列" });
    const row = within(queue).getByText("小泽沉淀:充电异常断电根因排查").closest("tr")! as HTMLElement;
    expect(within(row).getByText(/创建人 已注销用户/)).toBeInTheDocument();
  });

  it("publishes an agent draft from the queue", async () => {
    const repository = createMockKnowledgeRepository();
    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);
    const user = userEvent.setup();

    const queue = await screen.findByRole("table", { name: "Agent 知识草稿队列" });
    const row = within(queue).getByText("小泽沉淀:充电异常断电根因排查").closest("tr")! as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /：更多$/ }));
    await user.click(screen.getByRole("menuitem", { name: "发布" }));

    await waitFor(async () => {
      const entry = await repository.get("mock-kb-agent-1");
      expect(entry?.status).toBe("published");
    });
    expect(within(queue).queryByText("小泽沉淀:充电异常断电根因排查")).not.toBeInTheDocument();
  });

  it("archive-rejects an agent draft after confirmation and moves it into the archived table", async () => {
    const repository = createMockKnowledgeRepository();
    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);
    const user = userEvent.setup();

    const queue = await screen.findByRole("table", { name: "Agent 知识草稿队列" });
    const row = within(queue).getByText("小泽沉淀:无线充异物检测误报处置").closest("tr")! as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /：更多$/ }));
    await user.click(screen.getByRole("menuitem", { name: "拒绝归档" }));

    const confirm = await screen.findByRole("dialog", { name: /拒绝并归档/ });
    await user.click(within(confirm).getByRole("button", { name: "拒绝归档" }));

    await waitFor(async () => {
      const entry = await repository.get("mock-kb-agent-2");
      expect(entry?.status).toBe("archived");
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("tab", { name: "已归档条目" }));
    const archivedTable = screen.getByRole("table", { name: "已归档知识条目" });
    await waitFor(() => {
      expect(within(archivedTable).getByText("小泽沉淀:无线充异物检测误报处置")).toBeInTheDocument();
    });
  });

  it("editors without manage only see and govern their own session drafts", async () => {
    // Draft visibility is enforced by the repository (server-side in API mode):
    // a non-manage editor only receives their own drafts in the queue.
    const repository = createMockKnowledgeRepository({ canManage: false });
    render(<KnowledgeAdminPage repository={repository} capability={editorCapability} />);

    const queue = await screen.findByRole("table", { name: "Agent 知识草稿队列" });
    const ownRow = within(queue).getByText("小泽沉淀:充电异常断电根因排查").closest("tr")! as HTMLElement;
    await userEvent.click(within(ownRow).getByRole("button", { name: /：更多$/ }));
    expect(screen.getByRole("menuitem", { name: "发布" })).not.toHaveAttribute("data-disabled");
    expect(within(queue).queryByText("小泽沉淀:无线充异物检测误报处置")).not.toBeInTheDocument();
  });

  it("shows index health with the retrieval-mode banner, per-entry status, and failure reasons", async () => {
    window.history.replaceState(null, "", "/knowledge-admin?tab=index");
    const repository = createMockKnowledgeRepository();
    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);

    const banner = await screen.findByLabelText("检索模式");
    expect(banner).toHaveTextContent("仅全文检索");
    expect(banner).toHaveTextContent("pgvector 不可用");

    const table = await screen.findByRole("table", { name: "知识索引状态" });
    expect(within(table).getByText("快充温控调参经验")).toBeInTheDocument();
    expect(within(table).getByText("失败")).toBeInTheDocument();
    expect(within(table).getByText("索引失败，请稍后重试或联系管理员。")).toBeInTheDocument();
  });

  it("retries a failed entry back into the queue", async () => {
    window.history.replaceState(null, "", "/knowledge-admin?tab=index");
    const repository = createMockKnowledgeRepository();
    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);
    const user = userEvent.setup();

    const table = await screen.findByRole("table", { name: "知识索引状态" });
    const failedRow = within(table).getByText("MT5788 无线充手册摘录").closest("tr")!;
    await user.click(within(failedRow as HTMLElement).getByRole("button", { name: "重试" }));

    await waitFor(async () => {
      const health = await repository.getIndexHealth();
      expect(health.items.find((item) => item.entryId === "mock-kb-3")?.status).toBe("pending");
    });
    expect(within(table).getByText("排队中")).toBeInTheDocument();
  });

  it("rebuilds the whole index and reports the enqueued count", async () => {
    window.history.replaceState(null, "", "/knowledge-admin?tab=index");
    const repository = createMockKnowledgeRepository();
    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);
    const user = userEvent.setup();

    await screen.findByRole("table", { name: "知识索引状态" });
    await user.click(screen.getByRole("button", { name: "全量重建索引" }));

    expect(await screen.findByText(/已重新入队 3 条已发布条目/)).toBeInTheDocument();
    const health = await repository.getIndexHealth();
    expect(health.items.every((item) => item.entryStatus !== "published" || item.status === "pending")).toBe(true);
  });

  it("rescans non-archived entries without rebuilding the retrieval index", async () => {
    window.history.replaceState(null, "", "/knowledge-admin?tab=index");
    const repository = createMockKnowledgeRepository();
    const published = await repository.list({ status: "published" });
    const drafts = await repository.list({ status: "draft" });
    const before = await repository.getIndexHealth();
    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);
    await screen.findByRole("table", { name: "知识索引状态" });
    await userEvent.click(screen.getByRole("button", { name: "重新检测建议关联" }));
    expect(await screen.findByText(new RegExp(`已发起 ${published.items.length + drafts.items.length} 条未归档条目的后台建议检测`))).toHaveAttribute("role", "status");
    const health = await repository.getIndexHealth();
    expect(health).toEqual(before);
  });

  it("disables the rescan while pending and reports failure with a retry", async () => {
    window.history.replaceState(null, "", "/knowledge-admin?tab=index");
    const repository = createMockKnowledgeRepository();
    let refuse: (error: Error) => void = () => undefined;
    vi.spyOn(repository, "rescanReferenceSuggestions").mockImplementationOnce(() => new Promise((_resolve, reject) => { refuse = reject; }));
    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);
    await screen.findByRole("table", { name: "知识索引状态" });
    const button = screen.getByRole("button", { name: "重新检测建议关联" });
    await userEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await act(async () => { refuse(new Error("Unavailable")); });
    expect(await screen.findByRole("alert")).toHaveTextContent("发起建议关联检测失败，请稍后重试。");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(await screen.findByText(/已发起 .* 条未归档条目的后台建议检测/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("gates index health behind knowledge:manage", async () => {
    window.history.replaceState(null, "", "/knowledge-admin?tab=index");
    const repository = createMockKnowledgeRepository({ canManage: false });
    render(<KnowledgeAdminPage repository={repository} capability={editorCapability} />);

    expect(screen.getByText(/索引健康与重建操作需要知识管理员权限/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "全量重建索引" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新检测建议关联" })).not.toBeInTheDocument();
  });

  it("maps API failures to product-language copy when list load fails", async () => {
    const { WiseEffApiError } = await import("@/infrastructure/http/apiClient");
    const repository = createMockKnowledgeRepository();
    vi.spyOn(repository, "list").mockRejectedValue(
      new WiseEffApiError("FORBIDDEN", "Forbidden", {}, "req-kb-admin-list")
    );

    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);

    expect((await screen.findAllByText("没有权限执行该操作。")).length).toBeGreaterThan(0);
  });
});
