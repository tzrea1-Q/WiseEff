import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockKnowledgeRepository } from "@/infrastructure/mock/mockKnowledgeRepository";
import { KnowledgePage } from "./KnowledgePage";

const capability = { userId: "u-xu-yun", canView: true, canEdit: true, canManage: false };

describe("knowledge batch management", () => {
  it.each([
    ["knowledge-illegal-status-transition", "条目状态不允许此操作"],
    ["knowledge-entry-archived", "已归档条目不能修改标签"]
  ])("renders the server reason %s without depending on its message", async (reason, copy) => {
    const repository = createMockKnowledgeRepository();
    const entry = await repository.createMarkdown({ title: "reason draft", tags: [], contentMarkdown: "reason" });
    vi.spyOn(repository, "batch").mockResolvedValueOnce({ results: [{
      entryId: entry.id, title: entry.title, entry: null, status: "failed",
      error: { code: "VALIDATION_FAILED", message: "Server wording may change.", reason }
    }], summaryError: null });
    render(<KnowledgePage repository={repository} capability={capability} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: `选择 ${entry.title}` }));
    await user.click(screen.getByRole("button", { name: "发布", exact: true }));
    await user.click(screen.getByRole("button", { name: "确认发布" }));
    expect(await screen.findByRole("table", { name: "批量操作结果" })).toHaveTextContent(copy);
  });
  it("selects rows without opening detail, offers all actions and names mixed outcomes", async () => {
    const repository = createMockKnowledgeRepository({ canManage: false });
    const own = await repository.createMarkdown({ title: "自己的草稿", tags: ["原有"], contentMarkdown: "batch" });
    const foreignPublished = (await repository.list()).items.find((entry) => entry.status === "published" && entry.createdByUserId !== capability.userId)!;
    render(<KnowledgePage repository={repository} capability={capability} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "选择 自己的草稿" }));
    await user.click(screen.getByRole("checkbox", { name: `选择 ${foreignPublished.title}` }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    for (const name of ["添加标签", "移除标签", "发布", "归档"]) expect(screen.getByRole("button", { name, exact: true })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "添加标签", exact: true }));
    const dialog = screen.getByRole("dialog", { name: "添加标签" });
    await user.type(within(dialog).getByLabelText("标签（逗号分隔）"), "共享, 原有");
    await user.click(within(dialog).getByRole("button", { name: "确认添加标签" }));
    const report = await screen.findByRole("table", { name: "批量操作结果" });
    expect(within(report).getByText("自己的草稿")).toBeInTheDocument();
    expect(within(report).getByText(foreignPublished.title)).toBeInTheDocument();
    expect(within(report).getByText("成功")).toBeInTheDocument();
    expect(within(report).getByText("拒绝")).toBeInTheDocument();
    expect(within(report).getByText(/需要本人条目的编辑权限或知识管理权限/)).toBeInTheDocument();
    expect((await repository.get(own.id))?.tags).toEqual(["原有", "共享"]);
  });

  it("publishes then archives the selection, keeps every result visible and updates retrieval", async () => {
    const repository = createMockKnowledgeRepository({ canManage: false });
    const entry = await repository.createMarkdown({ title: "批量检索唯一词", tags: [], contentMarkdown: "批量检索唯一词" });
    render(<KnowledgePage repository={repository} capability={capability} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: `选择 ${entry.title}` }));
    await user.click(screen.getByRole("button", { name: "发布", exact: true }));
    await user.click(screen.getByRole("button", { name: "确认发布" }));
    expect(await screen.findByRole("table", { name: "批量操作结果" })).toHaveTextContent("成功");
    expect((await repository.search(entry.title)).items).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "关闭" }));
    await user.click(screen.getByRole("checkbox", { name: `选择 ${entry.title}` }));
    await user.click(screen.getByRole("button", { name: "归档", exact: true }));
    await user.click(screen.getByRole("button", { name: "确认归档" }));
    expect(await screen.findByRole("table", { name: "批量操作结果" })).toHaveTextContent(entry.title);
    expect((await repository.search(entry.title)).items).toHaveLength(0);
  });

  it("offers no selection to readers", async () => {
    render(<KnowledgePage repository={createMockKnowledgeRepository()} capability={{ ...capability, canEdit: false }} />);
    await screen.findByRole("table", { name: "知识条目列表" });
    expect(screen.queryByRole("checkbox", { name: /选择/ })).not.toBeInTheDocument();
  });

  it("removes only requested tags and supports managers without edit permission", async () => {
    const repository = createMockKnowledgeRepository();
    const entry = await repository.createMarkdown({ title: "移除标签草稿", tags: ["保留", "移除"], contentMarkdown: "content" });
    render(<KnowledgePage repository={repository} capability={{ ...capability, canEdit: false, canManage: true }} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: `选择 ${entry.title}` }));
    await user.click(screen.getByRole("button", { name: "移除标签", exact: true }));
    await user.type(screen.getByLabelText("标签（逗号分隔）"), "移除");
    await user.click(screen.getByRole("button", { name: "确认移除标签" }));
    expect(await screen.findByRole("table", { name: "批量操作结果" })).toHaveTextContent("成功");
    expect((await repository.get(entry.id))?.tags).toEqual(["保留"]);
  });

  it("validates tags, preserves selection after a transport failure and prevents duplicate pending submits", async () => {
    const repository = createMockKnowledgeRepository();
    const batch = vi.spyOn(repository, "batch").mockRejectedValueOnce(new Error("Request failed."));
    render(<KnowledgePage repository={repository} capability={capability} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: /全选筛选结果/ }));
    await user.click(screen.getByRole("button", { name: "添加标签", exact: true }));
    await user.click(screen.getByRole("button", { name: "确认添加标签" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请输入 1–20 个标签");
    expect(batch).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("标签（逗号分隔）"), "重试");
    await user.click(screen.getByRole("button", { name: "确认添加标签" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("部分条目可能已完成");
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("group", { name: "批量管理" })).toHaveTextContent("已选择");
    await user.click(screen.getByRole("button", { name: "添加标签", exact: true }));
    let release!: (report: Awaited<ReturnType<typeof repository.batch>>) => void;
    batch.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    await user.type(screen.getByLabelText("标签（逗号分隔）"), "重试");
    await user.click(screen.getByRole("button", { name: "确认添加标签" }));
    expect(screen.getByRole("button", { name: "正在执行…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "添加标签" })).toBeInTheDocument();
    release({ results: [], summaryError: null });
    await screen.findByRole("table", { name: "批量操作结果" });
    expect(batch).toHaveBeenCalledTimes(2);
  });

  it("names failed entries and keeps successful outcomes visible when summary auditing fails", async () => {
    const repository = createMockKnowledgeRepository();
    const own = await repository.createMarkdown({ title: "失败条目", tags: [], contentMarkdown: "test" });
    const removed = await repository.createMarkdown({ title: "已删除条目", tags: [], contentMarkdown: "test" });
    const success = await repository.createMarkdown({ title: "成功条目", tags: [], contentMarkdown: "test" });
    vi.spyOn(repository, "batch").mockResolvedValueOnce({ results: [
      { entryId: own.id, title: own.title, status: "failed", entry: null, error: { code: "INTERNAL_ERROR", message: "Internal server error." } },
      { entryId: removed.id, title: null, status: "refused", entry: null, error: { code: "NOT_FOUND", message: "Knowledge entry was not found." } },
      { entryId: success.id, title: success.title, status: "succeeded", entry: { ...success, status: "published" }, error: null }
    ], summaryError: "批次汇总审计写入失败，逐条结果已保留。" });
    render(<KnowledgePage repository={repository} capability={capability} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: `选择 ${own.title}` }));
    await user.click(screen.getByRole("checkbox", { name: `选择 ${removed.title}` }));
    await user.click(screen.getByRole("checkbox", { name: `选择 ${success.title}` }));
    await user.click(screen.getByRole("button", { name: "发布", exact: true }));
    await user.click(screen.getByRole("button", { name: "确认发布" }));
    const report = await screen.findByRole("table", { name: "批量操作结果" });
    expect(report).toHaveTextContent("失败条目");
    expect(report).toHaveTextContent("已删除条目");
    expect(report).toHaveTextContent("成功条目");
    expect(report).toHaveTextContent("失败");
    expect(report).toHaveTextContent("条目写入失败");
    expect(report).toHaveTextContent("条目不存在或无权查看");
    expect(screen.getByRole("alert")).toHaveTextContent("批次汇总审计写入失败");
  });

  it("clears the batch on repository changes and ignores completion from the previous context", async () => {
    const repository = createMockKnowledgeRepository();
    const nextRepository = createMockKnowledgeRepository();
    const old = await repository.createMarkdown({ title: "旧组织草稿", tags: [], contentMarkdown: "old" });
    await nextRepository.createMarkdown({ title: "新组织草稿", tags: [], contentMarkdown: "new" });
    let release!: (report: Awaited<ReturnType<typeof repository.batch>>) => void;
    vi.spyOn(repository, "batch").mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const { rerender } = render(<KnowledgePage repository={repository} capability={capability} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: `选择 ${old.title}` }));
    await user.click(screen.getByRole("button", { name: "发布", exact: true }));
    await user.click(screen.getByRole("button", { name: "确认发布" }));
    rerender(<KnowledgePage repository={nextRepository} capability={capability} />);
    await screen.findByRole("checkbox", { name: "选择 新组织草稿" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => release({ results: [{ entryId: old.id, title: old.title, status: "succeeded", entry: { ...old, status: "published" }, error: null }], summaryError: null }));
    expect(screen.queryByRole("checkbox", { name: `选择 ${old.title}` })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择 新组织草稿" })).not.toBeChecked();
  });
});
