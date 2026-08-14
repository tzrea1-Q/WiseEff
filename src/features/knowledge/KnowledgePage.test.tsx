import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createMockKnowledgeRepository } from "@/infrastructure/mock/mockKnowledgeRepository";
import { KnowledgePage } from "./KnowledgePage";

const editorCapability = { userId: "u-xu-yun", canView: true, canEdit: true, canManage: false };
const viewerCapability = { userId: "u-viewer", canView: true, canEdit: false, canManage: false };

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
