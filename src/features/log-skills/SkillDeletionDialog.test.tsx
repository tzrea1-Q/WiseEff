import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SkillDeletionDialog } from "./SkillDeletionDialog";
import type { SkillDeletionPreview, SkillDeletionStatus } from "./types";
const preview: SkillDeletionPreview = { skillId: "experiment", name: "实验技能", skillKey: "experiment", status: "active", version: "a".repeat(64),
  generatedAt: "2026-10-20T12:00:00Z", canDelete: true, inventory: [{ key: "draft", label: "初始草稿", count: 1, disposition: "delete" }],
  objects: { total: 2, shared: 1, exclusive: 1 }, blockers: [], notes: ["共享知识保留"] };
const pending: SkillDeletionStatus = { skillId: preview.skillId, name: preview.name, skillKey: preview.skillKey, version: preview.version,
  database: "deleted", objects: "pending", pendingObjects: 1, retainedObjects: 1 };
describe("SkillDeletionDialog", () => {
  it("keeps confirmation after failure and retries honest pending object cleanup", async () => {
    const purgeSkill = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(pending).mockResolvedValueOnce({ ...pending, objects: "complete", pendingObjects: 0 });
    render(<SkillDeletionDialog skillId={preview.skillId} repository={{ previewSkillDeletion: async () => preview, purgeSkill }} onDismiss={vi.fn()} onDeleted={vi.fn()} onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "永久删除实验技能" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请重试");
    fireEvent.click(screen.getByRole("button", { name: "永久删除实验技能" }));
    expect(await screen.findByText(/数据库已删除；仍有 1 个对象待清理/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重试对象清理" }));
    expect(await screen.findByText("数据库及独占对象已清理完成。共享对象保留。" )).toBeVisible();
    expect(purgeSkill).toHaveBeenNthCalledWith(3, preview.skillId, preview.version);
  });
  it("shows concrete blockers and an archive entry without a delete action", async () => {
    const onArchive = vi.fn().mockResolvedValue(undefined);
    render(<SkillDeletionDialog skillId={preview.skillId} repository={{ previewSkillDeletion: async () => ({ ...preview, canDelete: false,
      blockers: [{ code: "published", count: 1, message: "曾发布的技能修订：1 项；请归档。" }] }) }} onArchive={onArchive} onDismiss={vi.fn()} onDeleted={vi.fn()} onNavigate={vi.fn()} />);
    expect(await screen.findByText("曾发布的技能修订：1 项；请归档。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "永久删除实验技能" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "归档技能" }));
    await waitFor(() => expect(onArchive).toHaveBeenCalledOnce());
  });
});
