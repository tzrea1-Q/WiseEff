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
