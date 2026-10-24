import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockKnowledgeFixtures } from "@/infrastructure/mock/mockKnowledgeRepository";
import type { KnowledgeRevision } from "@/domain/knowledge/types";
import { KnowledgeRevisionsDialog } from "./KnowledgeRevisionsDialog";

describe("KnowledgeRevisionsDialog", () => {
  it("shows the entire Markdown revision before offering restore", async () => {
    const entry = createMockKnowledgeFixtures().entries[0];
    const content = `${"完整正文\n".repeat(100)}末尾内容`;
    const revision: KnowledgeRevision = { id: "old", entryId: entry.id, revisionNumber: 1,
      title: "原始标题", tags: ["原始标签"], contentMarkdown: content, fileId: null,
      authorUserId: null, restoredFromRevisionId: null, createdAt: entry.createdAt,
      historicalAttribution: { organization: { id: "original-org", name: "原组织", source: "legacy-current" },
        actors: { author_user_id: { id: "original-author", name: "迁移时作者", source: "legacy-current" } } } };
    const onRestore = vi.fn().mockResolvedValue(undefined);
    render(<KnowledgeRevisionsDialog open entry={entry} loadRevisions={async () => [revision]}
      onViewFile={vi.fn()} onRestore={onRestore} canRestore onClose={vi.fn()} />);
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "查看修订 #1" });
    expect(screen.getByText(/迁移时作者（迁移时名称）/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复此版本" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看修订 #1" }));
    expect(screen.getByLabelText("修订 #1 完整内容").querySelector("pre")?.textContent).toBe(content);
    expect(screen.getByLabelText("修订 #1 完整内容")).toHaveTextContent("原始标题");
    await user.click(screen.getByRole("button", { name: "恢复此版本" }));
    const confirm = screen.getByRole("dialog", { name: "恢复修订 #1" });
    await user.click(within(confirm).getByRole("button", { name: "恢复为新修订" }));
    expect(onRestore).toHaveBeenCalledWith(revision, entry.headRevisionNumber);
  });

  it("keeps file restore disabled until the original revision file opens successfully", async () => {
    const entry = createMockKnowledgeFixtures().entries[0];
    const revision: KnowledgeRevision = { id: "old-file", entryId: entry.id, revisionNumber: 1,
      title: "旧文件", tags: [], contentMarkdown: null, fileId: "original-file",
      authorUserId: null, restoredFromRevisionId: null, createdAt: entry.createdAt };
    const onViewFile = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(undefined);
    const onRestore = vi.fn();
    render(<KnowledgeRevisionsDialog open entry={entry} loadRevisions={async () => [revision]}
      onViewFile={onViewFile} onRestore={onRestore} canRestore onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "查看修订 #1" }));
    expect(screen.getByRole("button", { name: "恢复此版本" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "打开完整文件" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复此版本" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "打开完整文件" }));
    expect(onViewFile).toHaveBeenLastCalledWith(revision);
    expect(screen.getByRole("button", { name: "恢复此版本" })).toBeEnabled();
    expect(onRestore).not.toHaveBeenCalled();
  });
});
