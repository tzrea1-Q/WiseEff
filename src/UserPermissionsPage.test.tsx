import { readFileSync } from "node:fs";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserPermissionsPage, type UserGovernanceActions } from "./UserPermissionsPage";
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

function renderPageWithActions(userGovernanceActions: UserGovernanceActions) {
  const state = { ...createPrototypeState(), activeRoleId: "admin" };
  const dispatch = vi.fn();
  const onNavigate = vi.fn();

  const utils = render(
    <UserPermissionsPage
      state={state}
      dispatch={dispatch}
      onNavigate={onNavigate}
      search=""
      userGovernanceActions={userGovernanceActions}
    />
  );

  return { ...utils, state, dispatch, onNavigate };
}

function readCssBlock(selector: string) {
  const css = readFileSync("src/styles.css", "utf8");
  const selectorIndex = css.indexOf(`${selector} {`);
  expect(selectorIndex).toBeGreaterThanOrEqual(0);

  const blockStart = css.indexOf("{", selectorIndex);
  const blockEnd = css.indexOf("}", blockStart);

  return css.slice(blockStart + 1, blockEnd);
}

describe("UserPermissionsPage", () => {
  it("renders user permissions, role names, and platform users", () => {
    renderPage();
    const capabilities = screen.getByLabelText("角色权限说明");

    expect(screen.getByRole("heading", { name: "User permissions" })).toBeInTheDocument();
    expect(within(capabilities).getByRole("heading", { name: "Guest" })).toBeInTheDocument();
    expect(within(capabilities).getByRole("heading", { name: "Hardware Committer" })).toBeInTheDocument();
    expect(within(capabilities).getByRole("heading", { name: "Software Committer" })).toBeInTheDocument();
    expect(screen.getByText("Xu Yun")).toBeInTheDocument();
  });

  it("explains role capabilities in Chinese without exposing raw permission keys", () => {
    renderPage();
    const capabilities = screen.getByLabelText("角色权限说明");

    expect(within(capabilities).getByText("仅可查看参数页面。")).toBeInTheDocument();
    expect(within(capabilities).getByText("硬件侧可查看并提交参数修改，使用参数调试和日志分析。")).toBeInTheDocument();
    expect(within(capabilities).getByText("软件侧可查看并提交参数修改，使用参数调试和日志分析。")).toBeInTheDocument();
    expect(within(capabilities).getByText("包含硬件 User 权限，并可执行硬件侧参数检视。")).toBeInTheDocument();
    expect(within(capabilities).getByText("包含硬件 User 权限，并可执行软件侧参数检视。")).toBeInTheDocument();
    expect(within(capabilities).getByText("包含全部 Committer 权限，并可访问各应用后台和用户管理。")).toBeInTheDocument();
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
    expect(summaryCopy).toContainElement(screen.getByText("8 platform users across 6 roles."));
    expect(addUserButton).toHaveClass("user-permissions-primary-action");
    expect(summaryCopy).not.toContainElement(addUserButton);
  });

  it("dispatches ADD_USER from the add user dialog", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Add user" }));
    await userEvent.type(screen.getByLabelText("Name"), "Demo Engineer");
    await userEvent.type(screen.getByLabelText("Email"), "demo@chargelab.cn");
    await userEvent.type(screen.getByLabelText("Title"), "Validation Engineer");
    await userEvent.selectOptions(screen.getByLabelText("Initial role"), "hardware-user");
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_USER",
      name: "Demo Engineer",
      email: "demo@chargelab.cn",
      title: "Validation Engineer",
      roleId: "hardware-user"
    });
  });

  it("uses backend user governance actions when adding users in API mode", async () => {
    const userGovernanceActions: UserGovernanceActions = {
      listUsers: vi.fn(async () => []),
      createUser: vi.fn(async () => ({
        id: "u-demo-engineer",
        name: "Demo Engineer Canonical",
        email: "demo+canonical@chargelab.cn",
        title: "User",
        roleId: "hardware-user" as const,
        isActive: true,
        createdAt: "2026-06-02T00:00:00.000Z",
        lastActive: "never"
      })),
      assignUserRole: vi.fn(async () => undefined),
      setUserActive: vi.fn(async () => undefined)
    };
    const { dispatch } = renderPageWithActions(userGovernanceActions);

    await userEvent.click(screen.getByRole("button", { name: "Add user" }));
    await userEvent.type(screen.getByLabelText("Name"), "Demo Engineer");
    await userEvent.type(screen.getByLabelText("Email"), "demo@chargelab.cn");
    await userEvent.type(screen.getByLabelText("Title"), "Validation Engineer");
    await userEvent.selectOptions(screen.getByLabelText("Initial role"), "hardware-user");
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    expect(userGovernanceActions.createUser).toHaveBeenCalledWith({
      name: "Demo Engineer",
      email: "demo@chargelab.cn",
      title: "Validation Engineer",
      roleId: "hardware-user"
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_USER",
      id: "u-demo-engineer",
      name: "Demo Engineer Canonical",
      email: "demo+canonical@chargelab.cn",
      title: "User",
      roleId: "hardware-user"
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
      roleId: "hardware-user"
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

    await userEvent.selectOptions(within(row).getByRole("combobox", { name: "Role for Liu Min" }), "software-committer");
    await userEvent.click(within(row).getByRole("button", { name: "Disable Liu Min" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "ASSIGN_USER_ROLE",
      userId: "u-liu-min",
      roleId: "software-committer"
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "TOGGLE_USER_ACTIVE",
      userId: "u-liu-min",
      isActive: false
    });
  });

  it("uses backend user governance actions when changing role and activation", async () => {
    const userGovernanceActions: UserGovernanceActions = {
      listUsers: vi.fn(async () => []),
      createUser: vi.fn(async () => undefined),
      assignUserRole: vi.fn(async () => undefined),
      setUserActive: vi.fn(async () => undefined)
    };
    const { dispatch } = renderPageWithActions(userGovernanceActions);
    const row = screen.getByText("Liu Min").closest("tr")!;

    await userEvent.selectOptions(within(row).getByRole("combobox", { name: "Role for Liu Min" }), "software-committer");
    await userEvent.click(within(row).getByRole("button", { name: "Disable Liu Min" }));

    expect(userGovernanceActions.assignUserRole).toHaveBeenCalledWith("u-liu-min", "software-committer");
    expect(userGovernanceActions.setUserActive).toHaveBeenCalledWith("u-liu-min", false);
    expect(dispatch).toHaveBeenCalledWith({
      type: "ASSIGN_USER_ROLE",
      userId: "u-liu-min",
      roleId: "software-committer"
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

  it("supports header filters on every user table data column", async () => {
    renderPage();

    const table = screen.getByRole("table", { name: "Platform users" });
    const checks: Array<[string, string, string]> = [
      ["User", "筛选User", "Xu Yun"],
      ["Title", "筛选Title", "Platform Owner"],
      ["Role", "筛选Role", "Admin"],
      ["Status", "筛选Status", "Active"],
      ["Last active", "筛选Last active", "just now"]
    ];

    for (const [headerName, buttonName, optionName] of checks) {
      const header = within(table).getByRole("columnheader", { name: new RegExp(headerName) });
      await userEvent.click(within(header).getByRole("button", { name: buttonName }));
      expect(within(header).getByRole("checkbox", { name: optionName })).toBeInTheDocument();
      await userEvent.click(within(header).getByRole("button", { name: buttonName }));
    }

    const roleHeader = within(table).getByRole("columnheader", { name: /Role/ });
    await userEvent.click(within(roleHeader).getByRole("button", { name: "筛选Role" }));
    await userEvent.click(within(roleHeader).getByRole("checkbox", { name: "Admin" }));

    expect(within(table).getByText("Xu Yun")).toBeInTheDocument();
    expect(within(table).queryByText("Liu Min")).not.toBeInTheDocument();
  });

  it("keeps role selectors wide enough for split committer role names", () => {
    const roleCellStyles = readCssBlock(".user-permissions-role-cell");
    const roleSelectStyles = readCssBlock(".user-permissions-role-select");

    expect(roleCellStyles).toContain("width: 204px;");
    expect(roleSelectStyles).toContain("min-width: 180px;");
    expect(roleSelectStyles).toContain("width: 180px;");
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

    expect(screen.getByRole("combobox", { name: "Role for Legacy Reviewer" })).toHaveValue("software-committer");
    expect(screen.getByRole("combobox", { name: "Role for Legacy Viewer" })).toHaveValue("hardware-user");

    await userEvent.selectOptions(screen.getByLabelText("Role"), "software-committer");

    expect(screen.getByText("Legacy Reviewer")).toBeInTheDocument();
    expect(screen.queryByText("Legacy Viewer")).not.toBeInTheDocument();
  });
});
