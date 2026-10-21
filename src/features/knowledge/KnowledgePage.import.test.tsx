import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { createMockKnowledgeRepository } from "@/infrastructure/mock/mockKnowledgeRepository";
import type { KnowledgeImportOutcome } from "@/domain/knowledge/types";
import { KnowledgePage } from "./KnowledgePage";

const capability = { userId: "u-xu-yun", canView: true, canEdit: true, canManage: false };

async function chooseFiles(files: File[], repository = createMockKnowledgeRepository()) {
  const view = render(<KnowledgePage repository={repository} capability={capability} />);
  const user = userEvent.setup({ applyAccept: false });
  await user.click(screen.getByRole("button", { name: "批量导入" }));
  const dialog = screen.getByRole("dialog", { name: "批量导入" });
  await user.upload(within(dialog).getByTestId("file-drop-zone-input"), files);
  return { ...view, user, dialog, repository };
}

describe("knowledge batch import on the knowledge page", () => {
  it("chooses one ZIP and renders its member paths, outcomes and draft links", async () => {
    const zip = new JSZip();
    zip.file("guides/start.md", "# ZIP from page");
    zip.file("image.png", "unsupported");
    zip.file("__MACOSX/._start.md", "junk");
    const { user, dialog, repository } = await chooseFiles([
      new File(["before ZIP"], "before.md"),
      new File([await zip.generateAsync({ type: "uint8array" }) as BlobPart], "guides.ZIP", { type: "application/zip" }),
      new File(["after ZIP"], "after.md")
    ]);
    expect(within(dialog).getByTestId("file-drop-zone-input")).toHaveAttribute("accept", expect.stringContaining(".zip"));
    await user.click(within(dialog).getByRole("button", { name: "开始导入" }));
    const report = await within(dialog).findByRole("table", { name: "导入报告" });
    expect(within(report).getByText("guides/start.md")).toBeInTheDocument();
    expect(within(report).getByText("格式不支持，已跳过")).toBeInTheDocument();
    expect(within(report).queryByText(/__MACOSX/)).not.toBeInTheDocument();
    expect(within(report).getAllByRole("link", { name: "查看草稿" })).toHaveLength(3);
    expect((await repository.list()).items.find((entry) => entry.title === "start.md"))
      .toMatchObject({ tags: ["guides"], status: "draft", contentMarkdown: "# ZIP from page" });
  });

  it("reports a refused archive and continues with the next file", async () => {
    const { user, dialog } = await chooseFiles([new File(["invalid"], "broken.zip"), new File(["after refusal"], "next.md")]);
    await user.click(within(dialog).getByRole("button", { name: "开始导入" }));
    const report = await within(dialog).findByRole("table", { name: "导入报告" });
    expect(within(report).getByText("broken.zip")).toBeInTheDocument();
    expect(within(report).getByText("导入失败")).toBeInTheDocument();
    expect(within(report).getByText("next.md")).toBeInTheDocument();
    expect(within(report).getByText("已创建草稿")).toBeInTheDocument();
  });

  it("refuses selecting multiple ZIP archives before opening a batch", async () => {
    const { user, dialog } = await chooseFiles([new File(["one"], "one.zip"), new File(["two"], "two.ZIP")]);
    await user.click(within(dialog).getByRole("button", { name: "开始导入" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("每批最多选择一个 ZIP 压缩包。");
    expect(within(dialog).getByRole("button", { name: "开始导入" })).toBeEnabled();
    expect(within(dialog).queryByRole("table", { name: "导入报告" })).not.toBeInTheDocument();
  });

  it("imports multiple files with batch tags and reports every outcome with draft links", async () => {
    const { user, dialog, repository } = await chooseFiles([
      new File(["# First"], "first.md", { type: "text/markdown" }),
      new File(["# First"], "copy.txt", { type: "text/plain" }),
      new File(["binary"], "later.bin", { type: "application/octet-stream" })
    ]);
    await user.type(within(dialog).getByLabelText("批次标签（逗号分隔）"), "batch, shared");
    await user.click(within(dialog).getByRole("button", { name: "开始导入" }));
    const report = await within(dialog).findByRole("table", { name: "导入报告" });
    expect(within(report).getByText("已创建草稿")).toBeInTheDocument();
    expect(within(report).getByText("重复，已跳过")).toBeInTheDocument();
    expect(within(report).getByText("格式不支持，已跳过")).toBeInTheDocument();
    const links = within(report).getAllByRole("link", { name: "查看草稿" });
    expect(links[0]).toHaveAttribute("href", expect.stringContaining("/knowledge?entryId="));
    const entry = (await repository.list()).items.find((item) => item.title === "first.md");
    expect(entry).toMatchObject({ tags: ["batch", "shared"], origin: "uploaded", status: "draft" });
    await user.click(within(dialog).getByRole("button", { name: "继续导入" }));
    expect(within(dialog).getByRole("button", { name: "开始导入" })).toBeDisabled();
    expect(within(dialog).getByLabelText("批次标签（逗号分隔）")).toHaveValue("");
    await user.click(within(dialog).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog", { name: "批量导入" })).not.toBeInTheDocument();
  });

  it("shows per-document progress, continues after a request failure and completes after leaving the page", async () => {
    const repository = createMockKnowledgeRepository();
    let resolve!: (outcome: KnowledgeImportOutcome) => void;
    const importDocument = vi.spyOn(repository, "importDocument")
      .mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }))
      .mockRejectedValueOnce(new Error("Request failed."));
    const complete = vi.spyOn(repository, "completeImport");
    const { user, dialog, unmount } = await chooseFiles([
      new File(["one"], "one.md"), new File(["two"], "two.md"), new File(["three"], "three.md")
    ], repository);
    await user.click(within(dialog).getByRole("button", { name: "开始导入" }));
    expect(await within(dialog).findByText("正在导入：one.md")).toBeInTheDocument();
    unmount();
    await act(async () => resolve({ id: "one", relativePath: "one.md", status: "created", entryId: "one", error: null }));
    await waitFor(() => expect(importDocument).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
  });

  it("reports extraction failure with a draft link and request refusal without dropping the next file", async () => {
    const repository = createMockKnowledgeRepository();
    vi.spyOn(repository, "importDocument")
      .mockResolvedValueOnce({ id: "failed", relativePath: "empty.pdf", status: "extraction_failed", entryId: "draft-id", error: "无可提取文本" })
      .mockRejectedValueOnce(new Error("文件超过 20 MB 上限。"));
    const { user, dialog } = await chooseFiles([new File(["pdf"], "empty.pdf"), new File(["bad"], "bad.md"), new File(["ok"], "ok.md")], repository);
    await user.click(within(dialog).getByRole("button", { name: "开始导入" }));
    const report = await within(dialog).findByRole("table", { name: "导入报告" });
    expect(within(report).getByText("提取失败，草稿已保留")).toBeInTheDocument();
    expect(within(report).getByText("无可提取文本")).toBeInTheDocument();
    expect(within(report).getByText("文件超过 20 MB 上限。")).toBeInTheDocument();
    expect(within(report).getByText("已创建草稿")).toBeInTheDocument();
  });

  it("keeps the selection when opening a batch fails and permits retry", async () => {
    const repository = createMockKnowledgeRepository();
    vi.spyOn(repository, "openImport").mockRejectedValueOnce(new Error("Request failed."));
    const { user, dialog } = await chooseFiles([new File(["retry"], "retry.md")], repository);
    await user.click(within(dialog).getByRole("button", { name: "开始导入" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("无法开始导入，请重试。");
    expect(within(dialog).getByText(/retry.md/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "开始导入" }));
    expect(await within(dialog).findByRole("table", { name: "导入报告" })).toBeInTheDocument();
  });

  it("hides batch import without knowledge:edit", async () => {
    render(<KnowledgePage repository={createMockKnowledgeRepository()} capability={{ ...capability, canEdit: false }} />);
    await screen.findByRole("table", { name: "知识条目列表" });
    expect(screen.queryByRole("button", { name: "批量导入" })).not.toBeInTheDocument();
  });

  it("retries a failed summary without uploading the documents again", async () => {
    const repository = createMockKnowledgeRepository();
    const complete = vi.spyOn(repository, "completeImport").mockRejectedValueOnce(new Error("Request failed."));
    const submit = vi.spyOn(repository, "importDocument");
    const { user, dialog } = await chooseFiles([new File(["summary retry"], "summary.md")], repository);
    await user.click(within(dialog).getByRole("button", { name: "开始导入" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("文档结果已保留，批次汇总失败，请重试汇总。");
    expect(within(dialog).getByRole("table", { name: "导入报告" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "重试汇总" }));
    await waitFor(() => expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument());
    expect(complete).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
