import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceSnapshots } from "./SourceSnapshots";
import { mockSkillWorkspace } from "@/infrastructure/mock/logSkills";
import type { SourceSnapshot } from "./types";
import { formatAbsolute } from "@/domain/format/formatDateTime";

const snapshot: SourceSnapshot = {
  id: "snapshot-1", skillId: "skill-charging", versionLabel: "v1.0", status: "ready", fileCount: 3,
  filesProcessed: 5, filesTotal: 5, skippedCount: 2, skippedFiles: [{ path: "vendor/dep.c", reason: "第三方或忽略目录" }],
  error: null, createdAt: "2026-10-19T00:00:00.000Z"
};
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function setup(options: { items?: SourceSnapshot[]; canEdit?: boolean; apiMode?: boolean; dirty?: boolean; loading?: boolean; failure?: boolean } = {}) {
  const skill = structuredClone(mockSkillWorkspace("skill-charging")!);
  skill.draft = { ...skill.currentRevision, id: "draft", status: "draft", spec: { ...skill.currentRevision.spec, defaultSourceSnapshotId: snapshot.id } };
  const repository = {
    listSourceSnapshots: vi.fn(async () => options.items ?? [snapshot]),
    uploadSourceSnapshot: vi.fn(async () => snapshot),
    setDefaultSourceSnapshot: vi.fn(async () => skill),
    archiveSourceSnapshot: vi.fn(async () => ({ ...snapshot, status: "archived" as const })),
    retrySourceSnapshot: vi.fn(async () => ({ ...snapshot, status: "queued" as const, error: null })),
    locateSourceStatement: vi.fn(async () => ({ items: [{ snapshotId: snapshot.id, path: "drivers/thermal.c", line: 9,
      versionLabel: snapshot.versionLabel, startLine: 8, excerpt: 'if (hot) {\n  pr_warn("thermal foldback: temp=%d\\n", temp);\n} // <img src=x onerror=alert(1)>', confidence: 0.95 }], truncated: true }))
  };
  if (options.loading) repository.listSourceSnapshots.mockReturnValue(new Promise(() => {}));
  if (options.failure) repository.listSourceSnapshots.mockRejectedValueOnce(new Error("secret backend details"));
  const onSkillUpdated = vi.fn();
  const onBusyChange = vi.fn();
  render(<SourceSnapshots skill={skill} repository={repository} apiMode={options.apiMode ?? true} canEdit={options.canEdit ?? true}
    disabled={false} dirty={options.dirty ?? false} onSkillUpdated={onSkillUpdated} onBusyChange={onBusyChange} />);
  return { skill, repository, onSkillUpdated, onBusyChange };
}

describe("source snapshots section", () => {
  it("retries a failed snapshot without discarding the current line and preserves failure for another attempt", async () => {
    const failed = { ...snapshot, status: "failed" as const, error: "读取源码原始文件失败，请检查对象存储后重试。" };
    const { repository, onBusyChange, onSkillUpdated } = setup({ items: [failed, { ...snapshot, id: "ready", versionLabel: "ready" }] });
    const line = await screen.findByRole("textbox", { name: "日志行" });
    fireEvent.change(line, { target: { value: "thermal foldback: temp=71" } });
    repository.retrySourceSnapshot.mockRejectedValueOnce(new Error("private storage details"));
    await userEvent.click(screen.getByRole("button", { name: "重试索引" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("重新排队失败，请重试");
    expect(line).toHaveValue("thermal foldback: temp=71");
    expect(screen.queryByText("private storage details")).not.toBeInTheDocument();
    repository.listSourceSnapshots.mockResolvedValueOnce([{ ...failed, status: "queued", error: null }]);
    await userEvent.click(screen.getByRole("button", { name: "重试索引" }));
    expect(await screen.findByText("等待索引")).toBeVisible();
    expect(repository.retrySourceSnapshot).toHaveBeenLastCalledWith("skill-charging", snapshot.id);
    expect(onBusyChange).toHaveBeenCalledWith(true); expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect(onSkillUpdated).not.toHaveBeenCalled();
  });
  it("shows status, default marker, bounded skipped paths and archived rows", async () => {
    setup({ items: [snapshot, { ...snapshot, id: "archived", versionLabel: "old", status: "archived" }, { ...snapshot, id: "bad", versionLabel: "broken", status: "failed", error: "backend stack trace" }] });
    const table = await screen.findByRole("table", { name: "源码快照" });
    expect(within(table).getAllByText(formatAbsolute(snapshot.createdAt).slice(0, 16).replaceAll("-", "/"))).toHaveLength(3);
    expect(within(table).getByText("草稿默认")).toBeVisible();
    expect(within(table).getByText("就绪")).toBeVisible();
    expect(within(table).getByText("已归档")).toBeVisible();
    expect(within(table).queryByText("backend stack trace")).not.toBeInTheDocument();
    expect(within(table).getByText("索引失败，请检查压缩包格式及索引限制。")).toBeVisible();
    const row = within(table).getByText("v1.0").closest("tr")!;
    expect(within(row).queryByText("vendor/dep.c")).not.toBeInTheDocument();
    expect(within(row).getByText("2 个 · 已列出：第三方 1")).toBeVisible();
    await userEvent.click(within(row).getByRole("button", { name: "查看" }));
    const dialog = screen.getByRole("dialog", { name: "跳过的源码文件" });
    const skipped = within(dialog).getByRole("table", { name: "跳过的源码文件" });
    expect(within(skipped).getByRole("columnheader", { name: "路径" })).toBeVisible();
    expect(within(skipped).getByText("vendor/dep.c")).toBeVisible();
    expect(within(skipped).getByText("第三方或忽略目录")).toBeVisible();
    expect(within(dialog).getByText("仅显示前 1 项，共 2 项。")).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const archivedRow = within(within(table).getByText("old").closest("tr")!);
    expect(archivedRow.queryByRole("button", { name: "设为默认" })).not.toBeInTheDocument();
    expect(archivedRow.queryByRole("button", { name: /快照操作/ })).not.toBeInTheDocument();
    expect(archivedRow.getByRole("button", { name: "查看" })).toBeEnabled();
  });

  it("summarizes reasons without expanding rows and protects compact headers and normal version labels", async () => {
    setup({ items: [{ ...snapshot, versionLabel: "v2.4.0-rc1", skippedFiles: [
      { path: "vendor/dep.c", reason: "第三方或忽略目录" }, { path: "src/image.c", reason: "二进制或非 UTF-8 文件" }
    ] }, { ...snapshot, id: "long", versionLabel: "release-".repeat(25), skippedCount: 0, skippedFiles: [] }] });
    const table = await screen.findByRole("table", { name: "源码快照" });
    expect(within(table).getByText("2 个 · 第三方 1 · 二进制 1")).toBeVisible();
    expect(table.querySelector("details")).toBeNull();
    expect(table).toHaveClass("[&_th]:whitespace-nowrap");
    for (const name of ["文件数", "索引状态", "上传时间", "默认"]) expect(within(table).getByRole("columnheader", { name })).toHaveClass("whitespace-nowrap");
    expect(within(table).getByText("v2.4.0-rc1")).toHaveClass("whitespace-nowrap");
    expect(within(table).getByText("v2.4.0-rc1")).not.toHaveClass("break-all");
    expect(within(table).getByText("release-".repeat(25))).toHaveClass("break-all");
  });

  it("shows loading, empty, and retryable loading failure states", async () => {
    const { repository } = setup({ failure: true, items: [] });
    expect(screen.getByRole("status", { name: "正在加载源码快照" })).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent("无法加载源码快照");
    expect(screen.queryByText("secret backend details")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("尚无源码快照")).toBeVisible();
    expect(repository.listSourceSnapshots).toHaveBeenCalledTimes(2);
  });

  it("polls active snapshots and stops after ready", async () => {
    vi.useFakeTimers();
    const { repository } = setup({ items: [{ ...snapshot, status: "indexing", filesProcessed: 2, filesTotal: 5 }] });
    await act(async () => {});
    expect(screen.getByLabelText("索引进度")).toHaveTextContent("2 / 5");
    repository.listSourceSnapshots.mockResolvedValueOnce([snapshot]);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText("就绪")).toBeVisible();
    expect(screen.queryByLabelText("索引进度")).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(repository.listSourceSnapshots).toHaveBeenCalledTimes(2);
  });

  it.each([{ canEdit: false }, { apiMode: false }])("hides all source actions for viewers and mock: %j", async (options) => {
    setup({ ...options, items: [{ ...snapshot, status: "failed" }] });
    await screen.findByRole("table", { name: "源码快照" });
    expect(screen.queryByRole("button", { name: "上传快照" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "设为默认" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试索引" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /快照操作/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "日志语句试一试" })).not.toBeInTheDocument();
  });

  it("validates required fields and archive extension, then uploads the original file and trimmed label", async () => {
    const { repository, onBusyChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: "上传快照" }));
    const dialog = screen.getByRole("dialog", { name: "上传源码快照" });
    const label = within(dialog).getByRole("textbox", { name: "版本标签" });
    expect(label).toHaveFocus();
    await userEvent.click(within(dialog).getByRole("button", { name: "上传" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("请输入版本标签");
    fireEvent.change(label, { target: { value: " release-v1 " } });
    await userEvent.click(within(dialog).getByRole("button", { name: "上传" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("请选择源码压缩包");
    const picker = within(dialog).getByTestId("file-drop-zone-input");
    fireEvent.change(picker, { target: { files: [new File(["bad"], "source.exe")] } });
    await userEvent.click(within(dialog).getByRole("button", { name: "上传" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("请选择 .tar.gz、.tgz 或 .zip");
    const file = new File(["archive"], "source.tgz");
    fireEvent.change(picker, { target: { files: [file] } });
    await userEvent.click(within(dialog).getByRole("button", { name: "上传" }));
    await waitFor(() => expect(repository.uploadSourceSnapshot).toHaveBeenCalledWith("skill-charging", { versionLabel: "release-v1", file }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  });

  it("retains the upload dialog and retry input after a server rejection", async () => {
    const { repository } = setup();
    repository.uploadSourceSnapshot.mockRejectedValueOnce(new Error("internal storage path"));
    await userEvent.click(screen.getByRole("button", { name: "上传快照" }));
    fireEvent.change(screen.getByLabelText("版本标签"), { target: { value: "v2" } });
    fireEvent.change(screen.getByTestId("file-drop-zone-input"), { target: { files: [new File(["data"], "source.zip")] } });
    await userEvent.click(screen.getByRole("button", { name: "上传" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("上传失败");
    expect(screen.getByLabelText("版本标签")).toHaveValue("v2");
    expect(screen.getByRole("button", { name: "上传" })).toBeEnabled();
    expect(screen.queryByText("internal storage path")).not.toBeInTheDocument();
  });

  it("disables default while dirty, allowing archive only after confirmation", async () => {
    const { repository } = setup({ dirty: true, items: [{ ...snapshot, id: "candidate" }] });
    expect(await screen.findByRole("button", { name: "设为默认" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "v1.0 快照操作：更多" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "归档" }));
    expect(repository.archiveSourceSnapshot).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("dialog", { name: "归档源码快照？" })).getByRole("button", { name: "归档" }));
    await waitFor(() => expect(repository.archiveSourceSnapshot).toHaveBeenCalledWith("skill-charging", "candidate"));
  });

  it("writes the selected default through the draft mutation", async () => {
    const { repository, onSkillUpdated, skill } = setup({ items: [{ ...snapshot, id: "candidate", status: "queued" }] });
    await userEvent.click(await screen.findByRole("button", { name: "设为默认" }));
    await waitFor(() => expect(repository.setDefaultSourceSnapshot).toHaveBeenCalledWith("skill-charging", "candidate"));
    expect(onSkillUpdated).toHaveBeenCalledWith(skill);
  });

  it("locates a pasted line in the chosen ready snapshot and shows capped results", async () => {
    const { repository } = setup({ items: [{ ...snapshot, id: "queued", status: "queued" }, snapshot] });
    await screen.findByRole("combobox", { name: "选择就绪快照" });
    expect(screen.getByRole("button", { name: "定位语句" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "日志行" }), { target: { value: " thermal foldback: temp=71 " } });
    await userEvent.click(screen.getByRole("button", { name: "定位语句" }));
    expect(repository.locateSourceStatement).toHaveBeenCalledWith("skill-charging", snapshot.id, "thermal foldback: temp=71");
    expect(await screen.findByText("drivers/thermal.c:9")).toBeVisible();
    expect(screen.getByText("v1.0 · 匹配置信度 95%")).toBeVisible();
    const sourceExcerpt = screen.getByLabelText("drivers/thermal.c 源码摘录");
    const matchedLine = screen.getByLabelText("匹配源码行 9");
    expect(matchedLine).toHaveTextContent('> 9: pr_warn("thermal foldback: temp=%d\\n", temp);');
    expect(matchedLine).toHaveClass("bg-[var(--accent-soft)]", "font-semibold");
    expect(sourceExcerpt.querySelectorAll(".font-semibold")).toHaveLength(1);
    expect(sourceExcerpt).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(sourceExcerpt.querySelector("img")).toBeNull();
    expect(screen.getByText("结果已达上限，仅显示部分匹配。")).toBeVisible();
  });

  it("shows no-ready, no-match, loading and safe retry states", async () => {
    const { repository } = setup();
    await screen.findByRole("combobox", { name: "选择就绪快照" });
    repository.locateSourceStatement.mockRejectedValueOnce(new Error("private storage path"));
    fireEvent.change(screen.getByRole("textbox", { name: "日志行" }), { target: { value: "missing statement" } });
    await userEvent.click(screen.getByRole("button", { name: "定位语句" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("定位失败");
    expect(screen.queryByText("private storage path")).not.toBeInTheDocument();
    repository.locateSourceStatement.mockResolvedValueOnce({ items: [], truncated: false });
    await userEvent.click(screen.getByRole("button", { name: "定位语句" }));
    expect(await screen.findByText("未找到匹配语句")).toBeVisible();
  });

  it("offers no matcher until a ready snapshot exists", async () => {
    setup({ items: [{ ...snapshot, status: "failed" }] });
    expect(await screen.findByText("暂无就绪快照")).toBeVisible();
    expect(screen.queryByRole("button", { name: "定位语句" })).not.toBeInTheDocument();
  });
});
