import { readFileSync } from "node:fs";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserPermissionsPage, type RegistrationRoleRequest, type UserGovernanceActions } from "./UserPermissionsPage";
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

function readLastCssBlock(selector: string) {
  const css = readFileSync("src/styles.css", "utf8");
  const selectorIndex = css.lastIndexOf(`${selector} {`);
  expect(selectorIndex).toBeGreaterThanOrEqual(0);

  const blockStart = css.indexOf("{", selectorIndex);
  const blockEnd = css.indexOf("}", blockStart);

  return css.slice(blockStart + 1, blockEnd);
}

function registrationRoleRequest(overrides: Partial<RegistrationRoleRequest> = {}): RegistrationRoleRequest {
  return {
    id: "registration-role-request-1",
    organizationId: "org-chargelab",
    userId: "u-candidate",
    userName: "Committer Candidate",
    username: "committer.candidate",
    currentRoleId: "software-user",
    requestedRoleId: "software-committer",
    status: "pending",
    createdAt: "2026-06-12T00:00:00.000Z",
    decidedAt: null,
    decidedByUserId: null,
    ...overrides
  };
}

describe("UserPermissionsPage", () => {
  it("renders user permissions, role names, and platform users", () => {
    renderPage();

    expect(screen.getByRole("region", { name: "用户权限" })).toBeInTheDocument();
    expect(screen.queryByLabelText("角色权限说明")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "调整 Xu Yun 的角色" })).toHaveValue("admin");
    expect(screen.getByRole("combobox", { name: "调整 Wang Jie 的角色" })).toHaveValue("hardware-committer");
    expect(screen.getByRole("combobox", { name: "调整 Sun Mei 的角色" })).toHaveValue("software-committer");
    expect(screen.getByText("Xu Yun")).toBeInTheDocument();
  });

  it("prefers local usernames over legacy email identifiers in the user table", () => {
    renderPage();
    const row = screen.getByText("Xu Yun").closest("tr")!;

    expect(within(row).getByText("xu.yun")).toBeInTheDocument();
    expect(within(row).queryByText("xu@chargelab.cn")).not.toBeInTheDocument();
  });

  it("shows role capabilities only while a role cell is hovered", async () => {
    renderPage();
    const row = screen.getByText("Liu Min").closest("tr")!;
    const roleCell = within(row).getByRole("combobox", { name: "调整 Liu Min 的角色" }).closest("td")!;

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await userEvent.hover(roleCell);

    const tooltip = screen.getByRole("tooltip", { name: "软件开发角色权限" });
    expect(within(tooltip).getByRole("heading", { name: "软件开发" })).toBeInTheDocument();
    expect(within(tooltip).getByText("软件侧可查看并提交参数修改，使用参数调试和日志分析。")).toBeInTheDocument();
    expect(within(tooltip).getByText("查看参数")).toBeInTheDocument();
    expect(within(tooltip).getByText("修改参数")).toBeInTheDocument();
    expect(within(tooltip).getByText("使用调试平台")).toBeInTheDocument();
    expect(within(tooltip).getByText("上传日志智能分析")).toBeInTheDocument();
    expect(within(tooltip).queryByText("parameter:view")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "硬件开发" })).not.toBeInTheDocument();

    await userEvent.unhover(roleCell);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows role capabilities when a role selector receives keyboard focus", async () => {
    renderPage();
    const row = screen.getByText("Wang Jie").closest("tr")!;
    const roleSelect = within(row).getByRole("combobox", { name: "调整 Wang Jie 的角色" });

    await userEvent.click(roleSelect);

    const tooltip = screen.getByRole("tooltip", { name: "硬件MDE角色权限" });
    expect(within(tooltip).getByRole("heading", { name: "硬件MDE" })).toBeInTheDocument();
    expect(within(tooltip).getByText("包含硬件开发权限，并可执行硬件侧参数检视。")).toBeInTheDocument();
    expect(within(tooltip).getByText("审阅参数提交")).toBeInTheDocument();

    roleSelect.blur();

    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
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

    const filters = screen.getByRole("search", { name: "用户筛选" });
    const fields = filters.querySelectorAll(".user-permissions-filter-field");

    expect(filters).toHaveClass("user-permissions-filters");
    expect(fields).toHaveLength(3);
    expect(fields[0]).toHaveClass("user-permissions-filter-field--search");
    expect(within(fields[0] as HTMLElement).getByText("搜索")).toHaveClass("user-permissions-filter-label");
    expect(within(fields[1] as HTMLElement).getByText("角色")).toHaveClass("user-permissions-filter-label");
    expect(within(fields[2] as HTMLElement).getByText("状态")).toHaveClass("user-permissions-filter-label");
  });

  it("keeps fixed user permissions copy localized", async () => {
    renderPage();

    const page = document.querySelector(".user-permissions-page") as HTMLElement;

    expect(page).toHaveTextContent("添加用户");
    expect(page).toHaveTextContent("搜索");
    expect(page).toHaveTextContent("角色申请");
    expect(page).toHaveTextContent("平台用户");
    expect(page).toHaveTextContent("硬件开发");
    expect(page).toHaveTextContent("软件开发");
    expect(page).toHaveTextContent("硬件MDE");
    expect(page).toHaveTextContent("软件MDE");
    expect(page).not.toHaveTextContent("Add user");
    expect(page).not.toHaveTextContent("Search users");
    expect(page).not.toHaveTextContent("All roles");
    expect(page).not.toHaveTextContent("All statuses");
    expect(page).not.toHaveTextContent("Role requests");
    expect(page).not.toHaveTextContent("No pending role requests");
    expect(page).not.toHaveTextContent("硬件用户");
    expect(page).not.toHaveTextContent("软件用户");
    expect(page).not.toHaveTextContent("硬件提交人");
    expect(page).not.toHaveTextContent("软件提交人");

    await userEvent.click(screen.getByRole("button", { name: "添加用户" }));

    const dialog = screen.getByRole("dialog", { name: "添加用户" });
    expect(dialog).toHaveTextContent("创建用户");
    expect(dialog).not.toHaveTextContent("Create user");
  });

  it("keeps the repeated page title copy out of the user management body", () => {
    renderPage();

    const page = document.querySelector(".user-permissions-page") as HTMLElement;
    const addUserButton = screen.getByRole("button", { name: "添加用户" });

    expect(page).not.toHaveTextContent("Access control");
    expect(page).not.toHaveTextContent("8 platform users across 6 roles.");
    expect(page.querySelector(".user-permissions-summary__copy")).not.toBeInTheDocument();
    expect(addUserButton).toHaveClass("user-permissions-primary-action");
  });

  it("dispatches ADD_USER from the add user dialog", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: "添加用户" }));
    await userEvent.type(screen.getByLabelText("姓名"), "Demo Engineer");
    await userEvent.type(screen.getByLabelText("用户名"), "demo.engineer");
    await userEvent.type(screen.getByLabelText("显示称谓"), "Validation Engineer");
    await userEvent.type(screen.getByLabelText("初始密码"), "WiseEff@2026");
    await userEvent.type(screen.getByLabelText("确认密码"), "WiseEff@2026");
    await userEvent.selectOptions(screen.getByLabelText("初始角色"), "hardware-user");
    await userEvent.click(screen.getByRole("button", { name: "创建用户" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_USER",
      name: "Demo Engineer",
      username: "demo.engineer",
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
        username: "demo.engineer",
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

    await userEvent.click(screen.getByRole("button", { name: "添加用户" }));
    await userEvent.type(screen.getByLabelText("姓名"), "Demo Engineer");
    await userEvent.type(screen.getByLabelText("用户名"), "demo.engineer");
    await userEvent.type(screen.getByLabelText("显示称谓"), "Validation Engineer");
    await userEvent.type(screen.getByLabelText("初始密码"), "WiseEff@2026");
    await userEvent.type(screen.getByLabelText("确认密码"), "WiseEff@2026");
    await userEvent.selectOptions(screen.getByLabelText("初始角色"), "hardware-user");
    await userEvent.click(screen.getByRole("button", { name: "创建用户" }));

    expect(userGovernanceActions.createUser).toHaveBeenCalledWith({
      name: "Demo Engineer",
      username: "demo.engineer",
      title: "Validation Engineer",
      password: "WiseEff@2026",
      roleId: "hardware-user"
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_USER",
      id: "u-demo-engineer",
      name: "Demo Engineer Canonical",
      username: "demo.engineer",
      title: "User",
      roleId: "hardware-user"
    });
  });

  it("allows the add user title to be omitted so the reducer fallback can apply", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: "添加用户" }));
    await userEvent.type(screen.getByLabelText("姓名"), "Demo Engineer");
    await userEvent.type(screen.getByLabelText("用户名"), "demo.engineer");
    await userEvent.type(screen.getByLabelText("初始密码"), "WiseEff@2026");
    await userEvent.type(screen.getByLabelText("确认密码"), "WiseEff@2026");
    await userEvent.click(screen.getByRole("button", { name: "创建用户" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_USER",
      name: "Demo Engineer",
      username: "demo.engineer",
      title: "",
      roleId: "hardware-user"
    });
  });

  it("keeps the add user dialog open when required account fields are empty", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: "添加用户" }));
    await userEvent.type(screen.getByLabelText("姓名"), "   ");
    await userEvent.type(screen.getByLabelText("用户名"), "demo.engineer");
    await userEvent.type(screen.getByLabelText("显示称谓"), "Validation Engineer");
    await userEvent.type(screen.getByLabelText("初始密码"), "WiseEff@2026");
    await userEvent.type(screen.getByLabelText("确认密码"), "WiseEff@2026");
    await userEvent.click(screen.getByRole("button", { name: "创建用户" }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "添加用户" })).toBeInTheDocument();
    expect(screen.getByText("姓名、用户名和初始密码不能为空。")).toBeInTheDocument();
  });

  it("keeps the add user dialog open when password confirmation differs", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: "添加用户" }));
    await userEvent.type(screen.getByLabelText("姓名"), "Demo Engineer");
    await userEvent.type(screen.getByLabelText("用户名"), "demo.engineer");
    await userEvent.type(screen.getByLabelText("初始密码"), "WiseEff@2026");
    await userEvent.type(screen.getByLabelText("确认密码"), "WiseEff@2027");
    await userEvent.click(screen.getByRole("button", { name: "创建用户" }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "添加用户" })).toBeInTheDocument();
    expect(screen.getByText("两次输入的密码不一致。")).toBeInTheDocument();
  });

  it("renders the add user dialog with structured form styling", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "添加用户" }));

    const dialog = screen.getByRole("dialog", { name: "添加用户" });
    const form = dialog.querySelector("form")!;
    const fields = dialog.querySelector(".user-permissions-modal-fields")!;

    expect(form).toHaveClass("user-permissions-modal-card");
    expect(fields).toBeInTheDocument();
    expect(screen.getByLabelText("姓名").closest("label")).toHaveClass("user-permissions-modal-field");
    expect(screen.getByLabelText("用户名").closest("label")).toHaveClass("user-permissions-modal-field");
    expect(screen.getByLabelText("显示称谓").closest("label")).toHaveClass("user-permissions-modal-field");
    expect(screen.getByLabelText("初始密码").closest("label")).toHaveClass("user-permissions-modal-field");
    expect(screen.getByLabelText("确认密码").closest("label")).toHaveClass("user-permissions-modal-field");
    expect(screen.getByLabelText("初始角色").closest("label")).toHaveClass("user-permissions-modal-field");
    expect(screen.getByLabelText("姓名")).toHaveClass("user-permissions-modal-control");
    expect(screen.getByLabelText("用户名")).toHaveClass("user-permissions-modal-control");
    expect(screen.getByLabelText("初始密码")).toHaveClass("user-permissions-modal-control");
    expect(screen.getByLabelText("确认密码")).toHaveClass("user-permissions-modal-control");
    expect(screen.getByLabelText("初始角色")).toHaveClass("user-permissions-modal-control");
    expect(screen.queryByLabelText("邮箱")).not.toBeInTheDocument();
    expect(dialog.querySelector(".user-permissions-modal-actions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toHaveClass("user-permissions-modal-action");
    expect(screen.getByRole("button", { name: "取消" })).toHaveClass("user-permissions-modal-action--secondary");
    expect(screen.getByRole("button", { name: "创建用户" })).toHaveClass("user-permissions-modal-action");
    expect(screen.getByRole("button", { name: "创建用户" })).toHaveClass("user-permissions-modal-action--primary");
  });

  it("dispatches role and status changes from the user table", async () => {
    const { dispatch } = renderPage();
    const row = screen.getByText("Liu Min").closest("tr")!;

    await userEvent.selectOptions(within(row).getByRole("combobox", { name: "调整 Liu Min 的角色" }), "software-committer");
    await userEvent.click(within(row).getByRole("button", { name: "停用" }));

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

    await userEvent.selectOptions(within(row).getByRole("combobox", { name: "调整 Liu Min 的角色" }), "software-committer");
    await userEvent.click(within(row).getByRole("button", { name: "停用" }));

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

  it("renders pending registration role requests and dispatches approval decisions", async () => {
    const userGovernanceActions: UserGovernanceActions = {
      listUsers: vi.fn(async () => []),
      createUser: vi.fn(async () => undefined),
      assignUserRole: vi.fn(async () => undefined),
      setUserActive: vi.fn(async () => undefined),
      listRegistrationRoleRequests: vi.fn(async () => [
        registrationRoleRequest(),
        registrationRoleRequest({
          id: "registration-role-request-2",
          userId: "u-candidate-2",
          userName: "Reject Candidate",
          username: "reject.candidate",
          currentRoleId: "hardware-user",
          requestedRoleId: "hardware-committer"
        })
      ]),
      approveRegistrationRoleRequest: vi.fn(async () => registrationRoleRequest({
        status: "approved",
        decidedAt: "2026-06-12T00:01:00.000Z",
        decidedByUserId: "u-admin"
      })),
      rejectRegistrationRoleRequest: vi.fn(async () => registrationRoleRequest({
        id: "registration-role-request-2",
        userId: "u-candidate-2",
        userName: "Reject Candidate",
        username: "reject.candidate",
        currentRoleId: "hardware-user",
        requestedRoleId: "hardware-committer",
        status: "rejected",
        decidedAt: "2026-06-12T00:01:00.000Z",
        decidedByUserId: "u-admin"
      }))
    };
    renderPageWithActions(userGovernanceActions);

    const queue = await screen.findByRole("region", { name: "注册角色申请" });
    expect(within(queue).getByText("Committer Candidate")).toBeInTheDocument();
    expect(within(queue).getByText("committer.candidate")).toBeInTheDocument();
    expect(within(queue).getByText("软件开发")).toBeInTheDocument();
    expect(within(queue).getByText("软件MDE")).toBeInTheDocument();
    expect(within(queue).getByText("Reject Candidate")).toBeInTheDocument();

    const approveRequest = within(queue).getByText("Committer Candidate").closest("article")!;
    const rejectRequest = within(queue).getByText("Reject Candidate").closest("article")!;

    expect(within(approveRequest).getByRole("button", { name: "通过" })).toBeInTheDocument();
    expect(within(approveRequest).getByRole("button", { name: "拒绝" })).toBeInTheDocument();
    expect(within(approveRequest).queryByRole("button", { name: "Approve Committer Candidate" })).not.toBeInTheDocument();
    expect(within(rejectRequest).queryByRole("button", { name: "Reject Reject Candidate" })).not.toBeInTheDocument();

    await userEvent.click(within(approveRequest).getByRole("button", { name: "通过" }));
    expect(userGovernanceActions.approveRegistrationRoleRequest).toHaveBeenCalledWith("registration-role-request-1");

    await userEvent.click(within(rejectRequest).getByRole("button", { name: "拒绝" }));
    expect(userGovernanceActions.rejectRegistrationRoleRequest).toHaveBeenCalledWith("registration-role-request-2");
  });

  it("uses compact table styling for row role selectors", () => {
    renderPage();
    const row = screen.getByText("Liu Min").closest("tr")!;
    const roleCell = within(row).getByRole("combobox", { name: "调整 Liu Min 的角色" }).closest("td");
    const roleSelect = within(row).getByRole("combobox", { name: "调整 Liu Min 的角色" });

    expect(screen.getByRole("columnheader", { name: "角色" })).toHaveClass("user-permissions-role-header");
    expect(roleCell).toHaveClass("user-permissions-role-cell");
    expect(roleSelect).toHaveClass("user-permissions-role-select");
  });

  it("shows activation actions without repeating the user name", () => {
    renderPage();
    const activeUserRow = screen.getByText("Liu Min").closest("tr")!;
    const disabledUserRow = screen.getByText("Tao Lin").closest("tr")!;

    expect(within(activeUserRow).getByRole("button", { name: "停用" })).toBeInTheDocument();
    expect(within(disabledUserRow).getByRole("button", { name: "启用" })).toBeInTheDocument();
    expect(within(activeUserRow).queryByRole("button", { name: "停用 Liu Min" })).not.toBeInTheDocument();
    expect(within(disabledUserRow).queryByRole("button", { name: "启用 Tao Lin" })).not.toBeInTheDocument();
  });

  it("supports header filters on every user table data column", async () => {
    renderPage();

    const table = screen.getByRole("table", { name: "平台用户" });
    const checks: Array<[string, string, string]> = [
      ["用户", "筛选用户", "Xu Yun"],
      ["职务", "筛选职务", "Platform Owner"],
      ["角色", "筛选角色", "管理员"],
      ["状态", "筛选状态", "启用"],
      ["最近活跃", "筛选最近活跃", "just now"]
    ];

    for (const [headerName, buttonName, optionName] of checks) {
      const header = within(table).getByRole("columnheader", { name: new RegExp(headerName) });
      await userEvent.click(within(header).getByRole("button", { name: buttonName }));
      expect(within(header).getByRole("checkbox", { name: optionName })).toBeInTheDocument();
      await userEvent.click(within(header).getByRole("button", { name: buttonName }));
    }

    const roleHeader = within(table).getByRole("columnheader", { name: /角色/ });
    await userEvent.click(within(roleHeader).getByRole("button", { name: "筛选角色" }));
    await userEvent.click(within(roleHeader).getByRole("checkbox", { name: "管理员" }));

    expect(within(table).getByText("Xu Yun")).toBeInTheDocument();
    expect(within(table).queryByText("Liu Min")).not.toBeInTheDocument();
  });

  it("keeps role selectors wide enough for split committer role names", () => {
    const roleCellStyles = readCssBlock(".user-permissions-role-cell");
    const roleSelectStyles = readCssBlock(".user-permissions-role-select");
    const roleTooltipStyles = readLastCssBlock(".user-permissions-role-tooltip");

    expect(roleCellStyles).toContain("width: 204px;");
    expect(roleSelectStyles).toContain("min-width: 180px;");
    expect(roleSelectStyles).toContain("width: 180px;");
    expect(roleTooltipStyles).toContain("position: fixed;");
    expect(roleTooltipStyles).toContain("max-height: calc(100vh - 32px);");
    expect(roleTooltipStyles).toContain("overflow: auto;");
  });

  it("gives user management action buttons visible chrome instead of text-only controls", () => {
    const baseButtonStyles = readCssBlock(".user-permissions-page .button");
    const primaryButtonStyles = readCssBlock(".user-permissions-page .button.primary");

    expect(baseButtonStyles).toContain("display: inline-flex;");
    expect(baseButtonStyles).toContain("background: #fff;");
    expect(baseButtonStyles).toContain("border: 1px solid #d7dfec;");
    expect(baseButtonStyles).toContain("border-radius: 8px;");
    expect(primaryButtonStyles).toContain("background: var(--app-primary);");
    expect(primaryButtonStyles).toContain("border-color: var(--app-primary);");
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

    expect(screen.getByRole("combobox", { name: "调整 Legacy Reviewer 的角色" })).toHaveValue("software-committer");
    expect(screen.getByRole("combobox", { name: "调整 Legacy Viewer 的角色" })).toHaveValue("hardware-user");

    await userEvent.selectOptions(screen.getByLabelText("角色"), "software-committer");

    expect(screen.getByText("Legacy Reviewer")).toBeInTheDocument();
    expect(screen.queryByText("Legacy Viewer")).not.toBeInTheDocument();
  });
});
