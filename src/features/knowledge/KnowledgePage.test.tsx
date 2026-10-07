import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createMockKnowledgeRepository } from "@/infrastructure/mock/mockKnowledgeRepository";
import type { KnowledgeEntry, KnowledgeSearchResponse } from "@/domain/knowledge/types";
import { KnowledgePage } from "./KnowledgePage";

const editorCapability = { userId: "u-xu-yun", canView: true, canEdit: true, canManage: false };
const viewerCapability = { userId: "u-viewer", canView: true, canEdit: false, canManage: false };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function renderPage(
  overrides: Partial<{ capability: typeof editorCapability; askXiaozeEnabled: boolean; initialEntryId: string | null }> = {}
) {
  const repository = createMockKnowledgeRepository();
  const utils = render(
    <KnowledgePage
      repository={repository}
      capability={overrides.capability ?? editorCapability}
      askXiaozeEnabled={overrides.askXiaozeEnabled ?? false}
      initialEntryId={overrides.initialEntryId ?? null}
    />
  );
  return { repository, ...utils };
}

describe("KnowledgePage", () => {
  it("shows unavailable statistics through cold failure and restores counts only after a successful list", async () => {
    const repository = createMockKnowledgeRepository();
    const entries = await repository.list();
    const cold = deferred<{ items: KnowledgeEntry[] }>();
    const retry = deferred<{ items: KnowledgeEntry[] }>();
    vi.spyOn(repository, "list").mockImplementationOnce(() => cold.promise)
      .mockImplementationOnce(() => retry.promise).mockResolvedValue(entries);
    render(<KnowledgePage repository={repository} capability={viewerCapability} />);
    const user = userEvent.setup();

    expect(screen.getByText("知识条目统计加载中…")).toBeInTheDocument();
    expect(screen.queryByText(/已发布 \d+ 条 · 草稿 \d+ 条/)).not.toBeInTheDocument();
    await act(async () => cold.reject(new Error("Request failed.")));
    expect(screen.getByText("知识条目统计暂不可用")).toBeInTheDocument();
    expect(screen.queryByText(/已发布 \d+ 条 · 草稿 \d+ 条/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "刷新" }));
    expect(screen.getByText("知识条目统计加载中…")).toBeInTheDocument();
    await act(async () => retry.resolve({ items: [] }));
    expect(screen.getByText("已发布 0 条 · 草稿 0 条")).toBeInTheDocument();
    expect(screen.getByText(/知识库还是空的/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "刷新" }));
    expect(await screen.findByText(`已发布 ${entries.items.filter((entry) => entry.status === "published").length} 条 · 草稿 ${entries.items.filter((entry) => entry.status === "draft").length} 条`)).toBeInTheDocument();
    expect(screen.queryByText("知识条目统计暂不可用")).not.toBeInTheDocument();
    expect(screen.queryByText("知识条目统计加载中…")).not.toBeInTheDocument();
  });

  it("recognizes a new citation completion even when get returns the same object", async () => {
    const repository = createMockKnowledgeRepository();
    const entry = (await repository.get("mock-kb-1"))!;
    vi.spyOn(repository, "get").mockResolvedValue(entry);
    const list = vi.spyOn(repository, "list");
    render(<KnowledgePage repository={repository} capability={viewerCapability} initialEntryId={entry.id} />);
    await screen.findByRole("dialog", { name: /快充温控调参经验/ });
    const pending = deferred<{ items: KnowledgeEntry[] }>();
    list.mockImplementationOnce(() => pending.promise);
    await userEvent.setup().click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByRole("dialog", { name: /快充温控调参经验/ });
    await act(async () => pending.resolve({ items: [] }));
    expect(screen.getByRole("dialog", { name: /快充温控调参经验/ })).toBeInTheDocument();
  });

  it("suppresses the shared table fallback after a failed empty list", async () => {
    const repository = createMockKnowledgeRepository();
    vi.spyOn(repository, "list").mockRejectedValue(new Error("Request failed."));
    render(<KnowledgePage repository={repository} capability={viewerCapability} />);
    await screen.findByRole("alert");
    expect(screen.queryByText("当前筛选条件下没有数据。")).not.toBeInTheDocument();
    expect(screen.queryByText(/知识库还是空的/)).not.toBeInTheDocument();
  });

  it.each(["stale", "omitted", "retry-stale", "retry-omitted"])("keeps a fresh citation when the pending list is %s, and refreshes it later", async (snapshot) => {
    const repository = createMockKnowledgeRepository();
    const entry = (await repository.get("mock-kb-1"))!;
    const fresh = { ...entry, headRevisionNumber: 3, contentMarkdown: "当前引用修订三" };
    const later = { ...fresh, headRevisionNumber: 4, contentMarkdown: "稍后引用修订四" };
    const list = deferred<{ items: KnowledgeEntry[] }>();
    const listSpy = vi.spyOn(repository, "list");
    const get = vi.spyOn(repository, "get");
    const retry = snapshot.startsWith("retry-");
    if (retry) {
      listSpy.mockRejectedValueOnce(new Error("Request failed."));
      get.mockRejectedValueOnce(new Error("Request failed."));
    }
    listSpy.mockImplementationOnce(() => list.promise).mockResolvedValue({ items: [] });
    get.mockResolvedValueOnce(fresh).mockResolvedValueOnce(later);
    render(<KnowledgePage repository={repository} capability={viewerCapability} initialEntryId={entry.id} />);
    const user = userEvent.setup();
    if (retry) {
      await screen.findByRole("alert");
      await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
      await user.click(screen.getByRole("button", { name: "刷新" }));
    }
    await screen.findByText("当前引用修订三");
    await act(async () => list.resolve({ items: snapshot.endsWith("stale") ? [entry] : [] }));
    expect(screen.getByText("当前引用修订三")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByText("稍后引用修订四");
    expect(get.mock.calls).toEqual(Array.from({ length: retry ? 3 : 2 }, () => [entry.id]));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
    expect(get).toHaveBeenCalledTimes(retry ? 3 : 2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps a failed search failed through list refresh until search is retried", async () => {
    const repository = createMockKnowledgeRepository();
    const search = vi.spyOn(repository, "search").mockRejectedValueOnce(new Error("Request failed."));
    render(<KnowledgePage repository={repository} capability={viewerCapability} />);
    const user = userEvent.setup();
    await screen.findByText("快充温控调参经验");
    await user.type(screen.getByRole("searchbox", { name: "检索知识库" }), "不存在");
    await user.click(screen.getByRole("button", { name: "检索" }));
    await screen.findByText("检索失败，请稍后重试。");
    const list = deferred<{ items: KnowledgeEntry[] }>();
    vi.spyOn(repository, "list").mockImplementationOnce(() => list.promise);
    await user.click(screen.getByRole("button", { name: "刷新" }));
    expect(screen.getByText("检索失败，请稍后重试。")).toBeInTheDocument();
    expect(screen.queryByText(/命中 0 条/)).not.toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(1);
    await act(async () => list.resolve({ items: [] }));
    expect(screen.getByText("检索失败，请稍后重试。")).toBeInTheDocument();
    expect(screen.queryByText("没有命中已发布的知识条目。")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "检索" }));
    await screen.findByText("没有命中已发布的知识条目。");
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("retains list failure through successful empty search and clear", async () => {
    const repository = createMockKnowledgeRepository();
    vi.spyOn(repository, "list").mockRejectedValue(new Error("Request failed."));
    render(<KnowledgePage repository={repository} capability={viewerCapability} />);
    await screen.findByRole("alert");
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox", { name: "检索知识库" }), "不存在");
    await user.click(screen.getByRole("button", { name: "检索" }));
    await screen.findByText("没有命中已发布的知识条目。");
    await user.click(screen.getByRole("button", { name: "清除检索" }));
    expect(screen.getByText("知识条目加载失败，请稍后重试。")).toBeInTheDocument();
    expect(screen.queryByText(/知识库还是空的/)).not.toBeInTheDocument();
    expect(screen.queryByText("当前筛选条件下没有数据。")).not.toBeInTheDocument();
  });

  it.each(["resolve", "reject"])("ignores an old repository list's late %s and finally", async (outcome) => {
    const old = createMockKnowledgeRepository();
    const current = createMockKnowledgeRepository();
    const oldEntry = (await old.get("mock-kb-1"))!;
    const entry = { ...oldEntry, id: "current-id", title: "当前库条目", contentMarkdown: "当前库内容" };
    const oldList = deferred<{ items: KnowledgeEntry[] }>();
    const newList = deferred<{ items: KnowledgeEntry[] }>();
    vi.spyOn(old, "list").mockImplementation(() => oldList.promise);
    vi.spyOn(current, "list").mockImplementation(() => newList.promise);
    vi.spyOn(current, "get").mockResolvedValue(entry);
    const { rerender } = render(<KnowledgePage repository={old} capability={viewerCapability} />);
    rerender(<KnowledgePage repository={current} capability={viewerCapability} initialEntryId={entry.id} />);
    await screen.findByText("当前库内容");
    await act(async () => { if (outcome === "resolve") oldList.resolve({ items: [oldEntry] }); else oldList.reject(new Error("旧列表错误")); });
    expect(screen.getByRole("button", { name: "刷新" })).toBeDisabled();
    expect(screen.getByText("当前库内容")).toBeInTheDocument();
    expect(screen.queryByText("旧列表错误")).not.toBeInTheDocument();
    expect(screen.queryByText("快充温控调参经验")).not.toBeInTheDocument();
    await act(async () => newList.resolve({ items: [entry] }));
    expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled();
  });

  it.each(["resolve", "reject"])("clears old repository state and ignores its late search %s", async (outcome) => {
    const old = createMockKnowledgeRepository();
    const current = createMockKnowledgeRepository();
    const searchResult = await old.search("快充");
    const oldSearch = deferred<KnowledgeSearchResponse>();
    vi.spyOn(old, "search").mockImplementation(() => oldSearch.promise);
    vi.spyOn(current, "list").mockResolvedValue({ items: [] });
    const { rerender } = render(<KnowledgePage repository={old} capability={viewerCapability} />);
    const user = userEvent.setup();
    await screen.findByText("快充温控调参经验");
    await user.type(screen.getByRole("searchbox", { name: "检索知识库" }), "快充");
    await user.click(screen.getByRole("button", { name: "检索" }));
    rerender(<KnowledgePage repository={current} capability={viewerCapability} />);
    await act(async () => { if (outcome === "resolve") oldSearch.resolve(searchResult); else oldSearch.reject(new Error("旧检索错误")); });
    expect(screen.queryByLabelText("检索结果")).not.toBeInTheDocument();
    expect(screen.queryByText("快充温控调参经验")).not.toBeInTheDocument();
    expect(screen.queryByText("旧检索错误")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "检索知识库" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "检索" })).toBeEnabled();
    expect(screen.getByText(/知识库还是空的/)).toBeInTheDocument();
  });

  it("recovers the same failed citation on refresh without reopening a closed successful detail", async () => {
    const repository = createMockKnowledgeRepository();
    const get = vi.spyOn(repository, "get").mockRejectedValueOnce(new Error("Request failed."));
    vi.spyOn(repository, "list").mockRejectedValueOnce(new Error("Request failed."));
    render(<KnowledgePage repository={repository} capability={viewerCapability} initialEntryId="mock-kb-1" />);
    const user = userEvent.setup();

    expect(await screen.findByText("知识条目加载失败，请稍后重试。")).toBeInTheDocument();
    expect(screen.queryByText(/知识库还是空的/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "刷新" }));
    const detail = await screen.findByRole("dialog", { name: /快充温控调参经验/ });
    expect(within(detail).getByText(/当电池温度超过 45 度/)).toBeInTheDocument();
    expect(get.mock.calls).toEqual([["mock-kb-1"], ["mock-kb-1"]]);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not describe failed search results as zero successful matches", async () => {
    const repository = createMockKnowledgeRepository();
    vi.spyOn(repository, "search").mockRejectedValue(new Error("Request failed."));
    render(<KnowledgePage repository={repository} capability={viewerCapability} />);
    const user = userEvent.setup();
    await screen.findByText("快充温控调参经验");
    await user.type(screen.getByRole("searchbox", { name: "检索知识库" }), "快充");
    await user.click(screen.getByRole("button", { name: "检索" }));
    expect(await screen.findByText("检索失败，请稍后重试。")).toBeInTheDocument();
    expect(screen.queryByText("没有命中已发布的知识条目。")).not.toBeInTheDocument();
    expect(screen.queryByText(/命中 0 条/)).not.toBeInTheDocument();
  });

  it.each([null, "different-id"])("shows an unavailable citation without opening a replacement (%s)", async (replacementId) => {
    const repository = createMockKnowledgeRepository();
    const entry = await repository.get("mock-kb-1");
    vi.spyOn(repository, "list").mockResolvedValue({ items: [] });
    vi.spyOn(repository, "get").mockResolvedValue(replacementId && entry ? { ...entry, id: replacementId } : null);
    render(<KnowledgePage repository={repository} capability={viewerCapability} initialEntryId="missing-id" />);
    expect(await screen.findByText("引用的知识条目不存在或不可访问。")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/知识库还是空的/)).not.toBeInTheDocument();
    expect(screen.queryByText("当前筛选条件下没有数据。")).not.toBeInTheDocument();
  });

  it.each(["resolve", "reject"])("ignores a superseded citation's late %s", async (outcome) => {
    const repository = createMockKnowledgeRepository();
    const oldEntry = await repository.get("mock-kb-1");
    let resolve!: (value: typeof oldEntry) => void;
    let reject!: (error: Error) => void;
    vi.spyOn(repository, "get").mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
    const { rerender, unmount } = render(<KnowledgePage repository={repository} capability={viewerCapability} initialEntryId="mock-kb-1" />);
    rerender(<KnowledgePage repository={repository} capability={viewerCapability} initialEntryId="mock-kb-2" />);
    await screen.findByRole("dialog", { name: /SC8562 充电泵比率切换草稿/ });
    await act(async () => { if (outcome === "resolve") resolve(oldEntry); else reject(new Error("旧引用错误")); });
    expect(screen.getByRole("dialog", { name: /SC8562 充电泵比率切换草稿/ })).toBeInTheDocument();
    expect(screen.queryByText("旧引用错误")).not.toBeInTheDocument();
    unmount();
  });

  it("handles a citation rejection after unmount", async () => {
    const repository = createMockKnowledgeRepository();
    let reject!: (error: Error) => void;
    vi.spyOn(repository, "get").mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    const { unmount } = render(<KnowledgePage repository={repository} capability={viewerCapability} initialEntryId="mock-kb-1" />);
    unmount();
    await act(async () => reject(new Error("Request failed.")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("presents citation permission errors while preserving rows after a failed refresh", async () => {
    const { WiseEffApiError } = await import("@/infrastructure/http/apiClient");
    const repository = createMockKnowledgeRepository();
    vi.spyOn(repository, "get").mockRejectedValue(new WiseEffApiError("FORBIDDEN", "Forbidden", {}, "req-kb-citation"));
    const list = vi.spyOn(repository, "list");
    render(<KnowledgePage repository={repository} capability={viewerCapability} initialEntryId="foreign-entry" />);
    expect(await screen.findByText("没有权限执行该操作。")).toBeInTheDocument();
    await screen.findByText("快充温控调参经验");
    list.mockRejectedValueOnce(new Error("Request failed."));
    await userEvent.setup().click(screen.getByRole("button", { name: "刷新" }));
    expect(await screen.findByText("知识条目加载失败，请稍后重试。")).toBeInTheDocument();
    expect(screen.getByText("快充温控调参经验")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows empty-library guidance only after a successful empty list", async () => {
    const repository = createMockKnowledgeRepository();
    vi.spyOn(repository, "list").mockResolvedValue({ items: [] });
    render(<KnowledgePage repository={repository} capability={viewerCapability} />);
    expect(await screen.findByText(/知识库还是空的/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lists knowledge entries with status badges and extraction status", async () => {
    renderPage();

    const table = await screen.findByRole("table", { name: "知识条目列表" });
    expect(within(table).getByText("快充温控调参经验")).toBeInTheDocument();
    expect(within(table).getAllByText("已发布").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("草稿").length).toBeGreaterThan(0);
    expect(within(table).getByText("提取失败")).toBeInTheDocument();
  });

  it("hides create and upload actions from view-only users", async () => {
    renderPage({ capability: viewerCapability });

    await screen.findByRole("table", { name: "知识条目列表" });
    expect(screen.queryByRole("button", { name: /新建条目/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /上传文件条目/ })).not.toBeInTheDocument();
  });

  it("searches published entries only and states the retrieval mode honestly", async () => {
    renderPage();
    const user = userEvent.setup();

    await screen.findByRole("table", { name: "知识条目列表" });
    await user.type(screen.getByRole("searchbox", { name: "检索知识库" }), "快充");
    await user.click(screen.getByRole("button", { name: "检索" }));

    const results = await screen.findByLabelText("检索结果");
    expect(within(results).getByText("快充温控调参经验")).toBeInTheDocument();
    expect(within(results).getByText(/检索模式:仅全文检索/)).toBeInTheDocument();
    // The draft entry mentions sc8562 but drafts stay out of retrieval.
    await user.clear(screen.getByRole("searchbox", { name: "检索知识库" }));
    await user.type(screen.getByRole("searchbox", { name: "检索知识库" }), "充电泵比率切换");
    await user.click(screen.getByRole("button", { name: "检索" }));
    expect(await screen.findByText("没有命中已发布的知识条目。")).toBeInTheDocument();
  });

  it("shows the ask-the-knowledge-base entry in API mode only and dispatches the Xiaoze handoff", async () => {
    renderPage({ askXiaozeEnabled: true });
    const user = userEvent.setup();
    const handoff = new Promise<Event>((resolve) => {
      window.addEventListener("wiseeff:xiaoze-open-handoff", resolve, { once: true });
    });

    await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(screen.getByRole("button", { name: /问知识库/ }));
    const event = (await handoff) as CustomEvent<{ preset: string }>;
    expect(event.detail.preset).toBe("knowledge-ask");
  });

  it("hides the ask entry when Xiaoze is unavailable (mock mode)", async () => {
    renderPage({ askXiaozeEnabled: false });
    await screen.findByRole("table", { name: "知识条目列表" });
    expect(screen.queryByRole("button", { name: /问知识库/ })).not.toBeInTheDocument();
  });

  it("opens the entry detail from a citation deep link (?entryId=…)", async () => {
    renderPage({ initialEntryId: "mock-kb-1" });
    const detail = await screen.findByRole("dialog", { name: /快充温控调参经验/ });
    expect(within(detail).getByText(/当电池温度超过 45 度/)).toBeInTheDocument();
  });

  it("creates a markdown draft through the split editor", async () => {
    renderPage();
    const user = userEvent.setup();

    await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(screen.getByRole("button", { name: /新建条目/ }));

    const dialog = await screen.findByRole("dialog", { name: "新建 Markdown 条目" });
    await user.type(within(dialog).getByLabelText("条目标题"), "全新调参笔记");
    await user.type(within(dialog).getByLabelText("标签(逗号分隔)"), "tuning, project-aurora");
    await user.type(within(dialog).getByLabelText("Markdown 内容"), "# 摘要");
    expect(within(dialog).getByLabelText("预览").innerHTML).toContain("<h1>摘要</h1>");
    await user.click(within(dialog).getByRole("button", { name: "创建草稿" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "新建 Markdown 条目" })).not.toBeInTheDocument());
    // The new entry opens in the detail dialog as a draft.
    const detail = await screen.findByRole("dialog", { name: /全新调参笔记/ });
    expect(within(detail).getByText("草稿")).toBeInTheDocument();
  });

  it("publishes a draft from the detail dialog", async () => {
    const { repository } = renderPage();
    const user = userEvent.setup();

    const table = await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(within(table).getByText("SC8562 充电泵比率切换草稿"));

    const detail = await screen.findByRole("dialog", { name: /SC8562 充电泵比率切换草稿/ });
    await user.click(within(detail).getByRole("button", { name: "发布" }));

    await waitFor(async () => {
      const entry = await repository.get("mock-kb-2");
      expect(entry?.status).toBe("published");
    });
  });

  it("shows revision history and restores a prior revision as a new one", async () => {
    const { repository } = renderPage();
    const user = userEvent.setup();

    const table = await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(within(table).getByText("快充温控调参经验"));

    const detail = await screen.findByRole("dialog", { name: /快充温控调参经验/ });
    await user.click(within(detail).getByRole("button", { name: "修订历史" }));

    const revisions = await screen.findByRole("dialog", { name: /修订历史/ });
    expect(within(revisions).getByText("修订 #2")).toBeInTheDocument();
    expect(within(revisions).getByText("修订 #1")).toBeInTheDocument();

    await user.click(within(revisions).getByRole("button", { name: "恢复此版本" }));
    const confirm = await screen.findByRole("dialog", { name: /恢复修订 #1/ });
    await user.click(within(confirm).getByRole("button", { name: "恢复为新修订" }));

    await waitFor(async () => {
      const entry = await repository.get("mock-kb-1");
      expect(entry?.headRevisionNumber).toBe(3);
      expect(entry?.contentMarkdown).toContain("初版");
    });
  });

  it("labels a retained revision whose author account was deleted", async () => {
    const repository = createMockKnowledgeRepository();
    const listRevisions = repository.listRevisions.bind(repository);
    vi.spyOn(repository, "listRevisions").mockImplementation(async (entryId) =>
      (await listRevisions(entryId)).map((revision, index) =>
        index === 0 ? { ...revision, authorUserId: null } : revision
      )
    );
    render(
      <KnowledgePage
        repository={repository}
        capability={editorCapability}
        askXiaozeEnabled={false}
        initialEntryId={null}
      />
    );
    const user = userEvent.setup();

    const table = await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(within(table).getByText("快充温控调参经验"));
    const detail = await screen.findByRole("dialog", { name: /快充温控调参经验/ });
    await user.click(within(detail).getByRole("button", { name: "修订历史" }));

    expect(await within(screen.getByRole("dialog", { name: /修订历史/ })).findByText(/已注销用户/)).toBeInTheDocument();
  });

  it("uploads a file entry and shows its extraction status", async () => {
    renderPage();
    const user = userEvent.setup();

    await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(screen.getByRole("button", { name: /上传文件条目/ }));

    const dialog = await screen.findByRole("dialog", { name: "上传文件条目" });
    await user.type(within(dialog).getByLabelText("条目标题"), "上传的调参笔记");
    await user.upload(within(dialog).getByLabelText("选择文件"), new File(["hello"], "notes.txt", { type: "text/plain" }));
    await user.click(within(dialog).getByRole("button", { name: "上传并创建草稿" }));

    const detail = await screen.findByRole("dialog", { name: /上传的调参笔记/ });
    expect(within(detail).getByText("提取成功")).toBeInTheDocument();
    expect(within(detail).getByText("notes.txt")).toBeInTheDocument();
  });

  it("surfaces a readable conflict when a save is stale", async () => {
    const { repository } = renderPage();
    const user = userEvent.setup();

    const table = await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(within(table).getByText("快充温控调参经验"));
    const detail = await screen.findByRole("dialog", { name: /快充温控调参经验/ });
    await user.click(within(detail).getByRole("button", { name: "编辑" }));

    const editor = await screen.findByRole("dialog", { name: "编辑知识条目" });
    // A concurrent save moves the head revision while the editor is open.
    await repository.update("mock-kb-1", { expectedHeadRevisionNumber: 2, contentMarkdown: "并发修改" });

    await user.type(within(editor).getByLabelText("Markdown 内容"), " 追加");
    await user.click(within(editor).getByRole("button", { name: "保存为新修订" }));

    expect(await within(editor).findByRole("alert")).toHaveTextContent("保存冲突");
  });

  it("maps API failures to product-language copy when entry list load fails", async () => {
    const { WiseEffApiError } = await import("@/infrastructure/http/apiClient");
    const repository = createMockKnowledgeRepository();
    vi.spyOn(repository, "list").mockRejectedValue(
      new WiseEffApiError("FORBIDDEN", "Forbidden", {}, "req-kb-page-list")
    );
    render(
      <KnowledgePage
        repository={repository}
        capability={editorCapability}
        askXiaozeEnabled={false}
        initialEntryId={null}
      />
    );

    expect(await screen.findByText("没有权限执行该操作。")).toBeInTheDocument();
  });
});
