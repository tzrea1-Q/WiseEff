import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SkillDeletionDialog } from "./SkillDeletionDialog";
import type { SkillDeletionPreview, SkillDeletionStatus } from "./types";
const preview: SkillDeletionPreview = { skillId: "experiment", name: "实验技能", skillKey: "experiment", status: "archived", version: "a".repeat(64),
  generatedAt: "2026-10-20T12:00:00Z", canDelete: true, inventory: [{ key: "draft", label: "初始草稿", count: 1, disposition: "delete" }],
  objects: { total: 2, shared: 1, exclusive: 1 }, blockers: [], notes: ["共享知识保留"] };
const pending: SkillDeletionStatus = { skillId: preview.skillId, name: preview.name, skillKey: preview.skillKey, version: preview.version,
  database: "deleted", objects: "pending", pendingObjects: 1, retainedObjects: 1 };
describe("SkillDeletionDialog", () => {
  it("summarizes deleted data and retained history without an acknowledgement checkbox", async () => {
    render(<SkillDeletionDialog skillId={preview.skillId} repository={{ previewSkillDeletion: async () => ({ ...preview,
      inventory: [{ key: "revisions", label: "版本、草稿及解析测试", count: 3, disposition: "delete" },
        { key: "runs", label: "分析报告（技能名称与版本快照）", count: 8, disposition: "retain" },
        { key: "shared-snapshots", label: "其他技能引用的源码快照及索引", count: 1, disposition: "retain" }] }) }}
      onDismiss={vi.fn()} onDeleted={vi.fn()} onNavigate={vi.fn()} />);
    expect(await screen.findByText("版本、草稿及解析测试：3")).toBeVisible();
    expect(screen.getByText("分析报告（技能名称与版本快照）：8")).toBeVisible();
    expect(screen.getByText("其他技能引用的源码快照及索引：1")).toBeVisible();
    expect(screen.getAllByRole("list")).toHaveLength(2);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "彻底删除" })).toBeEnabled();
  });
  it("keeps confirmation after failure and retries honest pending object cleanup", async () => {
    const purgeSkill = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(pending).mockResolvedValueOnce({ ...pending, objects: "complete", pendingObjects: 0 });
    render(<SkillDeletionDialog skillId={preview.skillId} repository={{ previewSkillDeletion: async () => preview, purgeSkill }} onDismiss={vi.fn()} onDeleted={vi.fn()} onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "彻底删除" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请重试");
    fireEvent.click(screen.getByRole("button", { name: "彻底删除" }));
    expect(await screen.findByText(/数据库已删除；仍有 1 个对象待清理/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重试对象清理" }));
    expect(await screen.findByText("数据库及独占对象已清理完成。共享对象保留。" )).toBeVisible();
    expect(purgeSkill).toHaveBeenNthCalledWith(3, preview.skillId, preview.version);
  });
  it("shows concrete blockers and an archive entry without a delete action", async () => {
    const onArchive = vi.fn().mockResolvedValue(undefined);
    render(<SkillDeletionDialog skillId={preview.skillId} repository={{ previewSkillDeletion: async () => ({ ...preview, status: "active", canDelete: false,
      blockers: [{ code: "active", count: 1, message: "请先归档技能，再彻底删除。" }] }) }} onArchive={onArchive} onDismiss={vi.fn()} onDeleted={vi.fn()} onNavigate={vi.fn()} />);
    expect(await screen.findByText("请先归档技能，再彻底删除。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "彻底删除" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "归档技能" }));
    await waitFor(() => expect(onArchive).toHaveBeenCalledOnce());
  });
});
