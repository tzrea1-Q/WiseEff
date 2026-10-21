import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeEntry } from "@/domain/knowledge/types";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
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
    get: vi.fn(options.get ?? (async (id: string) => entry(id))),
    list: vi.fn(async () => ({ items: [entry("existing"), entry("draft", "draft")] })),
    createMarkdown: vi.fn(options.create ?? (async ({ title }: { title: string }) => ({ ...entry(title, "draft"), title })))
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
  it.each([
    { name: "manager loses knowledge management", before: { userId: "viewer", canManage: true }, after: { userId: "viewer", canManage: false } },
    { name: "draft owner changes to another user", before: { userId: "owner", canManage: false }, after: { userId: "viewer", canManage: false } }
  ])("redacts cached private metadata when $name", async ({ before, after }) => {
    const privateEntry = { ...entry("private-id", "draft"), title: "Private draft title", createdByUserId: "owner" };
    const get = vi.fn(async () => privateEntry);
    const props = { spec: { schemaVersion: "skill/v1" as const, knowledgeEntryIds: ["private-id"] }, setSpec: vi.fn(), disabled: false, apiMode: true,
      knowledgeRepository: { get } as unknown as KnowledgeRepository, onBusyChange: vi.fn() };
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
    if (!canViewKnowledge) expect(repository.get).not.toHaveBeenCalled();
    await userEvent.click(within(table).getByRole("button", { name: "取消链接 无权查看的条目" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "取消链接" }));
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
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "取消链接" }));
    expect(changed).toHaveBeenLastCalledWith({ schemaVersion: "skill/v1", knowledgeEntryIds: [] });
    expect(repository.createMarkdown).not.toHaveBeenCalled();
    expect(await screen.findByText("尚未链接知识")).toBeVisible();
  });

  it("searches published entries and links a selected entry without changing knowledge publication", async () => {
    const { repository, changed } = setup();
    await userEvent.click(screen.getByRole("button", { name: "链接已有条目" }));
    const dialog = screen.getByRole("dialog", { name: "链接已有条目" });
    await within(dialog).findByRole("button", { name: "链接 existing 知识" });
    expect(within(dialog).queryByText("draft 知识")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "搜索已发布知识" }), { target: { value: "thermal" } });
    await waitFor(() => expect(repository.list).toHaveBeenLastCalledWith({ status: "published", q: "thermal" }));
    await userEvent.click(await within(dialog).findByRole("button", { name: "链接 existing 知识" }));
    expect(changed).toHaveBeenLastCalledWith({ schemaVersion: "skill/v1", knowledgeEntryIds: ["existing"] });
    expect(await within(dialog).findByRole("button", { name: "已链接 existing 知识" })).toBeDisabled();
    expect(repository.createMarkdown).not.toHaveBeenCalled();
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
    await userEvent.click(screen.getByRole("button", { name: "上传 Markdown" }));
    const dialog = screen.getByRole("dialog", { name: "上传 Markdown" });
    fireEvent.drop(within(dialog).getByRole("region", { name: "拖放 Markdown 文件" }), {
      dataTransfer: { files: [markdownFile("thermal.md", "# Thermal\nCheck cooling."), markdownFile("protocol.MD", "# Protocol")] }
    });
    expect(within(dialog).getByText(/thermal.md/)).toBeVisible();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "创建并链接" })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole("button", { name: "创建并链接" }));
    await waitFor(() => expect(repository.createMarkdown).toHaveBeenCalledTimes(2));
    expect(repository.createMarkdown).toHaveBeenNthCalledWith(1, { origin: "uploaded", title: "thermal", tags: [], contentMarkdown: "# Thermal\nCheck cooling." });
    expect(repository.createMarkdown).toHaveBeenNthCalledWith(2, { origin: "uploaded", title: "protocol", tags: [], contentMarkdown: "# Protocol" });
    expect(changed).toHaveBeenLastCalledWith({ schemaVersion: "skill/v1", knowledgeEntryIds: ["linked", "thermal", "protocol"] });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(busy.mock.calls).toEqual([[true], [false]]);
  });

  it("validates each selected file, exposes sizes and removal, and uploads valid siblings", async () => {
    const { repository } = setup();
    await userEvent.click(screen.getByRole("button", { name: "上传 Markdown" }));
    const dialog = screen.getByRole("dialog", { name: "上传 Markdown" });
    expect(within(dialog).getByTestId("file-drop-zone-input")).not.toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Markdown 文件" })).toBeVisible();
    const oversized = markdownFile("oversized.md", "large");
    Object.defineProperty(oversized, "size", { value: 20 * 1024 * 1024 + 1 });
    fireEvent.drop(within(dialog).getByRole("region", { name: "拖放 Markdown 文件" }), { dataTransfer: { files: [
      markdownFile("bad.txt", "bad"), oversized, markdownFile("valid.md", "# Valid")
    ] } });
    expect(await within(dialog).findByText("仅支持 .md 文件。")).toBeVisible();
    expect(within(dialog).getByText("文件超过知识库 20 MiB 上限。")).toBeVisible();
    expect(within(dialog).getByText(/7 B/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "移除 bad.txt" }));
    expect(within(dialog).queryByText("bad.txt")).not.toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "创建并链接" })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole("button", { name: "创建并链接" }));
    await waitFor(() => expect(repository.createMarkdown).toHaveBeenCalledTimes(1));
    expect(repository.createMarkdown).toHaveBeenCalledWith({ origin: "uploaded", title: "valid", tags: [], contentMarkdown: "# Valid" });
    expect(dialog).toBeVisible();
    expect(await within(dialog).findByText("已创建并链接")).toBeVisible();
  });

  it("disables upload with its permission reason while allowing published links", async () => {
    setup({ canEditKnowledge: false });
    const upload = screen.getByRole("button", { name: "上传 Markdown" });
    expect(upload).toBeDisabled();
    expect(upload).toHaveAccessibleDescription("上传 Markdown 需要知识编辑权限。");
    expect(screen.getByText("上传 Markdown 需要知识编辑权限。")).toBeVisible();
    expect(screen.getByRole("button", { name: "链接已有条目" })).toBeEnabled();
  });

  it("keeps files within the remaining link capacity valid and rejects excess files before creating entries", async () => {
    const { repository } = setup({ ids: Array.from({ length: 199 }, (_, index) => `entry-${index}`) });
    await userEvent.click(screen.getByRole("button", { name: "上传 Markdown" }));
    const dialog = screen.getByRole("dialog", { name: "上传 Markdown" });
    fireEvent.drop(within(dialog).getByRole("region", { name: "拖放 Markdown 文件" }), {
      dataTransfer: { files: [markdownFile("one.md", "one"), markdownFile("two.md", "two")] }
    });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("每个技能最多链接 200 个知识条目");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "创建并链接" })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole("button", { name: "创建并链接" }));
    await waitFor(() => expect(repository.createMarkdown).toHaveBeenCalledTimes(1));
    expect(repository.createMarkdown).toHaveBeenCalledWith(expect.objectContaining({ title: "one" }));
  });

  it("rejects non-Markdown drops and preserves successful creations when a later file fails", async () => {
    let calls = 0;
    let finishFirst!: (entry: KnowledgeEntry) => void;
    const { repository, changed } = setup({ create: async ({ title }) => {
      if (++calls === 1) return new Promise<KnowledgeEntry>((resolve) => { finishFirst = resolve; });
      if (calls === 2) throw new WiseEffApiError("FORBIDDEN", "Forbidden", {}, "request");
      return entry(title, "draft");
    } });
    await userEvent.click(screen.getByRole("button", { name: "上传 Markdown" }));
    const dialog = screen.getByRole("dialog", { name: "上传 Markdown" });
    const drop = within(dialog).getByRole("region", { name: "拖放 Markdown 文件" });
    fireEvent.drop(drop, { dataTransfer: { files: [markdownFile("bad.txt", "bad")] } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("仅支持 .md 文件");
    expect(within(dialog).getByRole("button", { name: "创建并链接" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("button", { name: "移除 bad.txt" }));
    fireEvent.change(within(dialog).getByTestId("file-drop-zone-input"), { target: { files: [markdownFile("one.md", "one"), markdownFile("two.md", "two"), markdownFile("three.md", "three")] } });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "创建并链接" })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole("button", { name: "创建并链接" }));
    expect(within(dialog).getByText("正在创建…")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Markdown 文件" })).toBeDisabled();
    finishFirst(entry("one", "draft"));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("没有权限执行该操作"));
    expect(changed).toHaveBeenLastCalledWith({ schemaVersion: "skill/v1", knowledgeEntryIds: ["one", "three"] });
    expect(within(dialog).getByRole("list", { name: "待上传文件" })).toHaveTextContent("two.md");
    expect(within(dialog).getAllByText("已创建并链接")).toHaveLength(2);
    expect(within(dialog).getByText(/已创建的条目保留在当前未保存草稿中/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "创建并链接" }));
    await waitFor(() => expect(repository.createMarkdown).toHaveBeenCalledTimes(4));
    expect(changed).toHaveBeenLastCalledWith({ schemaVersion: "skill/v1", knowledgeEntryIds: ["one", "three", "two"] });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("rejects decoded Markdown beyond the normal knowledge body limit before creating an entry", async () => {
    const { repository } = setup();
    await userEvent.click(screen.getByRole("button", { name: "上传 Markdown" }));
    const dialog = screen.getByRole("dialog", { name: "上传 Markdown" });
    fireEvent.change(within(dialog).getByTestId("file-drop-zone-input"), { target: { files: [markdownFile("long.md", "中".repeat(200_001))] } });
    expect(await within(dialog).findByText("正文超过知识库 200,000 字符上限。")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "创建并链接" })).toBeDisabled();
    expect(repository.createMarkdown).not.toHaveBeenCalled();
  });

  it("includes knowledge link changes in the publication review", () => {
    render(<SkillSpecDiff before={{ schemaVersion: "skill/v1" }} after={{ schemaVersion: "skill/v1", knowledgeEntryIds: ["linked"] }} />);
    expect(screen.getByText("知识 1 项")).toBeVisible();
    expect(screen.getByLabelText("知识差异")).toHaveTextContent("linked");
  });
});
