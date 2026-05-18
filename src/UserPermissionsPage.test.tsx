import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserPermissionsPage } from "./UserPermissionsPage";
import { createPrototypeState } from "./mockData";
import type { PlatformRoleId } from "./domain/users/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage(search = "") {
  const state = { ...createPrototypeState(), activeRoleId: "admin" };
  const dispatch = vi.fn();
  const onNavigate = vi.fn();

  const utils = render(<UserPermissionsPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />);

  return { ...utils, state, dispatch, onNavigate };
}

describe("UserPermissionsPage", () => {
  it("renders user permissions, role names, and platform users", () => {
    renderPage();
    const capabilities = screen.getByLabelText("角色权限说明");

    expect(screen.getByRole("heading", { name: "User permissions" })).toBeInTheDocument();
    expect(within(capabilities).getByRole("heading", { name: "Guest" })).toBeInTheDocument();
    expect(within(capabilities).getByRole("heading", { name: "Committer" })).toBeInTheDocument();
    expect(screen.getByText("Xu Yun")).toBeInTheDocument();
  });

  it("explains role capabilities in Chinese without exposing raw permission keys", () => {
    renderPage();
    const capabilities = screen.getByLabelText("角色权限说明");

    expect(within(capabilities).getByText("仅可查看参数页面。")).toBeInTheDocument();
    expect(within(capabilities).getByText("可查看并修改参数，使用参数调试和节点调试，并上传日志进行智能分析。")).toBeInTheDocument();
    expect(within(capabilities).getByText("包含 User 权限，并可审阅参数提交。")).toBeInTheDocument();
    expect(within(capabilities).getByText("包含 Committer 权限，并可访问各应用后台和用户管理。")).toBeInTheDocument();
    expect(within(capabilities).getAllByText("查看参数").length).toBeGreaterThan(0);
    expect(within(capabilities).getByText("管理用户权限")).toBeInTheDocument();
    expect(within(capabilities).queryByText("parameter:view")).not.toBeInTheDocument();
    expect(within(capabilities).queryByText("users:manage")).not.toBeInTheDocument();
  });

  it("ignores unrelated URL search params when filtering users", () => {
    renderPage("?foo=bar");

    expect(screen.getByText("Xu Yun")).toBeInTheDocument();
  });

  it("uses the operational permissions layout classes", () => {
    render(<UserPermissionsPage state={{ ...createPrototypeState(), activeRoleId: "admin" }} dispatch={vi.fn()} onNavigate={vi.fn()} search="" />);

    expect(document.querySelector(".user-permissions-page")).toBeInTheDocument();
    expect(document.querySelector(".user-permissions-grid")).toBeInTheDocument();
    expect(document.querySelector(".user-permissions-table-card")).toBeInTheDocument();
  });

  it("renders user filters as grouped toolbar fields", () => {
    renderPage();

    const filters = screen.getByRole("search", { name: "User filters" });
    const fields = filters.querySelectorAll(".user-permissions-filter-field");

    expect(filters).toHaveClass("user-permissions-filters");
    expect(fields).toHaveLength(3);
    expect(fields[0]).toHaveClass("user-permissions-filter-field--search");
    expect(within(fields[0] as HTMLElement).getByText("Search")).toHaveClass("user-permissions-filter-label");
    expect(within(fields[1] as HTMLElement).getByText("Role")).toHaveClass("user-permissions-filter-label");
    expect(within(fields[2] as HTMLElement).getByText("Status")).toHaveClass("user-permissions-filter-label");
  });

  it("keeps the page title grouped away from the add user action", () => {
    renderPage();

    const summaryCopy = document.querySelector(".user-permissions-summary__copy") as HTMLElement;
    const addUserButton = screen.getByRole("button", { name: "Add user" });

    expect(summaryCopy).toContainElement(screen.getByRole("heading", { name: "User permissions" }));
    expect(summaryCopy).toContainElement(screen.getByText("8 platform users across 4 roles."));
    expect(addUserButton).toHaveClass("user-permissions-primary-action");
    expect(summaryCopy).not.toContainElement(addUserButton);
  });

  it("dispatches ADD_USER from the add user dialog", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Add user" }));
    await userEvent.type(screen.getByLabelText("Name"), "Demo Engineer");
    await userEvent.type(screen.getByLabelText("Email"), "demo@chargelab.cn");
    await userEvent.type(screen.getByLabelText("Title"), "Validation Engineer");
    await userEvent.selectOptions(screen.getByLabelText("Initial role"), "user");
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_USER",
      name: "Demo Engineer",
      email: "demo@chargelab.cn",
      title: "Validation Engineer",
      roleId: "user"
    });
  });

  it("allows the add user title to be omitted so the reducer fallback can apply", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Add user" }));
    await userEvent.type(screen.getByLabelText("Name"), "Demo Engineer");
    await userEvent.type(screen.getByLabelText("Email"), "demo@chargelab.cn");
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_USER",
      name: "Demo Engineer",
      email: "demo@chargelab.cn",
      title: "",
      roleId: "user"
    });
  });

  it("keeps the add user dialog open when trimmed name or email is empty", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Add user" }));
    await userEvent.type(screen.getByLabelText("Name"), "   ");
    await userEvent.type(screen.getByLabelText("Email"), "demo@chargelab.cn");
    await userEvent.type(screen.getByLabelText("Title"), "Validation Engineer");
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Add user" })).toBeInTheDocument();
    expect(screen.getByText("Name and email are required.")).toBeInTheDocument();
  });

  it("renders the add user dialog with structured form styling", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Add user" }));

    const dialog = screen.getByRole("dialog", { name: "Add user" });
    const form = dialog.querySelector("form")!;
    const fields = dialog.querySelector(".user-permissions-modal-fields")!;

    expect(form).toHaveClass("user-permissions-modal-card");
    expect(fields).toBeInTheDocument();
    expect(screen.getByLabelText("Name").closest("label")).toHaveClass("user-permissions-modal-field");
    expect(screen.getByLabelText("Email").closest("label")).toHaveClass("user-permissions-modal-field");
    expect(screen.getByLabelText("Title").closest("label")).toHaveClass("user-permissions-modal-field");
    expect(screen.getByLabelText("Initial role").closest("label")).toHaveClass("user-permissions-modal-field");
    expect(screen.getByLabelText("Name")).toHaveClass("user-permissions-modal-control");
    expect(screen.getByLabelText("Initial role")).toHaveClass("user-permissions-modal-control");
    expect(dialog.querySelector(".user-permissions-modal-actions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("user-permissions-modal-action");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("user-permissions-modal-action--secondary");
    expect(screen.getByRole("button", { name: "Create user" })).toHaveClass("user-permissions-modal-action");
    expect(screen.getByRole("button", { name: "Create user" })).toHaveClass("user-permissions-modal-action--primary");
  });

  it("dispatches role and status changes from the user table", async () => {
    const { dispatch } = renderPage();
    const row = screen.getByText("Liu Min").closest("tr")!;

    await userEvent.selectOptions(within(row).getByRole("combobox", { name: "Role for Liu Min" }), "committer");
    await userEvent.click(within(row).getByRole("button", { name: "Disable Liu Min" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "ASSIGN_USER_ROLE",
      userId: "u-liu-min",
      roleId: "committer"
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "TOGGLE_USER_ACTIVE",
      userId: "u-liu-min",
      isActive: false
    });
  });

  it("uses compact table styling for row role selectors", () => {
    renderPage();
    const row = screen.getByText("Liu Min").closest("tr")!;
    const roleCell = within(row).getByRole("combobox", { name: "Role for Liu Min" }).closest("td");
    const roleSelect = within(row).getByRole("combobox", { name: "Role for Liu Min" });

    expect(screen.getByRole("columnheader", { name: "Role" })).toHaveClass("user-permissions-role-header");
    expect(roleCell).toHaveClass("user-permissions-role-cell");
    expect(roleSelect).toHaveClass("user-permissions-role-select");
  });

  it("renders and filters legacy role ids under their migrated platform role", async () => {
    const base = createPrototypeState();
    const state = {
      ...base,
      users: [
        ...base.users,
        {
          id: "u-legacy-param-admin",
          name: "Legacy Reviewer",
          email: "legacy-reviewer@chargelab.cn",
          title: "Legacy role",
          roleId: "parameter-admin" as PlatformRoleId,
          isActive: true,
          createdAt: "2025-01-01T00:00:00.000Z",
          lastActive: "today"
        },
        {
          id: "u-legacy-hardware",
          name: "Legacy Viewer",
          email: "legacy-viewer@chargelab.cn",
          title: "Legacy role",
          roleId: "hardware" as PlatformRoleId,
          isActive: true,
          createdAt: "2025-01-01T00:00:00.000Z",
          lastActive: "today"
        }
      ]
    };

    render(<UserPermissionsPage state={state} dispatch={vi.fn()} onNavigate={vi.fn()} search="" />);

    expect(screen.getByRole("combobox", { name: "Role for Legacy Reviewer" })).toHaveValue("committer");
    expect(screen.getByRole("combobox", { name: "Role for Legacy Viewer" })).toHaveValue("guest");

    await userEvent.selectOptions(screen.getByLabelText("Role"), "committer");

    expect(screen.getByText("Legacy Reviewer")).toBeInTheDocument();
    expect(screen.queryByText("Legacy Viewer")).not.toBeInTheDocument();
  });
});
