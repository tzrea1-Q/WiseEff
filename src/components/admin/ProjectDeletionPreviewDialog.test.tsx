import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectDeletionPreviewDialog } from "./ProjectDeletionPreviewDialog";
import type { ProjectDeletionPreview, ProjectDeletionStatus } from "@/domain/parameters/projectDeletionPreview";

const preview: ProjectDeletionPreview = { organizationId: "org", projectId: "old-project", projectName: "Old project",
  generatedAt: "2026-10-20T00:00:00Z", stateDigest: "a".repeat(64), executionAvailable: true,
  inventory: [{ key: "values", label: "项目值与历史", count: 12, disposition: "delete" }],
  storage: { exclusiveObjects: 1, sharedObjects: 2, totalBytes: 50 }, blockers: [], notes: [] };
const pending: ProjectDeletionStatus = { projectId: preview.projectId, stateDigest: preview.stateDigest,
  database: "deleted", objects: "pending", pendingObjects: 1 };

describe("project deletion confirmation", () => {
  it("requires acknowledgement, keeps the partial state visible and retries object cleanup using the same confirmation", async () => {
    const user = userEvent.setup();
    const purgeProject = vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce({ ...pending, objects: "complete", pendingObjects: 0 });
    render(<ProjectDeletionPreviewDialog projectId={preview.projectId} loadPreview={async () => preview}
      purgeProject={purgeProject} onClose={() => {}} />);
    const button = await screen.findByRole("button", { name: "确认彻底删除" });
    expect(button).toBeDisabled();
    const acknowledgement = await screen.findByRole("checkbox", { name: /我确认永久删除/ });
    acknowledgement.focus(); await user.keyboard(" ");
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
    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "确认彻底删除" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("button", { name: "确认彻底删除" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "重试预览" }));
    expect(await screen.findByRole("checkbox")).not.toBeChecked();
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
