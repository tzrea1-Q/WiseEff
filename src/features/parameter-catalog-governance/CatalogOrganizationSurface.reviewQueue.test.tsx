import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import { CATALOG_ORGANIZATION_ID } from "@/application/parameter-catalog/fixtures";
import { CatalogOrganizationSurface } from "./CatalogOrganizationSurface";

describe("CatalogOrganizationSurface Organization Review Queue permission", () => {
  it.each(["?review=open", "?reviewItemId=prit_bookmark", ""])(
    "explains the Organization boundary without reading the queue for a Platform-only session at %s",
    async (search) => {
      const ports = createMockCatalogPorts({ scenario: "ready" });
      const listReviewItems = vi.spyOn(ports.governance, "listReviewItems")
        .mockRejectedValue(new Error("403 forbidden"));
      render(<CatalogOrganizationSurface {...ports} actor="platform-admin"
        sessionPermissions={["parameter:view", "catalog:author", "catalog:publish"]} search={search}
        organizationId={CATALOG_ORGANIZATION_ID} currentPersonId="platform-only"
        onAnchorChange={vi.fn()} />);

      expect(await screen.findByRole("region", { name: "参数定义目录" })).toBeVisible();
      expect(await screen.findByText("组织审核队列需要 Organization 权限；Platform 权限不能代替组织审核权限。"))
        .toBeVisible();
      expect(screen.queryByRole("button", { name: /待处理工作/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "待处理工作" })).not.toBeInTheDocument();
      expect(screen.queryByText(/审核队列加载失败/)).not.toBeInTheDocument();
      expect(listReviewItems).not.toHaveBeenCalled();
    }
  );

  it.each([
    { actor: "user" as const },
    { roleId: "guest" },
    {}
  ])("does not explain or read the queue for a non-permitted or unhydrated session %j", async (session) => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const listReviewItems = vi.spyOn(ports.governance, "listReviewItems");
    render(<CatalogOrganizationSurface {...ports} {...session}
      sessionPermissions={["parameter:view"]} search="?review=open"
      organizationId={CATALOG_ORGANIZATION_ID} currentPersonId="organization-reader"
      onAnchorChange={vi.fn()} />);

    expect(screen.queryByText(/Platform 权限不能代替组织审核权限/)).not.toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "参数定义目录" })).toBeVisible();
    expect(screen.queryByText(/Platform 权限不能代替组织审核权限/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /待处理工作/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "待处理工作" })).not.toBeInTheDocument();
    expect(listReviewItems).not.toHaveBeenCalled();
  });

  it("shows the queue action after the guest role hydrates to Organization admin", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const props = { ...ports, sessionPermissions: ["parameter:view"], search: "",
      organizationId: CATALOG_ORGANIZATION_ID, currentPersonId: "organization-reader",
      onAnchorChange: vi.fn() };
    const { rerender } = render(<CatalogOrganizationSurface {...props} roleId="guest" />);

    expect(screen.queryByText(/Platform 权限不能代替组织审核权限/)).not.toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "参数定义目录" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /待处理工作/ })).not.toBeInTheDocument();
    rerender(<CatalogOrganizationSurface {...props} roleId="admin" />);
    expect(await screen.findByRole("button", { name: /待处理工作/ })).toBeVisible();
    expect(screen.queryByText(/Platform 权限不能代替组织审核权限/)).not.toBeInTheDocument();
  });

  it("keeps the Organization queue available to an Organization admin", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const listReviewItems = vi.spyOn(ports.governance, "listReviewItems");
    render(<CatalogOrganizationSurface {...ports} actor="org-admin"
      sessionPermissions={["parameter:view"]} search="?review=open"
      organizationId={CATALOG_ORGANIZATION_ID} currentPersonId="organization-reader"
      onAnchorChange={vi.fn()} />);

    expect(await screen.findByRole("region", { name: "待审核事项" })).toBeVisible();
    await waitFor(() => expect(listReviewItems).toHaveBeenCalledWith(CATALOG_ORGANIZATION_ID));
    expect(screen.queryByText(/Platform 权限不能代替组织审核权限/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "关闭" }));
    await userEvent.setup().click(screen.getByRole("button", { name: /待处理工作/ }));
    expect(await screen.findByRole("dialog", { name: "待处理工作" })).toBeVisible();
  });
});
