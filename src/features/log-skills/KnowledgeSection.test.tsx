import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeEntry } from "@/domain/knowledge/types";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { createMockKnowledgeRepository } from "@/infrastructure/mock/mockKnowledgeRepository";
import { KnowledgeSection } from "./KnowledgeSection";
import { SkillSpecDiff } from "./SkillSpecDiff";
import type { SkillSpec } from "./types";

afterEach(cleanup);
const entry = (id: string, status: KnowledgeEntry["status"] = "published"): KnowledgeEntry => ({
  id, title: `${id} 知识`, contentForm: "markdown", status, origin: "authored", tags: [], sourceType: "human", sourceSessionId: null,
  sourceLogId: null, sourceReloadRunId: null, createdByUserId: "user", headRevisionNumber: 3,
  createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-02T10:00:00Z", publishedAt: null, archivedAt: null,
  contentMarkdown: "# Knowledge", file: null, parameterReferences: []
});
function setup(options: { ids?: string[]; canViewKnowledge?: boolean; canEditKnowledge?: boolean; disabled?: boolean; get?: (id: string) => Promise<KnowledgeEntry | null>; create?: (input: { title: string }) => Promise<KnowledgeEntry> } = {}) {
  const repository = {
    getBinding: vi.fn(async (id: string) => ({ entry: options.get ? await options.get(id) : entry(id), deleted: id === "deleted" })),
    list: vi.fn(async () => ({ items: [entry("existing"), entry("draft", "draft")] })),
    createFile: vi.fn(options.create ?? (async ({ title }: { title: string }) => ({ ...entry(title, "draft"), title })))
  };
  const changed = vi.fn(); const busy = vi.fn();
  function Harness() {
    const [spec, setSpec] = useState<SkillSpec>({ schemaVersion: "skill/v1", knowledgeEntryIds: options.ids ?? [] });
    return <KnowledgeSection spec={spec} setSpec={(value) => { setSpec(value); changed(value); }} disabled={options.disabled ?? false} apiMode
      knowledgeRepository={repository as unknown as KnowledgeRepository} knowledgeCapability={{ canView: options.canViewKnowledge ?? true, canEdit: options.canEditKnowledge ?? true, canManage: false, userId: "user" }}
      onBusyChange={busy} />;
  }
  render(<Harness />);
  return { repository, changed, busy };
}
const markdownFile = (name: string, content: string) => {
  const file = new File([content], name, { type: "text/markdown" });
  Object.defineProperty(file, "text", { value: async () => content });
  return file;
};

describe("knowledge skill section", () => {
  it("pages searches and navigates linked titles", async () => {
    const repository = { getBinding: vi.fn(async () => ({ entry: entry("linked"), deleted: false })),
      list: vi.fn().mockResolvedValueOnce({ items: Array.from({ length: 100 }, (_, i) => entry(`page-${i}`)) })
        .mockResolvedValueOnce({ items: [entry("next")] }).mockResolvedValue({ items: [entry("searched")] }) };
    const onNavigate = vi.fn();
    render(<KnowledgeSection spec={{ schemaVersion: "skill/v1", knowledgeEntryIds: ["linked"] }} setSpec={vi.fn()} disabled={false} apiMode
      knowledgeRepository={repository as unknown as KnowledgeRepository} knowledgeCapability={{ canView: true, canEdit: true, canManage: false, userId: "user" }} onBusyChange={vi.fn()} onNavigate={onNavigate} />);
    await userEvent.click(await screen.findByRole("link", { name: "linked 知识" }));
    expect(onNavigate).toHaveBeenCalledWith("/knowledge?entryId=linked");
    await userEvent.click(screen.getByRole("button", { name: "链接已有条目" }));
    await userEvent.click(await screen.findByRole("button", { name: "加载更多" }));
    expect(await screen.findByText("next 知识")).toBeVisible();
    expect(screen.getByText("page-0 知识")).toBeVisible();
    expect(repository.list).toHaveBeenLastCalledWith({ status: "published", q: undefined, limit: 100, offset: 100 });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "search" } });
    expect(await screen.findByText("searched 知识")).toBeVisible();
    expect(screen.queryByText("page-0 知识")).not.toBeInTheDocument();
    expect(repository.list).toHaveBeenLastCalledWith({ status: "published", q: "search", limit: 100, offset: 0 });
  });
  it("expands an exact tag into published identities independently of title search, without subscribing to later tags", async () => {
    const repository = createMockKnowledgeRepository({ userId: "user" }, { revisions: [], entries: [
      { ...entry("linked"), tags: ["充电"] }, { ...entry("second"), tags: ["充电"] },
      { ...entry("private", "draft"), tags: ["充电"] }, { ...entry("archived", "archived"), tags: ["充电"] },
      { ...entry("other"), tags: ["充电器"] }
    ] });
    const changed = vi.fn();
    function Harness() {
      const [spec, setSpec] = useState<SkillSpec>({ schemaVersion: "skill/v1", knowledgeEntryIds: ["linked"] });
      return <KnowledgeSection spec={spec} setSpec={(next) => { changed(next); setSpec(next); }} disabled={false} apiMode
        knowledgeRepository={repository} knowledgeCapability={{ canView: true, canEdit: false, canManage: false, userId: "user" }} onBusyChange={vi.fn()} />;
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "链接已有条目" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "no title matches" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "知识标签" }), { target: { value: " 充电 " } });
    await userEvent.click(within(dialog).getByRole("button", { name: "添加此标签的全部已发布条目" }));
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith({ schemaVersion: "skill/v1", knowledgeEntryIds: ["linked", "second"] }));
    const later = await repository.createMarkdown({ title: "later", tags: ["充电"], contentMarkdown: "later" });
    await repository.publish(later.id);
    expect(changed).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByRole("button", { name: "完成" }));
    expect(await screen.findByRole("table", { name: "已链接知识条目" })).not.toHaveTextContent("later");
  });

  it("shows a read failure as retryable rather than deleted", async () => {
    let failed = false;
    setup({ ids: ["linked"], get: async (id) => {
      if (!failed) { failed = true; throw new Error("Network unavailable"); }
      return entry(id);
    } });
    expect(await screen.findByText("无法加载已链接知识")).toBeVisible();
    expect(screen.queryByText("已删除")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("linked 知识")).toBeVisible();
  });
  it.each([0, 200, 201])("handles %i published tag matches without silently truncating the selection", async (count) => {
    const repository = createMockKnowledgeRepository({}, { revisions: [], entries: Array.from({ length: count }, (_, i) => ({ ...entry(`tag-${i}`), tags: ["充电"] })) });
    const changed = vi.fn();
    render(<KnowledgeSection spec={{ schemaVersion: "skill/v1" }} setSpec={changed} disabled={false} apiMode
      knowledgeRepository={repository} knowledgeCapability={{ canView: true, canEdit: false, canManage: false, userId: "user" }} onBusyChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "链接已有条目" }));
    const dialog = screen.getByRole("dialog");
    const add = within(dialog).getByRole("button", { name: "添加此标签的全部已发布条目" });
    expect(add).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "知识标签" }), { target: { value: "充电" } });
    await userEvent.click(add);
    if (count === 200) {
      await waitFor(() => expect(changed).toHaveBeenCalledOnce());
      expect(changed.mock.calls[0][0].knowledgeEntryIds).toEqual(Array.from({ length: 200 }, (_, i) => `tag-${i}`));
    } else {
      expect(await within(dialog).findByText(count ? /全部添加后超过/ : "此标签没有已发布条目，未更改链接。")).toBeVisible();
      expect(changed).not.toHaveBeenCalled();
    }
  });

  it("preserves existing bindings on tag lookup failure and allows retry", async () => {
    const { repository, changed, busy } = setup({ ids: ["linked"] });
    await userEvent.click(screen.getByRole("button", { name: "链接已有条目" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("existing 知识");
    repository.list.mockRejectedValueOnce(new Error("Offline"));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "知识标签" }), { target: { value: "充电" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "添加此标签的全部已发布条目" }));
    expect(await within(dialog).findByRole("alert")).toBeVisible();
    expect(changed).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "添加此标签的全部已发布条目" }));
    await waitFor(() => expect(changed).toHaveBeenCalledWith({ schemaVersion: "skill/v1", knowledgeEntryIds: ["linked", "existing"] }));
    expect(busy.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  it("blocks repeated additions while loading and preserves the draft when the combined links exceed capacity", async () => {
    const { repository, changed, busy } = setup({ ids: Array.from({ length: 199 }, (_, i) => `linked-${i}`) });
    await userEvent.click(screen.getByRole("button", { name: "链接已有条目" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("existing 知识");
    let finish!: (value: { items: KnowledgeEntry[] }) => void;
    repository.list.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "知识标签" }), { target: { value: "充电" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "添加此标签的全部已发布条目" }));
    expect(within(dialog).getByRole("button", { name: "正在添加…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "完成" })).toBeDisabled();
    finish({ items: [entry("existing"), entry("second")] });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("未更改链接");
    expect(changed).not.toHaveBeenCalled();
    expect(busy.mock.calls).toEqual([[true], [false]]);
  });

  it("keeps archived and deleted bindings visible and removable", async () => {
    const { changed } = setup({ ids: ["archived", "deleted"], get: async (id) => id === "deleted" ? null : entry(id, "archived") });
    const table = await screen.findByRole("table", { name: "已链接知识条目" });
    expect(within(table).getByText("archived 知识")).toBeVisible();
    expect(within(table).getByText("已归档，不参与检索")).toBeVisible();
    expect(within(table).getByText("已删除")).toBeVisible();
    await userEvent.click(within(table).getByRole("button", { name: "取消链接 已删除" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(changed).toHaveBeenLastCalledWith({ schemaVersion: "skill/v1", knowledgeEntryIds: ["archived"] });
  });
  it.each([
    { name: "manager loses knowledge management", before: { userId: "viewer", canManage: true }, after: { userId: "viewer", canManage: false } },
    { name: "draft owner changes to another user", before: { userId: "owner", canManage: false }, after: { userId: "viewer", canManage: false } }
  ])("redacts cached private metadata when $name", async ({ before, after }) => {
    const privateEntry = { ...entry("private-id", "draft"), title: "Private draft title", createdByUserId: "owner" };
    const get = vi.fn(async () => ({ entry: privateEntry, deleted: false }));
    const props = { spec: { schemaVersion: "skill/v1" as const, knowledgeEntryIds: ["private-id"] }, setSpec: vi.fn(), disabled: false, apiMode: true,
      knowledgeRepository: { getBinding: get } as unknown as KnowledgeRepository, onBusyChange: vi.fn() };
    const { rerender } = render(<KnowledgeSection {...props} knowledgeCapability={{ canView: true, canEdit: true, ...before }} />);
    expect(await screen.findByText(privateEntry.title)).toBeVisible();
    rerender(<KnowledgeSection {...props} knowledgeCapability={{ canView: true, canEdit: true, ...after }} />);
    expect(screen.queryByText(privateEntry.title)).not.toBeInTheDocument();
    expect(screen.queryByTitle(privateEntry.title)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `取消链接 ${privateEntry.title}` })).not.toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("无权查看的条目")).toBeVisible();
    expect(screen.getByRole("button", { name: "取消链接 无权查看的条目" })).toBeEnabled();
    expect(screen.queryByText("private-id")).not.toBeInTheDocument();
    const table = screen.getByRole("table", { name: "已链接知识条目" });
    expect(within(table).getAllByRole("cell").slice(1, 4).map((cell) => cell.textContent)).toEqual(["", "", ""]);
  });
  it.each([true, false])("keeps unreadable linked IDs removable without exposing metadata (knowledge view: %s)", async (canViewKnowledge) => {
    const { repository, changed } = setup({ ids: ["hidden-entry"], canViewKnowledge, get: async () => null });
    const table = await screen.findByRole("table", { name: "已链接知识条目" });
    expect(within(table).getByText("无权查看的条目")).toBeVisible();
    expect(within(table).queryByText("hidden-entry")).not.toBeInTheDocument();
    const cells = within(table).getAllByRole("cell");
    expect(cells.slice(1, 4).map((cell) => cell.textContent)).toEqual(["", "", ""]);
    if (!canViewKnowledge) expect(repository.getBinding).not.toHaveBeenCalled();
    await userEvent.click(within(table).getByRole("button", { name: "取消链接 无权查看的条目" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(changed).toHaveBeenLastCalledWith({ schemaVersion: "skill/v1", knowledgeEntryIds: [] });
  });
  it("lists linked entry metadata and unlinks only from the skill draft", async () => {
    const { repository, changed } = setup({ ids: ["linked"] });
    const table = await screen.findByRole("table", { name: "已链接知识条目" });
    expect(within(table).getByText("linked 知识")).toBeVisible();
    expect(within(table).getByText("已发布")).toBeVisible();
    expect(within(table).getByText("v3")).toBeVisible();
    expect(within(table).getAllByRole("cell")[3].querySelector("span")).toHaveAttribute("title");
    await userEvent.click(within(table).getByRole("button", { name: "取消链接 linked 知识" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(changed).toHaveBeenLastCalledWith({ schemaVersion: "skill/v1", knowledgeEntryIds: [] });
    expect(repository.createFile).not.toHaveBeenCalled();
    expect(await screen.findByText("尚未链接知识")).toBeVisible();
  });

  it("searches published entries and links a selected entry without changing knowledge publication", async () => {
    const { repository, changed } = setup();
    await userEvent.click(screen.getByRole("button", { name: "链接已有条目" }));
    const dialog = screen.getByRole("dialog", { name: "链接已有条目" });
    await within(dialog).findByRole("button", { name: "链接 existing 知识" });
    expect(within(dialog).queryByText("draft 知识")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "搜索已发布知识" }), { target: { value: "thermal" } });
    await waitFor(() => expect(repository.list).toHaveBeenLastCalledWith({ status: "published", q: "thermal", limit: 100, offset: 0 }));
    await userEvent.click(await within(dialog).findByRole("button", { name: "链接 existing 知识" }));
    expect(changed).toHaveBeenLastCalledWith({ schemaVersion: "skill/v1", knowledgeEntryIds: ["existing"] });
    expect(await within(dialog).findByRole("button", { name: "已链接 existing 知识" })).toBeDisabled();
    expect(repository.createFile).not.toHaveBeenCalled();
  });

  it("keeps picker loading and empty states and exposes a full long title", async () => {
    const { repository } = setup();
    let finishSearch!: (value: { items: KnowledgeEntry[] }) => void;
    repository.list.mockReturnValueOnce(new Promise((resolve) => { finishSearch = resolve; }));
    await userEvent.click(screen.getByRole("button", { name: "链接已有条目" }));
    const dialog = screen.getByRole("dialog", { name: "链接已有条目" });
    expect(within(dialog).getByRole("status", { name: "正在搜索知识条目" })).toBeVisible();
    finishSearch({ items: [] });
    expect(await within(dialog).findByText("没有匹配的已发布知识")).toBeVisible();
    const title = "LongUnbrokenKnowledgeTitle".repeat(10);
    repository.list.mockResolvedValueOnce({ items: [{ ...entry("long"), title }] });
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "搜索已发布知识" }), { target: { value: "Long" } });
    expect(await within(dialog).findByText(title)).toHaveAttribute("title", title);
    expect(within(dialog).getByRole("button", { name: `链接 ${title}` })).toBeVisible();
  });

  it("uploads multiple dropped Markdown files through normal knowledge creation and links their drafts", async () => {
    const { repository, changed, busy } = setup({ ids: ["linked"] });
    await userEvent.click(screen.getByRole("button", { name: "上传 Markdown / 文本" }));
    const dialog = screen.getByRole("dialog", { name: "上传 Markdown / 文本" });
    fireEvent.drop(within(dialog).getByRole("region", { name: "拖放 Markdown / 文本文件" }), {
      dataTransfer: { files: [markdownFile("thermal.md", "# Thermal\nCheck cooling."), markdownFile("protocol.TXT", "# Protocol")] }
    });
    expect(within(dialog).getByText(/thermal.md/)).toBeVisible();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "创建并链接" })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole("button", { name: "创建并链接" }));
    await waitFor(() => expect(repository.createFile).toHaveBeenCalledTimes(2));
    expect(repository.createFile).toHaveBeenNthCalledWith(1, { title: "thermal", tags: [], file: expect.objectContaining({ name: "thermal.md" }) });
    expect(repository.createFile).toHaveBeenNthCalledWith(2, { title: "protocol", tags: [], file: expect.objectContaining({ name: "protocol.TXT" }) });
    expect(changed).toHaveBeenLastCalledWith({ schemaVersion: "skill/v1", knowledgeEntryIds: ["linked", "thermal", "protocol"] });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(busy.mock.calls).toEqual([[true], [false]]);
  });

  it("validates each selected file, exposes sizes and removal, and uploads valid siblings", async () => {
    const { repository } = setup();
    await userEvent.click(screen.getByRole("button", { name: "上传 Markdown / 文本" }));
    const dialog = screen.getByRole("dialog", { name: "上传 Markdown / 文本" });
    expect(within(dialog).getByTestId("file-drop-zone-input")).not.toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Markdown / 文本文件" })).toBeVisible();
    const oversized = markdownFile("oversized.md", "large");
    Object.defineProperty(oversized, "size", { value: 20 * 1024 * 1024 + 1 });
    fireEvent.drop(within(dialog).getByRole("region", { name: "拖放 Markdown / 文本文件" }), { dataTransfer: { files: [
      markdownFile("bad.pdf", "bad"), oversized, markdownFile("valid.md", "# Valid")
    ] } });
    expect(await within(dialog).findByText("仅支持 .md 和 .txt 文件。")).toBeVisible();
    expect(within(dialog).getByText("文件超过知识库 20 MiB 上限。")).toBeVisible();
    expect(within(dialog).getByText(/7 B/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "移除 bad.pdf" }));
    expect(within(dialog).queryByText("bad.pdf")).not.toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "创建并链接" })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole("button", { name: "创建并链接" }));
    await waitFor(() => expect(repository.createFile).toHaveBeenCalledTimes(1));
    expect(repository.createFile).toHaveBeenCalledWith({ title: "valid", tags: [], file: expect.objectContaining({ name: "valid.md" }) });
    expect(dialog).toBeVisible();
    expect(await within(dialog).findByText("已创建并链接")).toBeVisible();
  });

  it("disables upload with its permission reason while allowing published links", async () => {
    setup({ canEditKnowledge: false });
    const upload = screen.getByRole("button", { name: "上传 Markdown / 文本" });
    expect(upload).toBeDisabled();
    expect(upload).toHaveAccessibleDescription("上传 Markdown / 文本 需要知识编辑权限。");
    expect(screen.getByText("上传 Markdown / 文本 需要知识编辑权限。")).toBeVisible();
    expect(screen.getByRole("button", { name: "链接已有条目" })).toBeEnabled();
  });

  it("keeps files within the remaining link capacity valid and rejects excess files before creating entries", async () => {
    const { repository } = setup({ ids: Array.from({ length: 199 }, (_, index) => `entry-${index}`) });
    await userEvent.click(screen.getByRole("button", { name: "上传 Markdown / 文本" }));
    const dialog = screen.getByRole("dialog", { name: "上传 Markdown / 文本" });
    fireEvent.drop(within(dialog).getByRole("region", { name: "拖放 Markdown / 文本文件" }), {
      dataTransfer: { files: [markdownFile("one.md", "one"), markdownFile("two.md", "two")] }
    });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("每个技能最多链接 200 个知识条目");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "创建并链接" })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole("button", { name: "创建并链接" }));
    await waitFor(() => expect(repository.createFile).toHaveBeenCalledTimes(1));
    expect(repository.createFile).toHaveBeenCalledWith(expect.objectContaining({ title: "one" }));
  });

  it("rejects non-Markdown drops and preserves successful creations when a later file fails", async () => {
    let calls = 0;
    let finishFirst!: (entry: KnowledgeEntry) => void;
    const { repository, changed } = setup({ create: async ({ title }) => {
      if (++calls === 1) return new Promise<KnowledgeEntry>((resolve) => { finishFirst = resolve; });
      if (calls === 2) throw new WiseEffApiError("FORBIDDEN", "Forbidden", {}, "request");
      return entry(title, "draft");
    } });
    await userEvent.click(screen.getByRole("button", { name: "上传 Markdown / 文本" }));
    const dialog = screen.getByRole("dialog", { name: "上传 Markdown / 文本" });
    const drop = within(dialog).getByRole("region", { name: "拖放 Markdown / 文本文件" });
    fireEvent.drop(drop, { dataTransfer: { files: [markdownFile("bad.pdf", "bad")] } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("仅支持 .md 和 .txt 文件");
    expect(within(dialog).getByRole("button", { name: "创建并链接" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("button", { name: "移除 bad.pdf" }));
    fireEvent.change(within(dialog).getByTestId("file-drop-zone-input"), { target: { files: [markdownFile("one.md", "one"), markdownFile("two.md", "two"), markdownFile("three.md", "three")] } });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "创建并链接" })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole("button", { name: "创建并链接" }));
    expect(within(dialog).getByText("正在创建…")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Markdown / 文本文件" })).toBeDisabled();
    finishFirst(entry("one", "draft"));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("没有权限执行该操作"));
    expect(changed).toHaveBeenLastCalledWith({ schemaVersion: "skill/v1", knowledgeEntryIds: ["one", "three"] });
    expect(within(dialog).getByRole("list", { name: "待上传文件" })).toHaveTextContent("two.md");
    expect(within(dialog).getAllByText("已创建并链接")).toHaveLength(2);
    expect(within(dialog).getByText(/已创建的条目保留在当前未保存草稿中/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "创建并链接" }));
    await waitFor(() => expect(repository.createFile).toHaveBeenCalledTimes(4));
    expect(changed).toHaveBeenLastCalledWith({ schemaVersion: "skill/v1", knowledgeEntryIds: ["one", "three", "two"] });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("rejects decoded Markdown beyond the normal knowledge body limit before creating an entry", async () => {
    const { repository } = setup();
    await userEvent.click(screen.getByRole("button", { name: "上传 Markdown / 文本" }));
    const dialog = screen.getByRole("dialog", { name: "上传 Markdown / 文本" });
    fireEvent.change(within(dialog).getByTestId("file-drop-zone-input"), { target: { files: [markdownFile("long.md", "中".repeat(200_001))] } });
    expect(await within(dialog).findByText("正文超过知识库 200,000 字符上限。")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "创建并链接" })).toBeDisabled();
    expect(repository.createFile).not.toHaveBeenCalled();
  });

  it("includes knowledge link changes in the publication review", () => {
    render(<SkillSpecDiff before={{ schemaVersion: "skill/v1" }} after={{ schemaVersion: "skill/v1", knowledgeEntryIds: ["linked"] }} />);
    expect(screen.getByText("知识 1 项")).toBeVisible();
    expect(screen.getByLabelText("知识差异")).toHaveTextContent("linked");
  });
});
