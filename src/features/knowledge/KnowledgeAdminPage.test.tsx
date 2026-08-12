import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { createMockKnowledgeRepository } from "@/infrastructure/mock/mockKnowledgeRepository";
import { KnowledgeAdminPage } from "./KnowledgeAdminPage";

describe("KnowledgeAdminPage", () => {
  it("lists archived entries only", async () => {
    const repository = createMockKnowledgeRepository();
    render(<KnowledgeAdminPage repository={repository} canManage />);

    const table = await screen.findByRole("table", { name: "已归档知识条目" });
    expect(within(table).getByText("已归档:旧平台日志格式说明")).toBeInTheDocument();
    expect(within(table).queryByText("快充温控调参经验")).not.toBeInTheDocument();
  });

  it("restores an archived entry back to published", async () => {
    const repository = createMockKnowledgeRepository();
    render(<KnowledgeAdminPage repository={repository} canManage />);
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
    render(<KnowledgeAdminPage repository={repository} canManage />);
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
    render(<KnowledgeAdminPage repository={repository} canManage={false} />);

    await screen.findByRole("table", { name: "已归档知识条目" });
    expect(screen.queryByRole("button", { name: "彻底删除" })).not.toBeInTheDocument();
    expect(screen.getByText(/没有知识治理权限/)).toBeInTheDocument();
  });

  it("shows index health with the retrieval-mode banner, per-entry status, and failure reasons", async () => {
    const repository = createMockKnowledgeRepository();
    render(<KnowledgeAdminPage repository={repository} canManage />);

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
    render(<KnowledgeAdminPage repository={repository} canManage />);
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
    render(<KnowledgeAdminPage repository={repository} canManage />);
    const user = userEvent.setup();

    await screen.findByRole("table", { name: "知识索引状态" });
    await user.click(screen.getByRole("button", { name: "全量重建索引" }));

    expect(await screen.findByText(/已重新入队 2 条已发布条目/)).toBeInTheDocument();
    const health = await repository.getIndexHealth();
    expect(health.items.every((item) => item.entryStatus !== "published" || item.status === "pending")).toBe(true);
  });

  it("gates index health behind knowledge:manage", async () => {
    const repository = createMockKnowledgeRepository({ canManage: false });
    render(<KnowledgeAdminPage repository={repository} canManage={false} />);

    await screen.findByRole("table", { name: "已归档知识条目" });
    expect(screen.getByText(/索引健康与重建操作需要知识管理员权限/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "全量重建索引" })).not.toBeInTheDocument();
  });
});
