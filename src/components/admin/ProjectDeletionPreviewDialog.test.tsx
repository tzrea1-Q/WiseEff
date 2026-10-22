import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectDeletionPreviewDialog } from "./ProjectDeletionPreviewDialog";
import type { ProjectDeletionPreview, ProjectDeletionStatus } from "@/domain/parameters/projectDeletionPreview";

const preview: ProjectDeletionPreview = { organizationId: "org", projectId: "old-project", projectName: "Old project",
  generatedAt: "2026-10-20T00:00:00Z", stateDigest: "a".repeat(64), executionAvailable: true,
  inventory: [{ key: "values", label: "项目值与历史", count: 12, disposition: "delete" },
    { key: "source-files", label: "项目源文件", count: 2, disposition: "delete" },
    { key: "canonical-bindings", label: "项目参数", count: 3, disposition: "delete" },
    { key: "config-revisions", label: "配置解析修订", count: 4, disposition: "delete" },
    { key: "source-versions", label: "源文件历史版本", count: 5, disposition: "delete" },
    { key: "deployment-evidence", label: "设备部署运行与证据", count: 1, disposition: "delete" }],
  storage: { exclusiveObjects: 1, sharedObjects: 2, totalBytes: 2048 }, blockers: [], notes: [] };
const pending: ProjectDeletionStatus = { projectId: preview.projectId, stateDigest: preview.stateDigest,
  database: "deleted", objects: "pending", pendingObjects: 1 };

describe("project deletion confirmation", () => {
  it("confirms with the destructive button and retries object cleanup using the same confirmation", async () => {
    const user = userEvent.setup();
    const purgeProject = vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce({ ...pending, objects: "complete", pendingObjects: 0 });
    render(<ProjectDeletionPreviewDialog projectId={preview.projectId} loadPreview={async () => preview}
      purgeProject={purgeProject} onClose={() => {}} />);
    const button = await screen.findByRole("button", { name: "彻底删除" });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/永久删除项目配置、参数、历史修订、部署记录及离线迁移归档/)).toBeVisible();
    expect(screen.getByText("已记录存储大小：2.0 KB。")).toBeVisible();
    expect(screen.getByText("配置文件 2 个，参数 3 项，历史修订 9 项，部署记录 1 项。")).toBeVisible();
    expect(screen.getByText("项目值与历史")).not.toBeVisible();
    await user.click(screen.getByText("明细"));
    expect(screen.getByText("项目值与历史")).toBeVisible();
    expect(button).toBeEnabled();
    button.focus(); await user.keyboard("{Enter}");
    const result = await screen.findByRole("status");
    expect(result).toHaveTextContent("数据库清理：已完成");
    expect(result).toHaveTextContent("尚有 1 个对象未完成");
    expect(result).not.toHaveTextContent("项目彻底删除已完成");
    await user.click(screen.getByRole("button", { name: "重试对象清理" }));
    expect(await screen.findByText(/项目彻底删除已完成/)).toBeInTheDocument();
    expect(purgeProject).toHaveBeenNthCalledWith(2, preview.projectId, preview.stateDigest);
  });

  it("preserves the confirmed preview after a request failure and offers refresh or retry", async () => {
    const user = userEvent.setup();
    render(<ProjectDeletionPreviewDialog projectId={preview.projectId} loadPreview={async () => preview}
      purgeProject={async () => { throw new Error("Network unavailable"); }} onClose={() => {}} />);
    await user.click(await screen.findByRole("button", { name: "彻底删除" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "彻底删除" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "重试预览" }));
    expect(await screen.findByText("当前没有删除阻塞。")).toBeVisible();
  });

  it("keeps deletion disabled while work is in progress", async () => {
    render(<ProjectDeletionPreviewDialog projectId={preview.projectId} loadPreview={async () => ({ ...preview,
      executionAvailable: false, blockers: [{ code: "pending-review", count: 1, message: "有待处理的审核。", action: "请先处理。" }] })}
      purgeProject={vi.fn()} onClose={() => {}} />);
    expect(await screen.findByText("请先处理。")).toBeVisible();
    expect(screen.getByRole("button", { name: "彻底删除" })).toBeDisabled();
  });

  it("loads a persisted cleanup receipt without attempting to read the deleted project", async () => {
    const loadPreview = vi.fn();
    render(<ProjectDeletionPreviewDialog projectId={preview.projectId} initialStatus={pending}
      loadPreview={loadPreview} purgeProject={async () => pending} onClose={() => {}} />);
    expect(within(screen.getByRole("status")).getByText(/尚有 1 个对象/)).toBeInTheDocument();
    expect(loadPreview).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "重试对象清理" })).toBeEnabled();
  });
});
