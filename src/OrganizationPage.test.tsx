import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createPrototypeState } from "@/infrastructure/mock/prototypeState";
import { OrganizationPage, type OrganizationActions } from "./OrganizationPage";

const adminState = { ...createPrototypeState(), activeRoleId: "admin" as const };

function createOrganizationActions(): OrganizationActions {
  return {
    getOrganization: vi.fn().mockResolvedValue({
      id: "org-chargelab",
      name: "ChargeLab",
      createdAt: "2026-01-15T00:00:00.000Z"
    }),
    updateOrganization: vi.fn()
  };
}

function renderOrganizationPage(
  organizationActions?: OrganizationActions,
  extras: { area?: "profile" | "members"; onNavigate?: (path: string) => void; onOrganizationUpdated?: () => void } = {}
) {
  return render(
    <OrganizationPage
      state={adminState}
      dispatch={vi.fn()}
      onNavigate={extras.onNavigate ?? vi.fn()}
      search=""
      area={extras.area}
      organizationActions={organizationActions}
      onOrganizationUpdated={extras.onOrganizationUpdated}
    />
  );
}

describe("OrganizationPage", () => {
  it("shows the home organization profile without the members table", async () => {
    renderOrganizationPage(createOrganizationActions());

    const scopeNav = screen.getByRole("navigation", { name: "组织管理范围" });
    expect(within(scopeNav).getByRole("button", { name: "组织管理" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("region", { name: "组织档案" })).toBeInTheDocument();
    expect(screen.getByLabelText("显示名称")).toHaveValue("ChargeLab");
    expect(screen.getByText("org-chargelab")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "用户权限" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "平台用户" })).not.toBeInTheDocument();
  });

  it("shows the members table on the people-management peer", async () => {
    renderOrganizationPage(createOrganizationActions(), { area: "members" });

    const scopeNav = screen.getByRole("navigation", { name: "组织管理范围" });
    expect(within(scopeNav).getByRole("button", { name: "人员管理" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("region", { name: "用户权限" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "平台用户" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "组织档案" })).not.toBeInTheDocument();
  });

  it("navigates between organization and people-management peers", () => {
    const onNavigate = vi.fn();
    renderOrganizationPage(createOrganizationActions(), { onNavigate });

    fireEvent.click(screen.getByRole("button", { name: "人员管理" }));
    expect(onNavigate).toHaveBeenCalledWith("/organization/members");
  });

  it("renames the organization and keeps the identifier unchanged", async () => {
    const organizationActions: OrganizationActions = {
      ...createOrganizationActions(),
      updateOrganization: vi.fn().mockResolvedValue({
        id: "org-chargelab",
        name: "雷泽能源",
        createdAt: "2026-01-15T00:00:00.000Z"
      })
    };
    const onOrganizationUpdated = vi.fn();

    renderOrganizationPage(organizationActions, { onOrganizationUpdated });

    const nameInput = await screen.findByLabelText("显示名称");
    fireEvent.change(nameInput, { target: { value: "雷泽能源" } });
    fireEvent.click(screen.getByRole("button", { name: "保存名称" }));

    await waitFor(() =>
      expect(organizationActions.updateOrganization).toHaveBeenCalledWith({ name: "雷泽能源" })
    );
    expect(onOrganizationUpdated).toHaveBeenCalledWith({
      id: "org-chargelab",
      name: "雷泽能源",
      createdAt: "2026-01-15T00:00:00.000Z"
    });
    expect(screen.getByText("org-chargelab")).toBeInTheDocument();
  });

  it("keeps the saved name when auth-context refresh fails", async () => {
    const organizationActions: OrganizationActions = {
      ...createOrganizationActions(),
      updateOrganization: vi.fn().mockResolvedValue({
        id: "org-chargelab",
        name: "雷泽能源",
        createdAt: "2026-01-15T00:00:00.000Z"
      })
    };

    render(
      <OrganizationPage
        state={adminState}
        dispatch={vi.fn()}
        onNavigate={vi.fn()}
        search=""
        organizationActions={organizationActions}
        onOrganizationUpdated={() => Promise.reject(new Error("Failed to fetch"))}
      />
    );

    fireEvent.change(await screen.findByLabelText("显示名称"), { target: { value: "雷泽能源" } });
    fireEvent.click(screen.getByRole("button", { name: "保存名称" }));

    await waitFor(() => expect(organizationActions.updateOrganization).toHaveBeenCalled());
    expect(screen.getByLabelText("显示名称")).toHaveValue("雷泽能源");
    expect(screen.getByText("org-chargelab")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("rejects an empty display name without calling the update action", async () => {
    const organizationActions = createOrganizationActions();
    renderOrganizationPage(organizationActions);

    const nameInput = await screen.findByLabelText("显示名称");
    fireEvent.change(nameInput, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "保存名称" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("显示名称不能为空。");
    expect(organizationActions.updateOrganization).not.toHaveBeenCalled();
  });

  it("hides the rename form when organization actions are missing", async () => {
    renderOrganizationPage();

    expect(await screen.findByRole("region", { name: "组织档案" })).toBeInTheDocument();
    expect(screen.queryByLabelText("显示名称")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "用户权限" })).not.toBeInTheDocument();
  });
});
