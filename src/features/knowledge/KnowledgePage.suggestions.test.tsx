import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockKnowledgeFixtures, createMockKnowledgeRepository } from "@/infrastructure/mock/mockKnowledgeRepository";
import { KnowledgePage } from "./KnowledgePage";

const capability = { userId: "u-xu-yun", canView: true, canEdit: true, canManage: false };

describe("knowledge reference suggestions", () => {
  it("removes the only pending entry after batch acceptance and closing the report", async () => {
    const repository = createMockKnowledgeRepository({ canManage: false }, { entries: [], revisions: [] });
    const entry = await repository.createMarkdown({ title: "批量处理后移出筛选", tags: [], contentMarkdown: "gpio-int" });
    const list = vi.spyOn(repository, "list");
    render(<KnowledgePage repository={repository} capability={capability} />);
    const user = userEvent.setup();
    await screen.findByText(entry.title);
    await user.click(screen.getByRole("checkbox", { name: "待处理建议" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ pendingSuggestions: true }));
    await user.click(screen.getByRole("checkbox", { name: `选择 ${entry.title}` }));
    await user.click(screen.getByRole("button", { name: "接受建议关联" }));
    await user.click(screen.getByRole("button", { name: "确认接受建议关联" }));
    expect(await screen.findByRole("table", { name: "批量操作结果" })).toHaveTextContent("成功");
    const callsBeforeClose = list.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByText(entry.title)).not.toBeInTheDocument());
    expect(list.mock.calls.length).toBeGreaterThan(callsBeforeClose);
    expect(list).toHaveBeenLastCalledWith({ pendingSuggestions: true });
    expect(screen.getByRole("checkbox", { name: "待处理建议" })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "待处理建议" }));
    expect(await screen.findByText(entry.title)).toBeInTheDocument();
  });

  it.each(["接受", "忽略", "全部接受"])("removes the last pending entry after detail %s and closing the editor", async (action) => {
    const repository = createMockKnowledgeRepository({ canManage: false }, { entries: [], revisions: [] });
    const entry = await repository.createMarkdown({ title: "详情处理后移出筛选", tags: [], contentMarkdown: "gpio-int" });
    const suggestions = await repository.listReferenceSuggestions(entry.id);
    for (const suggestion of suggestions.slice(1)) await repository.dismissReferenceSuggestion(entry.id, suggestion.definitionId);
    const list = vi.spyOn(repository, "list");
    render(<KnowledgePage repository={repository} capability={capability} />);
    const user = userEvent.setup();
    await screen.findByText(entry.title);
    await user.click(screen.getByRole("checkbox", { name: "待处理建议" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ pendingSuggestions: true }));
    await user.click(await screen.findByText(entry.title));
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const section = await screen.findByRole("region", { name: "建议关联" });
    await user.click(await within(section).findByRole("button", { name: action }));
    await within(section).findByText("暂无建议关联。");
    await user.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByText(entry.title)).not.toBeInTheDocument());
    expect(list).toHaveBeenLastCalledWith({ pendingSuggestions: true });
    expect(screen.getByRole("checkbox", { name: "待处理建议" })).toBeChecked();
    expect(await repository.get(entry.id)).not.toBeNull();
  });

  it("refreshes the list badge after leaving a partially reviewed entry", async () => {
    const repository = createMockKnowledgeRepository({ canManage: false });
    const entry = await repository.createMarkdown({ title: "部分审阅", tags: [], contentMarkdown: "gpio-int" });
    const items = await repository.listReferenceSuggestions(entry.id);
    await repository.dismissReferenceSuggestion(entry.id, items[2]!.definitionId);
    render(<KnowledgePage repository={repository} capability={capability} />);
    const user = userEvent.setup();
    await screen.findByText("待处理建议 2");
    await user.click(screen.getByText(entry.title));
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const section = await screen.findByRole("region", { name: "建议关联" });
    await user.click((await within(section).findAllByRole("button", { name: "接受" }))[0]!);
    await waitFor(() => expect(within(section).getAllByRole("button", { name: "接受" })).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(await screen.findByText("待处理建议 1")).toBeInTheDocument();
  });

  it("filters pending suggestions, shows governed counts, and reports bulk acceptance per entry", async () => {
    const repository = createMockKnowledgeRepository({ canManage: false });
    const own = await repository.createMarkdown({ title: "待处理条目", tags: [], contentMarkdown: "gpio-int" });
    await repository.acceptReferenceSuggestion(own.id, (await repository.listReferenceSuggestions(own.id))[2]!.definitionId);
    const rows = (await repository.list()).items;
    const other = rows.find((entry) => entry.status === "published" && entry.createdByUserId !== capability.userId)!;
    const list = vi.spyOn(repository, "list");
    const batch = vi.spyOn(repository, "batch");
    render(<KnowledgePage repository={repository} capability={capability} />);
    const user = userEvent.setup();
    const ownRow = (await screen.findByText(own.title)).closest("tr")!;
    expect(within(ownRow).getByText("待处理建议 2")).toBeInTheDocument();
    expect(within(screen.getByText(other.title).closest("tr")!).queryByText(/待处理建议/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "待处理建议" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ pendingSuggestions: true })));
    await waitFor(() => expect(screen.queryByText(other.title)).not.toBeInTheDocument());
    await user.click(screen.getByRole("checkbox", { name: "待处理建议" }));
    await screen.findByText(other.title);
    await user.click(screen.getByRole("checkbox", { name: `选择 ${own.title}` }));
    await user.click(screen.getByRole("checkbox", { name: `选择 ${other.title}` }));
    await user.click(screen.getByRole("button", { name: "接受建议关联" }));
    await user.click(screen.getByRole("button", { name: "确认接受建议关联" }));
    expect(batch).toHaveBeenCalledWith({ action: "accept_suggestions", entryIds: [own.id, other.id] });
    const report = await screen.findByRole("table", { name: "批量操作结果" });
    expect(report).toHaveTextContent("成功");
    expect(report).toHaveTextContent("拒绝");
    expect(report).toHaveTextContent("需要本人条目的编辑权限或知识管理权限");
    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByText("待处理建议 2")).not.toBeInTheDocument();
  });

  it("groups ambiguous suggestions, accepts independently, dismisses and accepts all remaining items", async () => {
    const fixtures = createMockKnowledgeFixtures();
    const entry = fixtures.entries.find((item) => item.status === "draft" && item.createdByUserId === capability.userId)!;
    entry.title = "建议测试";
    entry.contentMarkdown = "iin_max";
    const items = ["module-a", "module-b", "module-c"].map((driverModule, index) => ({
      definitionId: `pdef-${index}`, propertyKey: "iin_max", displayName: "输入电流", driverModule,
      lifecycle: index === 1 ? "deprecated" as const : "active" as const,
      mentionCount: 3, snippet: "iin_max 调参说明", page: 2, detectedRevisionId: "detected-revision-1"
    }));
    fixtures.suggestions = { [entry.id]: items };
    const repository = createMockKnowledgeRepository({ canManage: false }, fixtures);
    const accept = vi.spyOn(repository, "acceptReferenceSuggestion");
    const dismiss = vi.spyOn(repository, "dismissReferenceSuggestion");
    const batch = vi.spyOn(repository, "batch");
    render(<KnowledgePage repository={repository} capability={capability} />);
    const user = userEvent.setup();
    await user.click(await screen.findByText(entry.title));
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const section = await screen.findByRole("region", { name: "建议关联" });
    expect(within(section).getAllByText("iin_max")).toHaveLength(1);
    expect(section).toHaveTextContent("已弃用");
    expect(section).toHaveTextContent("第 2 页");
    await user.click(within(section).getAllByRole("button", { name: "接受" })[0]!);
    await waitFor(() => expect(accept).toHaveBeenCalledWith(entry.id, "pdef-0"));
    expect(section).toHaveTextContent("module-b");
    await user.click(within(section).getAllByRole("button", { name: "忽略" })[0]!);
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith(entry.id, "pdef-1"));
    await user.click(within(section).getByRole("button", { name: "全部接受" }));
    await waitFor(() => expect(batch).toHaveBeenCalledWith({ action: "accept_suggestions", entryIds: [entry.id] }));
    expect(accept).toHaveBeenCalledTimes(1);
    expect(await within(section).findByText("暂无建议关联。")).toBeInTheDocument();
    expect((await repository.get(entry.id))?.parameterReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ definitionId: "pdef-0" }), expect.objectContaining({ definitionId: "pdef-2" })
    ]));
  });

  it("never loads suggestions for a reader", async () => {
    const repository = createMockKnowledgeRepository();
    const list = vi.spyOn(repository, "listReferenceSuggestions");
    const entry = (await repository.list()).items.find((item) => item.status === "published")!;
    render(<KnowledgePage repository={repository} capability={{ ...capability, canEdit: false }} />);
    await userEvent.setup().click(await screen.findByText(entry.title));
    expect(screen.queryByRole("region", { name: "建议关联" })).not.toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it("keeps suggestions when the single-entry atomic accept is refused", async () => {
    const repository = createMockKnowledgeRepository({ canManage: false });
    const entry = await repository.createMarkdown({ title: "原子接受失败", tags: [], contentMarkdown: "gpio-int" });
    const accept = vi.spyOn(repository, "acceptReferenceSuggestion");
    const batch = vi.spyOn(repository, "batch").mockResolvedValueOnce({ results: [{ entryId: entry.id, title: entry.title,
      status: "failed", entry: null, error: { code: "CONFLICT", message: "定义已变化" } }], summaryError: null });
    render(<KnowledgePage repository={repository} capability={capability} />);
    const user = userEvent.setup();
    await user.click(await screen.findByText(entry.title));
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const section = await screen.findByRole("region", { name: "建议关联" });
    await within(section).findAllByRole("button", { name: "接受" });
    await user.click(within(section).getByRole("button", { name: "全部接受" }));
    expect(await within(section).findByRole("alert")).toHaveTextContent("定义已变化");
    expect(batch).toHaveBeenCalledWith({ action: "accept_suggestions", entryIds: [entry.id] });
    expect(accept).not.toHaveBeenCalled();
    expect(within(section).getAllByRole("button", { name: "接受" })).toHaveLength(3);
    expect((await repository.get(entry.id))?.parameterReferences).toEqual([]);
  });

  it("lets a manager govern file suggestions without a markdown save and retries a failed read", async () => {
    const repository = createMockKnowledgeRepository();
    const entry = await repository.createFile({ title: "文件建议", tags: [], file: new File(["%PDF-test"], "manual.pdf", { type: "application/pdf" }) });
    const list = vi.spyOn(repository, "listReferenceSuggestions").mockRejectedValueOnce(new Error("建议读取失败"));
    render(<KnowledgePage repository={repository} capability={{ ...capability, canEdit: false, canManage: true }} />);
    const user = userEvent.setup();
    await user.click(await screen.findByText(entry.title));
    await user.click(screen.getByRole("button", { name: "关联参数定义" }));
    const editor = screen.getByRole("dialog", { name: "关联参数定义" });
    expect(within(editor).queryByLabelText("Markdown 内容")).not.toBeInTheDocument();
    expect(within(editor).queryByRole("button", { name: "保存为新修订" })).not.toBeInTheDocument();
    expect(await within(editor).findByRole("alert")).toHaveTextContent("建议读取失败");
    await user.click(within(editor).getByRole("button", { name: "重试" }));
    expect(await within(editor).findByText("暂无建议关联。")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });
});
