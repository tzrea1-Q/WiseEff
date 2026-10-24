import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { OrganizationDeletionPreviewDialog } from "./OrganizationDeletionPreviewDialog";
import type { OrganizationDeletionPreview } from "@/infrastructure/http/platformOrganizationsClient";

it("keeps a failed read retryable, shows the fixed target and offers no destructive action", async () => {
  const preview: OrganizationDeletionPreview = { organizationId: "target", organizationName: "目标组织", status: "active", generatedAt: "2026-10-23", stateDigest: "a".repeat(64),
    inventory: [{ key: "public.users", category: "accounts", count: 3 }], platformAccounts: [{ id: "platform", name: "待调离管理员", isActive: false, canLogin: false }],
    survivingPlatformAdministrators: 1, experienceRegistration: { isTarget: true, enabled: true }, producers: [{ key: "jobs", label: "后台任务", count: 2 }], storage: { exclusiveObjects: 2, sharedObjects: 1 },
    blockers: [{ code: "experience-registration", message: "请先关闭体验注册" }], admissionAvailable: false, notes: ["readonly", "accounts", "备份按保留周期过期"] };
  const client = { previewDeletion: vi.fn().mockRejectedValueOnce(new Error("预览服务暂不可用")).mockResolvedValue(preview) }, navigate = vi.fn();
  render(<OrganizationDeletionPreviewDialog organizationId="target" client={client} onClose={vi.fn()} onNavigate={navigate} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("预览服务暂不可用");
  await userEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByText("目标组织")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("请先关闭体验注册");
  expect(screen.getByText(/待调离管理员/)).toHaveTextContent("已停用");
  expect(screen.getByText("备份按保留周期过期")).toBeVisible();
  expect(screen.queryByRole("button", { name: /确认删除|彻底删除/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "管理与调动成员" }));
  expect(navigate).toHaveBeenCalledWith("/organization/members?organizationId=target");
  expect(client.previewDeletion).toHaveBeenNthCalledWith(1, "target");
  expect(client.previewDeletion).toHaveBeenNthCalledWith(2, "target");
});

it.each([true, false])("uses the server's populated-domain execution signal (%s)", async executionAvailable => {
  const preview: OrganizationDeletionPreview = { organizationId: "target", organizationName: "包含知识的组织", status: "active", generatedAt: "2026-10-23", stateDigest: "b".repeat(64),
    inventory: [{ key: "public.knowledge_entries", category: "knowledge", count: 4 }], platformAccounts: [], survivingPlatformAdministrators: 1,
    experienceRegistration: { isTarget: false, enabled: false }, producers: [], storage: { exclusiveObjects: 1, sharedObjects: 0 },
    blockers: [], admissionAvailable: true, executionAvailable, notes: [] };
  const requestDelete = vi.fn();
  render(<OrganizationDeletionPreviewDialog organizationId="target" client={{ previewDeletion: vi.fn().mockResolvedValue(preview) }}
    onClose={vi.fn()} onNavigate={vi.fn()} onRequestDelete={requestDelete} />);
  await screen.findByText("包含知识的组织");
  if (executionAvailable) {
    await userEvent.click(screen.getByRole("button", { name: "开始彻底删除" }));
    expect(requestDelete).toHaveBeenCalledWith(preview);
  } else expect(screen.queryByRole("button", { name: "开始彻底删除" })).not.toBeInTheDocument();
});
