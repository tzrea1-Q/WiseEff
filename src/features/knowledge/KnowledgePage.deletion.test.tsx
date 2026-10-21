import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { createApiClient } from "@/infrastructure/http/apiClient";
import { createHttpKnowledgeRepository, type KnowledgeEntryDto } from "@/infrastructure/http/knowledgeClient";
import { KnowledgePage } from "./KnowledgePage";

const manager = { userId: "manager", canView: true, canEdit: true, canManage: true };
const draft: KnowledgeEntryDto = {
  id: "human-draft",
  organizationId: "org-1",
  title: "待清理的人工草稿",
  contentForm: "markdown",
  status: "draft",
  tags: [],
  sourceType: "human",
  origin: "authored",
  sourceSessionId: null,
  sourceLogId: null,
  sourceReloadRunId: null,
  createdByUserId: "author",
  headRevisionId: "revision-2",
  headRevisionNumber: 2,
  createdAt: "2026-10-20T08:00:00.000Z",
  updatedAt: "2026-10-20T08:00:00.000Z",
  publishedAt: null,
  archivedAt: null,
  contentMarkdown: "待清理的正文",
  file: null,
  parameterReferences: []
};

// The network is the boundary: exercise the real HTTP adapter and rendered page.
function knowledgeApi(entry = draft) {
  let retained: KnowledgeEntryDto | null = entry;
  let deleteStatus = 200;
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    let body: unknown;
    let status = 200;
    if (init?.method === "DELETE") {
      status = retained ? deleteStatus : 404;
      if (status === 200) retained = null;
      body = status === 200 ? { deleted: true } : { error: { code: status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR", message: status === 404 ? "Knowledge entry not found" : "删除暂不可用" } };
    } else if (path.endsWith("/entries")) {
      body = { items: retained ? [retained] : [] };
    } else {
      status = retained ? 200 : 404;
      body = retained ? { item: retained } : { error: { code: "NOT_FOUND" } };
    }
    return new Response(JSON.stringify(body), { status });
  };
  const repository = createHttpKnowledgeRepository({
    baseUrl: "http://knowledge.test",
    apiClient: createApiClient({ baseUrl: "http://knowledge.test", fetchImpl })
  });
  return { repository, failDelete: () => { deleteStatus = 500; }, allowDelete: () => { deleteStatus = 200; }, removeElsewhere: () => { retained = null; } };
}

describe("human knowledge draft deletion through the HTTP adapter", () => {
  it("keeps the independent body visible and replaces a removed log's navigation with its source status", async () => {
    const { repository } = knowledgeApi({ ...draft, sourceLogDeleted: true });
    render(<KnowledgePage repository={repository} capability={manager} />);
    const table = await screen.findByRole("table", { name: "知识条目列表" });
    await userEvent.click(within(table).getByText(draft.title));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("来源已删除")).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: "查看日志分析" })).toBeNull();
    expect(within(dialog).getByText(draft.contentMarkdown!)).toBeVisible();
  });
  it("deletes directly from the list only after confirmation and refreshes the list", async () => {
    const { repository } = knowledgeApi();
    render(<KnowledgePage repository={repository} capability={manager} />);
    const user = userEvent.setup();
    const table = await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(within(table).getByRole("button", { name: /：更多$/ }));
    await user.click(screen.getByRole("menuitem", { name: "彻底删除" }));
    const confirmation = await screen.findByRole("dialog", { name: /彻底删除/ });
    expect(confirmation).toHaveTextContent("全部 2 个修订");
    expect(confirmation).toHaveTextContent("关联引用");
    expect(confirmation).toHaveTextContent("存储中的原始文件保留");
    await user.click(within(confirmation).getByRole("button", { name: "取消" }));
    expect(within(table).getByText(draft.title)).toBeInTheDocument();

    await user.click(within(table).getByRole("button", { name: /：更多$/ }));
    await user.click(screen.getByRole("menuitem", { name: "彻底删除" }));
    const confirmed = await screen.findByRole("dialog", { name: /彻底删除/ });
    expect(within(confirmed).getByRole("button", { name: "彻底删除" })).toBeDisabled();
    await user.click(within(confirmed).getByRole("checkbox"));
    await user.click(within(confirmed).getByRole("button", { name: "彻底删除" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText(draft.title)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "刷新" }));
    expect(await screen.findByText(/知识库还是空的/)).toBeInTheDocument();
  });

  it("keeps a deep-linked draft and its error on failure, then closes it after a successful retry", async () => {
    const api = knowledgeApi();
    api.failDelete();
    render(<KnowledgePage repository={api.repository} capability={manager} initialEntryId={draft.id} />);
    const user = userEvent.setup();
    const detail = await screen.findByRole("dialog", { name: new RegExp(draft.title) });
    await user.click(within(detail).getByRole("button", { name: "彻底删除" }));
    const confirmation = await screen.findByRole("dialog", { name: /彻底删除/ });
    await user.click(within(confirmation).getByRole("checkbox"));
    await user.click(within(confirmation).getByRole("button", { name: "彻底删除" }));
    expect(await within(confirmation).findByRole("alert")).toHaveTextContent("删除暂不可用");
    expect(within(detail).getByText("待清理的正文")).toBeInTheDocument();
    await user.click(within(confirmation).getByRole("button", { name: "取消" }));
    expect(within(detail).getByRole("button", { name: "彻底删除" })).toHaveFocus();
    api.allowDelete();
    await user.click(within(detail).getByRole("button", { name: "彻底删除" }));
    const retry = await screen.findByRole("dialog", { name: /彻底删除/ });
    await user.click(within(retry).getByRole("checkbox"));
    await user.click(within(retry).getByRole("button", { name: "彻底删除" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText(draft.title)).not.toBeInTheDocument();
  });

  it.each([
    { capability: { ...manager, canManage: false }, entry: draft, scenario: "an editor's human draft" },
    { capability: manager, entry: { ...draft, sourceType: "agent" as const }, scenario: "an Agent draft" },
    { capability: manager, entry: { ...draft, status: "published" as const }, scenario: "a published entry" }
  ])("does not offer direct draft deletion for $scenario", async ({ capability, entry }) => {
    const { repository } = knowledgeApi(entry);
    render(<KnowledgePage repository={repository} capability={capability} />);
    const user = userEvent.setup();
    const table = await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(within(table).getByRole("button", { name: /：更多$/ }));
    expect(screen.queryByRole("menuitem", { name: "彻底删除" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(within(table).getByRole("button", { name: "查看" }));
    const detail = await screen.findByRole("dialog", { name: new RegExp(draft.title) });
    expect(within(detail).queryByRole("button", { name: "彻底删除" })).not.toBeInTheDocument();
  });

  it("explains a concurrent deletion without hiding the current page or repeating a successful write", async () => {
    const api = knowledgeApi();
    render(<KnowledgePage repository={api.repository} capability={manager} initialEntryId={draft.id} />);
    const user = userEvent.setup();
    const detail = await screen.findByRole("dialog", { name: new RegExp(draft.title) });
    await user.click(within(detail).getByRole("button", { name: "彻底删除" }));
    const confirmation = await screen.findByRole("dialog", { name: /彻底删除/ });
    api.removeElsewhere();
    await user.click(within(confirmation).getByRole("checkbox"));
    await user.click(within(confirmation).getByRole("button", { name: "彻底删除" }));
    expect(await within(confirmation).findByRole("alert")).toHaveTextContent("请求的内容不存在或已被移除");
    await user.keyboard("{Escape}");
    expect(within(detail).getByText("待清理的正文")).toBeInTheDocument();
  });
});
