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
});
