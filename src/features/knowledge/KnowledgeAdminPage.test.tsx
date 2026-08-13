import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { KnowledgeCapability } from "@/domain/knowledge/rules";
import { createMockKnowledgeRepository } from "@/infrastructure/mock/mockKnowledgeRepository";
import { KnowledgeAdminPage } from "./KnowledgeAdminPage";

const manageCapability: KnowledgeCapability = { userId: "u-xu-yun", canView: true, canEdit: true, canManage: true };
const editorCapability: KnowledgeCapability = { userId: "u-xu-yun", canView: true, canEdit: true, canManage: false };

describe("KnowledgeAdminPage", () => {
  it("lists archived entries only", async () => {
    const repository = createMockKnowledgeRepository();
    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);

    const table = await screen.findByRole("table", { name: "已归档知识条目" });
    expect(within(table).getByText("已归档:旧平台日志格式说明")).toBeInTheDocument();
    expect(within(table).queryByText("快充温控调参经验")).not.toBeInTheDocument();
  });

  it("restores an archived entry back to published", async () => {
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
    const repository = createMockKnowledgeRepository();
    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);
    const user = userEvent.setup();

    const table = await screen.findByRole("table", { name: "已归档知识条目" });
    await user.click(within(table).getByRole("button", { name: "彻底删除" }));

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
    const repository = createMockKnowledgeRepository();
    render(<KnowledgeAdminPage repository={repository} capability={editorCapability} />);

    await screen.findByRole("table", { name: "已归档知识条目" });
    expect(screen.queryByRole("button", { name: "彻底删除" })).not.toBeInTheDocument();
    expect(screen.getByText(/没有知识治理权限/)).toBeInTheDocument();
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

  it("publishes an agent draft from the queue", async () => {
    const repository = createMockKnowledgeRepository();
    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);
    const user = userEvent.setup();

    const queue = await screen.findByRole("table", { name: "Agent 知识草稿队列" });
    const row = within(queue).getByText("小泽沉淀:充电异常断电根因排查").closest("tr")! as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "发布" }));

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
    await user.click(within(row).getByRole("button", { name: "拒绝归档" }));

    const confirm = await screen.findByRole("dialog", { name: /拒绝并归档/ });
    await user.click(within(confirm).getByRole("button", { name: "拒绝归档" }));

    await waitFor(async () => {
      const entry = await repository.get("mock-kb-agent-2");
      expect(entry?.status).toBe("archived");
    });
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
    expect(within(ownRow).getByRole("button", { name: "发布" })).toBeEnabled();
    expect(within(queue).queryByText("小泽沉淀:无线充异物检测误报处置")).not.toBeInTheDocument();
  });

  it("shows index health with the retrieval-mode banner, per-entry status, and failure reasons", async () => {
    const repository = createMockKnowledgeRepository();
    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);

    const banner = await screen.findByLabelText("检索模式");
    expect(banner).toHaveTextContent("仅全文检索");
    expect(banner).toHaveTextContent("pgvector 不可用");

    const table = await screen.findByRole("table", { name: "知识索引状态" });
    expect(within(table).getByText("快充温控调参经验")).toBeInTheDocument();
    expect(within(table).getByText("失败")).toBeInTheDocument();
    expect(within(table).getByText(/Embedding failed/)).toBeInTheDocument();
  });

  it("retries a failed entry back into the queue", async () => {
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
    const repository = createMockKnowledgeRepository();
    render(<KnowledgeAdminPage repository={repository} capability={manageCapability} />);
    const user = userEvent.setup();

    await screen.findByRole("table", { name: "知识索引状态" });
    await user.click(screen.getByRole("button", { name: "全量重建索引" }));

    expect(await screen.findByText(/已重新入队 3 条已发布条目/)).toBeInTheDocument();
    const health = await repository.getIndexHealth();
    expect(health.items.every((item) => item.entryStatus !== "published" || item.status === "pending")).toBe(true);
  });

  it("gates index health behind knowledge:manage", async () => {
    const repository = createMockKnowledgeRepository({ canManage: false });
    render(<KnowledgeAdminPage repository={repository} capability={editorCapability} />);

    await screen.findByRole("table", { name: "已归档知识条目" });
    expect(screen.getByText(/索引健康与重建操作需要知识管理员权限/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "全量重建索引" })).not.toBeInTheDocument();
  });
});
