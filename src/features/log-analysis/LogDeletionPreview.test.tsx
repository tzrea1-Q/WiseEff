import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { initialState } from "@/mockData";
import { createTestLogAnalysisRepository } from "@/test/harness/createTestLogAnalysisRepository";
import type { LogDeletionPreview } from "@/domain/logs/deletionPreview";
import { LogAdminPage } from "@/LogAdminPage";
import { LogDeletionPreviewDialog } from "./LogDeletionPreviewDialog";

const log = { ...initialState.logs[0], capturedAt: new Date().toISOString() };
const preview: LogDeletionPreview = { organizationId: "org", logId: log.id, fileName: log.fileName,
  generatedAt: "2026-10-20T12:00:00.000Z", version: "a".repeat(64), inventory: [
    { key: "records", label: "日志记录", disposition: "delete", count: 1 },
    { key: "reports", label: "分析报告", disposition: "delete", count: 0 },
    { key: "knowledge", label: "独立知识正文及历史（保留）", disposition: "retain", count: 0 }
  ], objects: { total: 1, shared: 0, exclusive: 1 }, conditions: [], notes: ["仅检查影响范围，不会删除任何业务数据或存储对象。"] };

function setup(permissions: string[] = ["logs:admin-domains"], logs = [log], apiMode = true) {
  const previewLogDeletion = vi.fn(async () => preview);
  window.history.replaceState(null, "", "/log-admin?tab=records");
  const repository = { ...createTestLogAnalysisRepository(logs), previewLogDeletion };
  render(<LogAdminPage search="" state={{ ...initialState, activeRoleId: "admin", logs }} dispatch={() => undefined}
    onNavigate={() => undefined} apiMode={apiMode} skillRepository={repository} sessionPermissions={permissions} />);
  return { previewLogDeletion, user: userEvent.setup() };
}

describe("selected log deletion scope", () => {
  it("requires explicit confirmation, recovers an uncertain commit and retries only outstanding objects", async () => {
    const user = userEvent.setup(), onDeleted = vi.fn();
    const status = { logId: log.id, version: preview.version, database: "deleted" as const, objects: "pending" as const, pendingObjects: 1 };
    const purge = vi.fn().mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ ...status, objects: "complete", pendingObjects: 0 });
    render(<LogDeletionPreviewDialog logId={log.id} loadPreview={async () => preview} onClose={() => undefined}
      purge={purge} loadStatus={async () => status} onDeleted={onDeleted} />);
    const dialog = await screen.findByRole("dialog"), remove = await within(dialog).findByRole("button", { name: "彻底删除" });
    await within(dialog).findByText(/对象总数/);
    expect(remove).toBeEnabled();
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(within(dialog).getByText(/对象总数/)).not.toBeVisible();
    await user.click(within(dialog).getByText("明细"));
    expect(within(dialog).getByText(/对象总数/)).toBeVisible();
    await user.click(remove);
    expect(await within(dialog).findByText(/日志数据库数据已永久删除/)).toBeVisible();
    expect(onDeleted).toHaveBeenCalledWith(status);
    await user.click(within(dialog).getByRole("button", { name: "重试存储清理" }));
    expect(await within(dialog).findByText("存储清理完成。")).toBeVisible();
    expect(purge.mock.calls).toEqual([[log.id, preview.version], [log.id, preview.version]]);
  });
  it("opens by keyboard, shows empty sections and retries a failed refresh without stale data", async () => {
    const { user, previewLogDeletion } = setup();
    const trigger = screen.getByRole("button", { name: "彻底删除…" });
    trigger.focus(); await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "日志删除影响预览" });
    expect(await within(dialog).findByText("分析报告")).not.toBeVisible();
    await user.click(within(dialog).getByText("明细"));
    expect(within(dialog).getByText("分析报告")).toBeVisible();
    expect(within(dialog).getByText("没有关联的保留记录。")).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: "彻底删除" })).toBeNull();
    previewLogDeletion.mockRejectedValueOnce(new Error("范围暂不可用"));
    await user.click(within(dialog).getByRole("button", { name: "重新获取" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("范围暂不可用");
    expect(within(dialog).queryByText("分析报告")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "重试" }));
    expect(await within(dialog).findByText("分析报告")).not.toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });
  it("does not offer governance inspection to a viewer", () => {
    setup(["logs:view"]);
    expect(screen.queryByRole("button", { name: "彻底删除…" })).toBeNull();
  });
  it("does not offer a preview when there is no record", () => {
    setup(["logs:admin-domains"], []);
    expect(screen.queryByRole("button", { name: "彻底删除…" })).toBeNull();
  });
  it("does not present a real deletion scope in mock mode", () => {
    setup(["logs:admin-domains"], [log], false);
    expect(screen.queryByRole("button", { name: "彻底删除…" })).toBeNull();
  });
});
