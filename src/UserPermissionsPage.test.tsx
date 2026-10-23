import { selectControlOption } from "@/test/selectControlOption";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserPermissionsPage, type RegistrationRoleRequest, type UserGovernanceActions } from "./UserPermissionsPage";
import { createPrototypeState } from "./mockData";
import { declarationsFor, readStylesheet } from "./test/cssAssertions";
import type { PlatformRoleId } from "./domain/users/types";
import { WiseEffApiError } from "./infrastructure/http/apiClient";
import { requestSettingsLeave } from "./application/settingsFormNavigation";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

function renderPage(search = "") {
  const state = { ...createPrototypeState(), activeRoleId: "admin" };
  const dispatch = vi.fn();
  const onNavigate = vi.fn();

  const utils = render(<UserPermissionsPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />);

  return { ...utils, state, dispatch, onNavigate };
}

function renderPageWithActions(userGovernanceActions: UserGovernanceActions, onCurrentAccountChanged?: (accessEnded: boolean) => Promise<void>) {
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
      onCurrentAccountChanged={onCurrentAccountChanged}
      // The page owns the hydrate lifecycle now; these cases assert on the
      // ready directory, so pin the override instead of awaiting the stub.
      userDirectoryStatus="ready"
    />
  );

  return { ...utils, state, dispatch, onNavigate };
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

async function openApprovalsWorkspace() {
  await userEvent.click(screen.getByRole("tab", { name: /注册申请/ }));
}

async function openMemberDetails(name: string) {
  await userEvent.click(screen.getByRole("button", { name: `查看 ${name} 的成员资料` }));
  return screen.getByRole("dialog", { name: `${name} · 成员资料` });
}

async function chooseOrganizationRoles(dialog: HTMLElement, names: string[]) {
  const roles = within(dialog).getByRole("group", { name: "组织角色选择" });
  for (const checkbox of within(roles).getAllByRole<HTMLInputElement>("checkbox")) {
    if (checkbox.checked !== names.includes(checkbox.getAttribute("aria-label")!)) await userEvent.click(checkbox);
  }
  await userEvent.click(within(within(dialog).getByRole("form", { name: "组织角色设置" })).getByRole("button", { name: "保存" }));
}

async function openActivationAction(row: HTMLElement, name: "停用" | "启用") {
  await userEvent.click(within(row).getByRole("button", { name: /：更多$/ }));
  await userEvent.click(screen.getByRole("menuitem", { name }));
}

describe("UserPermissionsPage", () => {
  it("waits for the app's approved route before restoring another target's history filters", async () => {
    window.history.replaceState(null, "", "/organization/members?organizationId=target-A&q=kept");
    const actions: UserGovernanceActions = { listUsers: vi.fn(async () => []), createUser: vi.fn(), updateOrganizationRoles: vi.fn(), setUserActive: vi.fn(), deleteUser: vi.fn() };
    render(<UserPermissionsPage state={{ ...createPrototypeState(), activeRoleId: "admin" }} dispatch={vi.fn()} onNavigate={vi.fn()} search="?organizationId=target-A&q=kept" directoryScope="target-A" userGovernanceActions={actions} />);
    await waitFor(() => expect(actions.listUsers).toHaveBeenCalled());
    act(() => {
      window.history.pushState(null, "", "/organization/members?organizationId=target-B&q=foreign");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("searchbox", { name: "搜索用户" })).toHaveValue("kept");
  });
  it("guards an unfinished account draft before switching organization without storing its password", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "添加用户" }));
    await userEvent.type(screen.getByLabelText("姓名"), "Unfinished member");
    await userEvent.type(screen.getByLabelText("初始密码"), "private-draft-password");
    let decision!: boolean | Promise<boolean>;
    act(() => { decision = requestSettingsLeave(); });
    const confirm = screen.getByRole("dialog", { name: "放弃未保存的更改？" });
    await userEvent.click(within(confirm).getByRole("button", { name: "继续编辑" }));
    expect(await decision).toBe(false);
    expect(screen.getByLabelText("初始密码")).toHaveValue("private-draft-password");
    await userEvent.click(within(screen.getByRole("dialog", { name: "添加用户" })).getByRole("button", { name: "取消" }));
    await userEvent.click(screen.getByRole("button", { name: "添加用户" }));
    expect(screen.getByLabelText("初始密码")).toHaveValue("");
  });
  it("keeps a target directory separate from the authenticated home actor", async () => {
    const state = { ...createPrototypeState(), activeRoleId: "platform-admin" as const };
    const member = { ...state.users[0], id: "target-member", name: "Target-only member", roleId: "software-user" as const, roles: [{ projectId: null, roleId: "software-user" as const }] };
    const dispatch = vi.fn();
    const actions: UserGovernanceActions = { listUsers: vi.fn(async () => [member]), createUser: vi.fn(), updateOrganizationRoles: vi.fn(), setUserActive: vi.fn(), deleteUser: vi.fn() };
    render(<UserPermissionsPage state={state} dispatch={dispatch} onNavigate={vi.fn()} search="" userGovernanceActions={actions} directoryScope="target-organization" />);
    const table = await screen.findByRole("table", { name: "平台用户" });
    expect(await within(table).findByText("Target-only member")).toBeInTheDocument();
    expect(within(table).queryByText(state.users.find((user) => user.id === state.currentUserId)!.name)).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "HYDRATE_USERS" }));
  });
  it("enables own role editing while the server protects the last effective administrator", async () => {
    const base = createPrototypeState();
    const current = base.users.find((user) => user.id === base.currentUserId)!;
    const state = { ...base, activeRoleId: "admin", users: base.users.map((user) => user.id === current.id
      ? { ...user, roleId: "admin" as const, roles: [{ projectId: null, roleId: "admin" as const }] } : user) };
    render(<UserPermissionsPage state={state} dispatch={vi.fn()} onNavigate={vi.fn()} search="" />);
    const dialog = await openMemberDetails(current.name);
    const roles = within(dialog).getByRole("group", { name: "组织角色选择" });
    expect(within(roles).getByRole("checkbox", { name: "管理员" })).toBeEnabled();
    const software = within(roles).getByRole("checkbox", { name: "软件开发" });
    expect(software).toBeEnabled();
    await userEvent.click(software);
    expect(software).toBeChecked();
    expect(within(dialog).queryByText("不能调整当前登录账号的角色。")).not.toBeInTheDocument();
  });
  it("edits a member's complete organization role set without replacing project duties", async () => {
    const base = createPrototypeState();
    const state = { ...base, activeRoleId: "admin", users: base.users.map((user) => ({ ...user })) };
    const member = state.users.find((user) => user.id === "u-liu-min")!;
    member.roles = [{ projectId: null, roleId: "software-user" }, { projectId: "aurora", roleId: "hardware-committer" }];
    const updated = { ...member, roleId: "software-committer" as const, roles: [...member.roles, { projectId: null, roleId: "software-committer" as const }] };
    const actions = {
      listUsers: vi.fn(async () => state.users), createUser: vi.fn(async () => undefined),
      assignUserRole: vi.fn(), updateOrganizationRoles: vi.fn(async () => updated),
      setUserActive: vi.fn(async () => undefined), deleteUser: vi.fn(async () => undefined)
    };
    const dispatch = vi.fn();
    render(<UserPermissionsPage state={state} dispatch={dispatch} onNavigate={vi.fn()} search="" userGovernanceActions={actions} />);
    await screen.findByRole("table");
    const dialog = await openMemberDetails("Liu Min");
    const roles = within(dialog).getByRole("group", { name: "组织角色选择" });
    expect(within(roles).getByRole("checkbox", { name: "软件开发" })).toBeChecked();
    await userEvent.click(within(roles).getByRole("checkbox", { name: "软件MDE" }));
    await userEvent.click(within(dialog).getAllByRole("button", { name: /^配置 Liu Min 在/ })[0]);
    await userEvent.click(within(screen.getByRole("dialog", { name: "放弃未保存的更改？" })).getByRole("button", { name: "继续编辑" }));
    expect(within(roles).getByRole("checkbox", { name: "软件MDE" })).toBeChecked();
    await userEvent.click(within(within(dialog).getByRole("form", { name: "组织角色设置" })).getByRole("button", { name: "保存" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "确认调整用户角色" })).getByRole("button", { name: "确认调整" }));
    await waitFor(() => expect(actions.updateOrganizationRoles).toHaveBeenCalledWith("u-liu-min", {
      roles: ["software-user", "software-committer"], expectedRoles: ["software-user"]
    }));
    expect(actions.assignUserRole).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({ type: "HYDRATE_USERS", users: state.users.map((user) => user.id === updated.id ? updated : user) });
    expect(await within(dialog).findByRole("status")).toHaveTextContent("组织角色已保存");
  });

  it("can clear all organization roles while keeping project duties visible", async () => {
    const state = { ...createPrototypeState(), activeRoleId: "admin" };
    const member = state.users.find((user) => user.id === "u-liu-min")!;
    const projectRoles = [{ projectId: "aurora", roleId: "hardware-committer" as const }];
    state.users = state.users.map((user) => user.id === member.id ? { ...user, roles: [...projectRoles, { projectId: null, roleId: "software-user" }] } : user);
    const updated = { ...member, roleId: "guest" as const, roles: projectRoles };
    const actions: UserGovernanceActions = {
      listUsers: vi.fn(async () => state.users), createUser: vi.fn(), updateOrganizationRoles: vi.fn(async () => updated),
      setUserActive: vi.fn(), deleteUser: vi.fn()
    };
    render(<UserPermissionsPage state={state} dispatch={vi.fn()} onNavigate={vi.fn()} search="" userGovernanceActions={actions} />);
    await screen.findByRole("table");
    const dialog = await openMemberDetails("Liu Min");
    await chooseOrganizationRoles(dialog, []);
    const confirm = screen.getByRole("dialog", { name: "确认调整用户角色" });
    expect(confirm).toHaveTextContent("未授予组织级角色");
    await userEvent.click(within(confirm).getByRole("button", { name: "确认调整" }));
    expect(actions.updateOrganizationRoles).toHaveBeenCalledWith("u-liu-min", { roles: [], expectedRoles: ["software-user"] });
    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("组织角色已保存"));
    expect(within(within(dialog).getByRole("group", { name: "组织角色选择" })).getAllByRole<HTMLInputElement>("checkbox").every((box) => !box.checked)).toBe(true);
    expect(within(dialog).getByRole("region", { name: "项目职责" })).toHaveTextContent("硬件MDE");
  });

  it("shows current roles on a stale update and requires an explicit reload before retry", async () => {
    const base = createPrototypeState();
    const member = base.users.find((user) => user.id === "u-liu-min")!;
    const reloaded = { ...member, roleId: "hardware-user" as const, roles: [{ projectId: null, roleId: "hardware-user" as const }] };
    const actions: UserGovernanceActions = {
      listUsers: vi.fn().mockResolvedValueOnce(base.users).mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(base.users.map((user) => user.id === member.id ? reloaded : user)),
      createUser: vi.fn(), updateOrganizationRoles: vi.fn().mockRejectedValueOnce(new WiseEffApiError("CONFLICT", "Organization roles are stale.", {
        code: "role-bindings-stale", currentRoles: ["hardware-user"]
      }, "req-stale")).mockImplementation(async (_id, input) => ({ ...reloaded, roles: input.roles.map((roleId: PlatformRoleId) => ({ projectId: null, roleId })) })),
      setUserActive: vi.fn(), deleteUser: vi.fn()
    };
    renderPageWithActions(actions);
    const dialog = await openMemberDetails("Liu Min");
    await chooseOrganizationRoles(dialog, ["软件MDE"]);
    const confirm = screen.getByRole("dialog", { name: "确认调整用户角色" });
    await userEvent.click(within(confirm).getByRole("button", { name: "确认调整" }));
    expect(await within(confirm).findByRole("alert")).toHaveTextContent("已被其他管理员修改");
    expect(confirm).toHaveTextContent("当前组织角色：硬件开发");
    expect(within(confirm).getByRole("button", { name: "确认调整" })).toBeDisabled();
    await userEvent.click(within(confirm).getByRole("button", { name: "重新加载当前角色" }));
    expect(await within(confirm).findByRole("alert")).toHaveTextContent("网络连接失败");
    expect(within(confirm).getByRole("button", { name: "确认调整" })).toBeDisabled();
    await userEvent.click(within(confirm).getByRole("button", { name: "重新加载当前角色" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "确认调整用户角色" })).not.toBeInTheDocument());
    expect(within(dialog).getByRole("checkbox", { name: "硬件开发" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "软件MDE" })).not.toBeChecked();
    await chooseOrganizationRoles(dialog, ["硬件开发", "软件MDE"]);
    await userEvent.click(within(screen.getByRole("dialog", { name: "确认调整用户角色" })).getByRole("button", { name: "确认调整" }));
    expect(actions.updateOrganizationRoles).toHaveBeenLastCalledWith("u-liu-min", { roles: ["hardware-user", "software-committer"], expectedRoles: ["hardware-user"] });
  });

  it("clears an empty member search through the template's next step", async () => {
    renderPage();
    await userEvent.type(screen.getByRole("searchbox", { name: "搜索用户" }), "not-a-member");
    expect(screen.queryByText("Liu Min")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "清除筛选条件" }));
    expect(screen.getByRole("searchbox", { name: "搜索用户" })).toHaveValue("");
    expect(screen.getByText("Liu Min")).toBeInTheDocument();
  });
  it("shows a loading skeleton while the user directory hydrates", () => {
    const state = { ...createPrototypeState(), activeRoleId: "admin" };
    render(
      <UserPermissionsPage state={state} dispatch={vi.fn()} onNavigate={vi.fn()} search="" userDirectoryStatus="loading" />
    );

    expect(screen.getByRole("status", { name: "正在加载用户名录" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows a retryable error state when the user directory fails to load", async () => {
    const onUserDirectoryRetry = vi.fn();
    const state = { ...createPrototypeState(), activeRoleId: "admin" };
    render(
      <UserPermissionsPage
        state={state}
        dispatch={vi.fn()}
        onNavigate={vi.fn()}
        search=""
        userDirectoryStatus="error"
        userDirectoryError="无法加载用户名录，请稍后重试。"
        onUserDirectoryRetry={onUserDirectoryRetry}
      />
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("无法加载用户名录");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    await userEvent.click(within(alert).getByRole("button", { name: "重试" }));
    expect(onUserDirectoryRetry).toHaveBeenCalledTimes(1);
  });

  it("shows a dedicated empty state when no users exist at all", () => {
    const state = { ...createPrototypeState(), activeRoleId: "admin", users: [] };
    render(<UserPermissionsPage state={state} dispatch={vi.fn()} onNavigate={vi.fn()} search="" />);

    expect(screen.getByText("还没有任何用户，点击右上角「添加用户」创建第一个账号。")).toBeInTheDocument();
  });

  it("renders user permissions, role names, and platform users", () => {
    renderPage();

    expect(screen.getByRole("region", { name: "用户权限" })).toBeInTheDocument();
    expect(screen.queryByLabelText("角色权限说明")).not.toBeInTheDocument();
    expect(within(screen.getByText("Xu Yun").closest("tr")!).getByText("管理员")).toBeInTheDocument();
    expect(within(screen.getByText("Wang Jie").closest("tr")!).getByText("硬件MDE")).toBeInTheDocument();
    expect(within(screen.getByText("Sun Mei").closest("tr")!).getByText("软件MDE")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /调整.*的角色/ })).not.toBeInTheDocument();
    expect(screen.getByText("Xu Yun")).toBeInTheDocument();
  });

  it("prefers local usernames over legacy email identifiers in the user table", () => {
    renderPage();
    const row = screen.getByText("Xu Yun").closest("tr")!;

    expect(within(row).getByText("xu.yun")).toBeInTheDocument();
    expect(within(row).queryByText("xu@chargelab.cn")).not.toBeInTheDocument();
  });

  it("shows role capabilities in member details without exposing editing controls in the table", async () => {
    renderPage();
    const row = screen.getByText("Liu Min").closest("tr")!;
    expect(within(row).queryByRole("combobox")).not.toBeInTheDocument();
    const dialog = await openMemberDetails("Liu Min");
    expect(within(dialog).getByRole("checkbox", { name: "软件开发" })).toBeChecked();
    expect(
      within(dialog).getByText("软件侧可查看并提交参数修改，在变更审阅页完成合入推进，并使用参数调试和日志分析。")
    ).toBeInTheDocument();
    expect(within(dialog).queryByText("parameter:view")).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the role selector and its capabilities reachable by keyboard in member details", async () => {
    renderPage();
    const button = screen.getByRole("button", { name: "查看 Wang Jie 的成员资料" });
    act(() => button.focus());
    await userEvent.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "Wang Jie · 成员资料" });
    const roleSelect = within(dialog).getByRole("checkbox", { name: "硬件MDE" });
    expect(roleSelect).toBeChecked();
    act(() => roleSelect.focus());
    expect(roleSelect).toHaveFocus();
    expect(within(dialog).getByText("包含硬件开发权限，并可执行硬件侧参数检视。")).toBeInTheDocument();
    await userEvent.keyboard(" ");
    expect(roleSelect).not.toBeChecked();
    await userEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    const leave = screen.getByRole("dialog", { name: "放弃未保存的更改？" });
    await userEvent.click(within(leave).getByRole("button", { name: "继续编辑" }));
    expect(roleSelect).not.toBeChecked();
  });

  it("ignores unrelated URL search params when filtering users", () => {
    renderPage("?foo=bar");

    expect(screen.getByText("Xu Yun")).toBeInTheDocument();
  });

  it("restores search, column filters and sorting from the URL and preserves unrelated query values", async () => {
    window.history.replaceState(null, "", "/organization/members?q=Liu&roles=software-user&statuses=active&sort=lastActive&dir=desc&keep=1");
    renderPage(window.location.search);

    expect(screen.getByRole("searchbox", { name: "搜索用户" })).toHaveValue("Liu");
    expect(screen.getByText("Liu Min")).toBeInTheDocument();
    expect(screen.queryByText("Xu Yun")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /最近活跃/ })).toHaveAttribute("aria-sort", "descending");
    expect(within(screen.getByRole("search", { name: "用户筛选" })).getByRole("status")).toHaveTextContent("找到 1 / 9 位成员");

    const roleHeader = screen.getByRole("columnheader", { name: /组织角色/ });
    await userEvent.click(within(roleHeader).getByRole("button", { name: "筛选组织角色" }));
    expect(within(roleHeader).getByRole("checkbox", { name: "软件开发" })).toBeChecked();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "清除筛选条件" }));
    expect(screen.getByText("Xu Yun")).toBeInTheDocument();
    const cleared = new URLSearchParams(window.location.search);
    expect(cleared.has("q")).toBe(false);
    expect(cleared.has("roles")).toBe(false);
    expect(cleared.has("statuses")).toBe(false);
    expect(cleared.get("keep")).toBe("1");
    expect(cleared.get("sort")).toBe("lastActive");

    act(() => {
      window.history.pushState(null, "", "/organization/members?q=Xu&roles=admin");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("searchbox", { name: "搜索用户" })).toHaveValue("Xu");
    expect(screen.getByText("Xu Yun")).toBeInTheDocument();
    expect(screen.queryByText("Liu Min")).not.toBeInTheDocument();
  });

  it("restores pagination from the URL and resets to the first page when search changes", async () => {
    const base = createPrototypeState();
    const state = { ...base, activeRoleId: "admin", users: Array.from({ length: 12 }, (_, index) => ({
      ...base.users[0], id: `u-page-${index}`, name: `Member ${String(index).padStart(2, "0")}`
    })) };
    window.history.replaceState(null, "", "/organization/members?page=2");
    render(<UserPermissionsPage state={state} dispatch={vi.fn()} onNavigate={vi.fn()} search={window.location.search} />);

    expect(screen.getByText(/第 2 \/ 2 页 · 共 12 条/)).toBeInTheDocument();
    expect(screen.getByText("Member 10")).toBeInTheDocument();
    expect(screen.queryByText("Member 00")).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox", { name: "搜索用户" }), "Member 00");
    expect(screen.getByText("Member 00")).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).has("page")).toBe(false);
  });

  it("uses the complete organization role set to display and grant platform authority", async () => {
    const base = createPrototypeState();
    const state = { ...base, activeRoleId: "admin", users: base.users.map((user) => user.id === base.currentUserId ? {
      ...user, roleId: "admin" as const, roles: [{ projectId: null, roleId: "admin" as const }, { projectId: null, roleId: "platform-admin" as const }]
    } : user) };
    render(<UserPermissionsPage state={state} dispatch={vi.fn()} onNavigate={vi.fn()} search="" />);

    const actorRow = screen.getByText("Xu Yun").closest("tr")!;
    expect(within(actorRow).getByText(/平台超级管理员/)).toHaveAttribute("title", "管理员、平台超级管理员");
    expect(within(actorRow).getByText("+1")).toBeInTheDocument();
    const details = await openMemberDetails("Liu Min");
    expect(within(details).getByRole("checkbox", { name: "平台超级管理员" })).toBeEnabled();
  });

  it("protects a platform administrator with multiple organization roles from ordinary administrators", async () => {
    const base = createPrototypeState();
    const state = { ...base, activeRoleId: "admin", users: base.users.map((user) => user.id === "u-liu-min" ? {
      ...user, roleId: "admin" as const, roles: [{ projectId: null, roleId: "admin" as const }, { projectId: null, roleId: "platform-admin" as const }]
    } : user) };
    render(<UserPermissionsPage state={state} dispatch={vi.fn()} onNavigate={vi.fn()} search="" />);
    const details = await openMemberDetails("Liu Min");
    expect(within(details).getByRole("checkbox", { name: "平台超级管理员" })).toBeDisabled();
    expect(details).toHaveTextContent("只有平台超级管理员可以调整此账号的角色。");
    await userEvent.click(within(details).getByRole("button", { name: "关闭" }));
    await userEvent.click(within(screen.getByText("Liu Min").closest("tr")!).getByRole("button", { name: /：更多$/ }));
    const disableItem = screen.getByRole("menuitem", { name: /^停用/ });
    expect(disableItem).toHaveAttribute("aria-disabled", "true");
    expect(disableItem).toHaveTextContent("只有平台超级管理员可以停用平台超级管理员。");
    expect(screen.getByRole("menuitem", { name: "注销 Liu Min" })).toHaveAttribute("aria-disabled", "true");
  });

  it("matches any granted organization role when filtering a member with multiple roles", async () => {
    const base = createPrototypeState();
    const state = { ...base, activeRoleId: "admin", users: base.users.map((user) => user.id === base.currentUserId ? {
      ...user, roleId: "admin" as const, roles: [{ projectId: null, roleId: "admin" as const }, { projectId: null, roleId: "platform-admin" as const }]
    } : user) };
    render(<UserPermissionsPage state={state} dispatch={vi.fn()} onNavigate={vi.fn()} search="" />);
    const header = screen.getByRole("columnheader", { name: /组织角色/ });
    await userEvent.click(within(header).getByRole("button", { name: "筛选组织角色" }));
    await userEvent.click(within(header).getByRole("checkbox", { name: "管理员" }));

    expect(screen.getByText("Xu Yun")).toBeInTheDocument();
    expect(within(screen.getByText("Xu Yun").closest("tr")!).getByText(/平台超级管理员/)).toBeInTheDocument();
    expect(screen.queryByText("Liu Min")).not.toBeInTheDocument();
  });

  it("uses the operational permissions layout classes with the shared table shell", () => {
    render(<UserPermissionsPage state={{ ...createPrototypeState(), activeRoleId: "admin" }} dispatch={vi.fn()} onNavigate={vi.fn()} search="" />);

    expect(document.querySelector(".user-permissions-page")).toBeInTheDocument();
    expect(document.querySelector(".user-permissions-toolbar")).toContainElement(screen.getByRole("button", { name: "添加用户" }));
    expect(document.querySelector(".user-permissions-grid")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "平台用户" })).toBeInTheDocument();
  });

  it("keeps search and result counts in the toolbar without duplicate role or status selectors", () => {
    renderPage();

    const filters = screen.getByRole("search", { name: "用户筛选" });
    const fields = filters.querySelectorAll(".user-permissions-filter-field");

    expect(filters).toHaveClass("user-permissions-filters");
    expect(fields).toHaveLength(1);
    expect(fields[0]).toHaveClass("user-permissions-filter-field--search");
    expect(within(fields[0] as HTMLElement).getByText("搜索")).toHaveClass("user-permissions-filter-label");
    expect(within(filters).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(filters).getByRole("status")).toHaveTextContent("共 9 位成员");
    expect(within(filters).queryByRole("button", { name: "刷新成员" })).not.toBeInTheDocument();
  });

  it("keeps fixed user permissions copy localized", async () => {
    renderPageWithActions({
      listUsers: vi.fn(async () => []),
      createUser: vi.fn(async () => undefined),
      updateOrganizationRoles: vi.fn(async () => undefined),
      setUserActive: vi.fn(async () => undefined),
      deleteUser: vi.fn(async () => undefined),
      listRegistrationRoleRequests: vi.fn(async () => [])
    });

    const page = document.querySelector(".user-permissions-page") as HTMLElement;

    expect(page).toHaveTextContent("添加用户");
    expect(page).toHaveTextContent("搜索");
    expect(page).toHaveTextContent("成员列表");
    expect(screen.getByRole("table", { name: "平台用户" })).toBeInTheDocument();
    expect(page).toHaveTextContent("硬件开发");
    expect(page).toHaveTextContent("软件开发");
    expect(page).toHaveTextContent("硬件MDE");
    expect(page).toHaveTextContent("软件MDE");

    await openApprovalsWorkspace();

    expect(page).toHaveTextContent("注册申请");
    expect(screen.getByRole("radiogroup", { name: "申请范围" })).toBeInTheDocument();
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

    await userEvent.click(screen.getByRole("tab", { name: "成员列表" }));
    await userEvent.click(screen.getByRole("button", { name: "添加用户" }));

    const dialog = screen.getByRole("dialog", { name: "添加用户" });
    expect(dialog).toHaveTextContent("创建用户");
    expect(dialog).not.toHaveTextContent("Create user");
    expect(dialog).not.toHaveTextContent("显示称谓");
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
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "Demo Engineer" } });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "demo.engineer" } });
    fireEvent.change(screen.getByLabelText("职务"), { target: { value: "Validation Engineer" } });
    fireEvent.change(screen.getByLabelText("初始密码"), { target: { value: "WiseEff@2026" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "WiseEff@2026" } });
    await selectControlOption(screen.getByLabelText("初始角色"), "hardware-user");
    await userEvent.click(screen.getByRole("button", { name: "创建用户" }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_USER",
      name: "Demo Engineer",
      username: "demo.engineer",
      title: "Validation Engineer",
      roleId: "hardware-user"
    }));
  });

  it("uses backend user governance actions when adding users in API mode", async () => {
    const createdUser = {
      id: "u-demo-engineer",
      name: "Demo Engineer Canonical",
      username: "demo.engineer",
      title: "User",
      roleId: "hardware-user" as const,
      isActive: true,
      createdAt: "2026-06-02T00:00:00.000Z",
      lastActive: "never"
    };
    let resolveCreation!: (user: typeof createdUser) => void;
    const creation = new Promise<typeof createdUser>((resolve) => { resolveCreation = resolve; });
    const userGovernanceActions: UserGovernanceActions = {
      listUsers: vi.fn(async () => []),
      createUser: vi.fn(() => creation),
      updateOrganizationRoles: vi.fn(async () => undefined),
      setUserActive: vi.fn(async () => undefined),
      deleteUser: vi.fn(async () => undefined)
    };
    const { dispatch } = renderPageWithActions(userGovernanceActions);

    await userEvent.click(screen.getByRole("button", { name: "添加用户" }));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "Demo Engineer" } });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "demo.engineer" } });
    fireEvent.change(screen.getByLabelText("职务"), { target: { value: "Validation Engineer" } });
    fireEvent.change(screen.getByLabelText("初始密码"), { target: { value: "WiseEff@2026" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "WiseEff@2026" } });
    await selectControlOption(screen.getByLabelText("初始角色"), "hardware-user");
    await userEvent.click(screen.getByRole("button", { name: "创建用户" }));

    expect(userGovernanceActions.createUser).toHaveBeenCalledWith({
      name: "Demo Engineer",
      username: "demo.engineer",
      title: "Validation Engineer",
      password: "WiseEff@2026",
      roleId: "hardware-user"
    });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "ADD_USER" }));
    const pendingDialog = screen.getByRole("dialog", { name: "添加用户" });
    expect(within(pendingDialog).getByRole("button", { name: "创建中…" })).toBeDisabled();
    expect(within(pendingDialog).getByRole("button", { name: "取消" })).toBeDisabled();
    expect(within(pendingDialog).getByLabelText("姓名")).toBeDisabled();
    fireEvent.submit(pendingDialog.querySelector("form")!);
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "添加用户" })).toBeInTheDocument();
    expect(userGovernanceActions.createUser).toHaveBeenCalledTimes(1);
    resolveCreation(createdUser);
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_USER",
      id: "u-demo-engineer",
      name: "Demo Engineer Canonical",
      username: "demo.engineer",
      title: "User",
      roleId: "hardware-user"
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "添加用户" })).not.toBeInTheDocument());
  });

  it("allows the add user title to be omitted so the reducer fallback can apply", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: "添加用户" }));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "Demo Engineer" } });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "demo.engineer" } });
    fireEvent.change(screen.getByLabelText("初始密码"), { target: { value: "WiseEff@2026" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "WiseEff@2026" } });
    await userEvent.click(screen.getByRole("button", { name: "创建用户" }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_USER",
      name: "Demo Engineer",
      username: "demo.engineer",
      title: "",
      roleId: "hardware-user"
    }));
  });

  it("discards a cancelled new-account draft including credentials and the selected role", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "添加用户" }));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "Discarded User" } });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "discarded.user" } });
    fireEvent.change(screen.getByLabelText("初始密码"), { target: { value: "Discarded@2026" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "Discarded@2026" } });
    await selectControlOption(screen.getByLabelText("初始角色"), "software-user");
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    await userEvent.click(screen.getByRole("button", { name: "添加用户" }));
    expect(screen.getByLabelText("姓名")).toHaveValue("");
    expect(screen.getByLabelText("用户名")).toHaveValue("");
    expect(screen.getByLabelText("初始密码")).toHaveValue("");
    expect(screen.getByLabelText("确认密码")).toHaveValue("");
    expect(screen.getByLabelText("初始角色")).toHaveAttribute("data-value", "hardware-user");
  });

  it("keeps the add user dialog open when required account fields are empty", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: "添加用户" }));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "demo.engineer" } });
    fireEvent.change(screen.getByLabelText("职务"), { target: { value: "Validation Engineer" } });
    fireEvent.change(screen.getByLabelText("初始密码"), { target: { value: "WiseEff@2026" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "WiseEff@2026" } });
    await userEvent.click(screen.getByRole("button", { name: "创建用户" }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "添加用户" })).toBeInTheDocument();
    expect(await screen.findByText("姓名、用户名和初始密码不能为空。")).toBeInTheDocument();
  });

  it("keeps the add user dialog open when password confirmation differs", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: "添加用户" }));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "Demo Engineer" } });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "demo.engineer" } });
    fireEvent.change(screen.getByLabelText("初始密码"), { target: { value: "WiseEff@2026" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "WiseEff@2027" } });
    await userEvent.click(screen.getByRole("button", { name: "创建用户" }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "添加用户" })).toBeInTheDocument();
    expect(await screen.findByText("两次输入的密码不一致。")).toBeInTheDocument();
  });

  it("renders the add user dialog with structured form styling", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "添加用户" }));

    const dialog = screen.getByRole("dialog", { name: "添加用户" });
    const fields = dialog.querySelector(".user-permissions-modal-fields")!;

    // The shared modal contract owns the dialog card, which carries the card class.
    expect(dialog).toHaveClass("user-permissions-modal-card");
    expect(fields).toBeInTheDocument();
    expect(screen.getByLabelText("姓名").closest("label")).toHaveClass("user-permissions-modal-field");
    expect(screen.getByLabelText("用户名").closest("label")).toHaveClass("user-permissions-modal-field");
    expect(screen.getByLabelText("职务").closest("label")).toHaveClass("user-permissions-modal-field");
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

  it("dispatches role and status changes only after the confirm dialog is accepted", async () => {
    const { dispatch } = renderPage();
    const row = screen.getByText("Liu Min").closest("tr")!;

    const details = await openMemberDetails("Liu Min");
    await chooseOrganizationRoles(details, ["软件MDE"]);
    // Nothing happens before confirmation.
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "HYDRATE_USERS" }));
    const roleDialog = screen.getByRole("dialog", { name: "确认调整用户角色" });
    expect(roleDialog).toHaveTextContent(/Liu Min/);
    expect(roleDialog).toHaveTextContent(/软件开发/);
    expect(roleDialog).toHaveTextContent(/软件MDE/);
    await userEvent.click(within(roleDialog).getByRole("button", { name: "确认调整" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "HYDRATE_USERS", users: expect.arrayContaining([
      expect.objectContaining({ id: "u-liu-min", roles: [{ projectId: null, roleId: "software-committer" }] })
    ]) });

    expect(screen.getByRole("dialog", { name: "Liu Min · 成员资料" })).toBeInTheDocument();
    await userEvent.click(within(details).getByRole("button", { name: "关闭" }));
    await openActivationAction(row, "停用");
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "TOGGLE_USER_ACTIVE" }));
    const disableDialog = screen.getByRole("dialog", { name: "确认停用用户" });
    await userEvent.click(within(disableDialog).getByRole("button", { name: "确认停用" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "TOGGLE_USER_ACTIVE",
      userId: "u-liu-min",
      isActive: false
    });
  });

  it("uses backend user governance actions when changing role and activation", async () => {
    let finishRoleChange!: () => void;
    const roleChange = new Promise<void>((resolve) => { finishRoleChange = resolve; });
    const userGovernanceActions: UserGovernanceActions = {
      listUsers: vi.fn(async () => []),
      createUser: vi.fn(async () => undefined),
      updateOrganizationRoles: vi.fn(() => roleChange),
      setUserActive: vi.fn(async () => undefined),
      deleteUser: vi.fn(async () => undefined)
    };
    const { dispatch } = renderPageWithActions(userGovernanceActions);
    const row = screen.getByText("Liu Min").closest("tr")!;

    const details = await openMemberDetails("Liu Min");
    await chooseOrganizationRoles(details, ["软件MDE"]);
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "确认调整用户角色" })).getByRole("button", { name: "确认调整" })
    );
    expect(screen.getByRole("dialog", { name: "确认调整用户角色" })).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "ASSIGN_USER_ROLE" }));
    await act(async () => { finishRoleChange(); await roleChange; });
    expect(screen.queryByRole("dialog", { name: "确认调整用户角色" })).not.toBeInTheDocument();
    expect(dispatch).toHaveBeenCalledWith({ type: "HYDRATE_USERS", users: expect.arrayContaining([
      expect.objectContaining({ id: "u-liu-min", roles: [{ projectId: null, roleId: "software-committer" }] })
    ]) });
    expect(screen.getByRole("dialog", { name: "Liu Min · 成员资料" })).toBeInTheDocument();
    await userEvent.click(within(details).getByRole("button", { name: "关闭" }));
    await openActivationAction(row, "停用");
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "确认停用用户" })).getByRole("button", { name: "确认停用" })
    );

    expect(userGovernanceActions.updateOrganizationRoles).toHaveBeenCalledWith("u-liu-min", { roles: ["software-committer"], expectedRoles: ["software-user"] });
    expect(userGovernanceActions.setUserActive).toHaveBeenCalledWith("u-liu-min", false);
  });

  it("saves member profile edits including clearing an optional title through the governance action", async () => {
    const base = createPrototypeState();
    const member = base.users.find((user) => user.id === "u-liu-min")!;
    const updated = { ...member, title: "" };
    const actions: UserGovernanceActions = {
      listUsers: vi.fn(async () => []), createUser: vi.fn(async () => undefined),
      updateOrganizationRoles: vi.fn(async () => undefined), setUserActive: vi.fn(async () => undefined), deleteUser: vi.fn(async () => undefined),
      updateUserProfile: vi.fn(async () => updated)
    };
    const { dispatch } = renderPageWithActions(actions);
    const dialog = await openMemberDetails("Liu Min");
    expect(within(dialog).queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("职务（选填）"), { target: { value: "" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(actions.updateUserProfile).toHaveBeenCalledWith("u-liu-min", { name: "Liu Min", title: "" });
    expect(dispatch).toHaveBeenCalledWith({ type: "HYDRATE_USERS", users: base.users.map((user) => user.id === updated.id ? updated : user) });
    expect(within(dialog).getByRole("status")).toHaveTextContent("成员资料已保存。");
  });

  it("protects unsaved member profile edits when closing the details dialog", async () => {
    const actions: UserGovernanceActions = {
      listUsers: vi.fn(async () => []), createUser: vi.fn(async () => undefined),
      updateOrganizationRoles: vi.fn(async () => undefined), setUserActive: vi.fn(async () => undefined), deleteUser: vi.fn(async () => undefined),
      updateUserProfile: vi.fn()
    };
    renderPageWithActions(actions);
    const dialog = await openMemberDetails("Liu Min");
    fireEvent.change(within(dialog).getByLabelText("姓名"), { target: { value: "Unsaved Name" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    const confirm = screen.getByRole("dialog", { name: "放弃未保存的更改？" });
    await userEvent.click(within(confirm).getByRole("button", { name: "继续编辑" }));
    expect(within(dialog).getByLabelText("姓名")).toHaveValue("Unsaved Name");
    await userEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "放弃未保存的更改？" })).getByRole("button", { name: "放弃并离开" }));
    expect(screen.queryByRole("dialog", { name: "Liu Min · 成员资料" })).not.toBeInTheDocument();
    expect(actions.updateUserProfile).not.toHaveBeenCalled();
  });

  it("confirms permanent deletion before calling the backend and removing the user", async () => {
    const userGovernanceActions: UserGovernanceActions = {
      listUsers: vi.fn(async () => []),
      createUser: vi.fn(async () => undefined),
      updateOrganizationRoles: vi.fn(async () => undefined),
      setUserActive: vi.fn(async () => undefined),
      deleteUser: vi.fn(async () => undefined)
    };
    const { dispatch } = renderPageWithActions(userGovernanceActions);
    const row = screen.getByText("Liu Min").closest("tr")!;

    expect(within(row).queryByRole("button", { name: "注销 Liu Min" })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: /：更多$/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "注销 Liu Min" }));
    expect(userGovernanceActions.deleteUser).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "确认注销用户" });
    expect(dialog).toHaveTextContent("永久删除");
    expect(dialog).toHaveTextContent("业务与审计历史记录会保留");
    expect(dialog).toHaveTextContent("个人设备配对将撤销");
    expect(dialog).toHaveTextContent("既有历史署名不会改成接任者");
    expect(dialog).toHaveTextContent("此操作不可恢复");
    await userEvent.click(within(dialog).getByRole("button", { name: "确认注销" }));

    expect(userGovernanceActions.deleteUser).toHaveBeenCalledWith("u-liu-min");
    expect(dispatch).toHaveBeenCalledWith({ type: "DELETE_USER", userId: "u-liu-min" });
    expect(dispatch).toHaveBeenCalledWith({ type: "ADD_NOTIFICATION", message: "已注销用户 Liu Min" });
    expect(screen.queryByRole("dialog", { name: "确认注销用户" })).not.toBeInTheDocument();
  });

  it("keeps the deletion dialog open and preserves the row when the backend refuses", async () => {
    const userGovernanceActions: UserGovernanceActions = {
      listUsers: vi.fn(async () => []),
      createUser: vi.fn(async () => undefined),
      updateOrganizationRoles: vi.fn(async () => undefined),
      setUserActive: vi.fn(async () => undefined),
      deleteUser: vi.fn(async () => {
        throw new Error("服务端拒绝注销");
      })
    };
    const { dispatch } = renderPageWithActions(userGovernanceActions);
    const row = screen.getByText("Liu Min").closest("tr")!;

    expect(within(row).queryByRole("button", { name: "注销 Liu Min" })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: /：更多$/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "注销 Liu Min" }));
    const dialog = screen.getByRole("dialog", { name: "确认注销用户" });
    await userEvent.click(within(dialog).getByRole("button", { name: "确认注销" }));

    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("服务端拒绝注销"));
    expect(dialog).toBeInTheDocument();
    expect(within(row).getByText("Liu Min")).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalledWith({ type: "DELETE_USER", userId: "u-liu-min" });
  });

  it("allows confirming self deletion with an explicit session-ending warning", async () => {
    renderPage();
    const currentUserRow = screen.getByText("Xu Yun").closest("tr")!;

    await userEvent.click(within(currentUserRow).getByRole("button", { name: /：更多$/ }));
    const deleteItem = screen.getByRole("menuitem", { name: "注销 Xu Yun" });
    expect(deleteItem).not.toHaveAttribute("aria-disabled", "true");
    await userEvent.click(deleteItem);
    expect(screen.getByRole("dialog", { name: "确认注销用户" })).toHaveTextContent("操作成功后将退出当前账号");
  });

  it("ends the current session only after the server accepts self deactivation", async () => {
    const onCurrentAccountChanged = vi.fn(async () => undefined);
    const actions = { listUsers: vi.fn(async () => []), createUser: vi.fn(async () => undefined), updateOrganizationRoles: vi.fn(async () => undefined), setUserActive: vi.fn(async () => undefined), deleteUser: vi.fn(async () => undefined) };
    renderPageWithActions(actions, onCurrentAccountChanged);
    await openActivationAction(screen.getByText("Xu Yun").closest("tr")!, "停用");
    await userEvent.click(within(screen.getByRole("dialog", { name: "确认停用用户" })).getByRole("button", { name: "确认停用" }));
    await waitFor(() => expect(onCurrentAccountChanged).toHaveBeenCalledWith(true));
    expect(actions.setUserActive).toHaveBeenCalledWith("u-xu-yun", false);
  });

  it("resets a member password through the governance action", async () => {
    const userGovernanceActions: UserGovernanceActions = {
      listUsers: vi.fn(async () => []),
      createUser: vi.fn(async () => undefined),
      updateOrganizationRoles: vi.fn(async () => undefined),
      setUserActive: vi.fn(async () => undefined),
      deleteUser: vi.fn(async () => undefined),
      resetUserPassword: vi.fn(async () => undefined)
    };
    const { dispatch } = renderPageWithActions(userGovernanceActions);

    await userEvent.click(within(screen.getByText("Liu Min").closest("tr")!).getByRole("button", { name: /：更多$/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "重置 Liu Min 的密码" }));
    const dialog = screen.getByRole("dialog", { name: "重置密码" });
    expect(dialog).toHaveTextContent("Liu Min");
    await userEvent.type(within(dialog).getByLabelText("新密码"), "ResetPass@2026");
    await userEvent.type(within(dialog).getByLabelText("确认新密码"), "ResetPass@2026");
    await userEvent.click(within(dialog).getByRole("button", { name: "确认重置" }));

    expect(userGovernanceActions.resetUserPassword).toHaveBeenCalledWith("u-liu-min", "ResetPass@2026");
    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_NOTIFICATION",
      message: "已重置 Liu Min 的密码，其全部会话已退出"
    });
    expect(screen.queryByRole("dialog", { name: "重置密码" })).not.toBeInTheDocument();
  });

  it("keeps the confirm dialog open with the server refusal when the role change fails", async () => {
    const userGovernanceActions: UserGovernanceActions = {
      listUsers: vi.fn(async () => []),
      createUser: vi.fn(async () => undefined),
      updateOrganizationRoles: vi.fn(async () => {
        throw new Error("不能移除最后一名管理员。");
      }),
      setUserActive: vi.fn(async () => undefined),
      deleteUser: vi.fn(async () => undefined)
    };
    const { dispatch } = renderPageWithActions(userGovernanceActions);
    const details = await openMemberDetails("Liu Min");
    await chooseOrganizationRoles(details, ["软件MDE"]);
    const dialog = screen.getByRole("dialog", { name: "确认调整用户角色" });
    await userEvent.click(within(dialog).getByRole("button", { name: "确认调整" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("不能移除最后一名管理员。");
    expect(screen.getByRole("dialog", { name: "确认调整用户角色" })).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "ASSIGN_USER_ROLE" }));
  });

  it("enables the corresponding ordinary role after a failed request without granting the requested MDE role", async () => {
    const actions: UserGovernanceActions = {
      listUsers: vi.fn(async () => []), createUser: vi.fn(async () => undefined), updateOrganizationRoles: vi.fn(async () => undefined),
      setUserActive: vi.fn(async () => undefined), deleteUser: vi.fn(async () => undefined),
      listRegistrationRoleRequests: vi.fn(async () => [registrationRoleRequest()]),
      enableBasicRegistrationRoleRequest: vi.fn().mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce(registrationRoleRequest({ status: "rejected", decisionOutcome: "basic-enabled" }))
    };
    const { dispatch } = renderPageWithActions(actions); await openApprovalsWorkspace();
    const trigger = await screen.findByRole("button", { name: "按普通成员启用" }); trigger.focus(); await userEvent.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "按普通成员启用？" });
    expect(dialog).toHaveTextContent("软件开发"); expect(dialog).toHaveTextContent("不授予");
    expect(dialog).toHaveTextContent("启用角色：软件开发");
    expect(dialog).not.toHaveTextContent("申请角色：软件MDE");
    await userEvent.click(within(dialog).getByRole("button", { name: "启用普通成员" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("重试"); expect(dialog).toHaveTextContent("Committer Candidate");
    await userEvent.click(within(dialog).getByRole("button", { name: "启用普通成员" }));
    expect(actions.enableBasicRegistrationRoleRequest).toHaveBeenLastCalledWith("registration-role-request-1");
    expect(dispatch).toHaveBeenCalledWith({ type: "ASSIGN_USER_ROLE", userId: "u-candidate", roleId: "software-user" });
    expect(dispatch).toHaveBeenCalledWith({ type: "TOGGLE_USER_ACTIVE", userId: "u-candidate", isActive: true });
    expect(dispatch).not.toHaveBeenCalledWith({ type: "ASSIGN_USER_ROLE", userId: "u-candidate", roleId: "software-committer" });
  });

  it("renders pending registration role requests and dispatches approval decisions", async () => {
    const userGovernanceActions: UserGovernanceActions = {
      listUsers: vi.fn(async () => []),
      createUser: vi.fn(async () => undefined),
      updateOrganizationRoles: vi.fn(async () => undefined),
      setUserActive: vi.fn(async () => undefined),
      deleteUser: vi.fn(async () => undefined),
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
    const { dispatch } = renderPageWithActions(userGovernanceActions);

    await openApprovalsWorkspace();

    const queue = await screen.findByRole("tabpanel", { name: /注册申请/ });
    expect(within(queue).getByText("Committer Candidate")).toBeInTheDocument();
    expect(within(queue).getByText("committer.candidate")).toBeInTheDocument();
    expect(within(queue).getByText("软件开发")).toBeInTheDocument();
    expect(within(queue).getByText("软件MDE")).toBeInTheDocument();
    expect(within(queue).getByText("Reject Candidate")).toBeInTheDocument();

    const approveRequest = within(queue).getByText("Committer Candidate").closest("article")!;
    const rejectRequest = within(queue).getByText("Reject Candidate").closest("article")!;

    expect(within(approveRequest).getByRole("button", { name: "批准申请角色" })).toBeInTheDocument();
    expect(within(approveRequest).getByRole("button", { name: "拒绝并保持停用" })).toBeInTheDocument();
    expect(within(approveRequest).queryByRole("button", { name: "Approve Committer Candidate" })).not.toBeInTheDocument();
    expect(within(rejectRequest).queryByRole("button", { name: "Reject Reject Candidate" })).not.toBeInTheDocument();

    await userEvent.click(within(approveRequest).getByRole("button", { name: "批准申请角色" }));
    expect(userGovernanceActions.approveRegistrationRoleRequest).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "ASSIGN_USER_ROLE" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "通过注册申请？" })).getByRole("button", { name: "通过并启用" }));
    expect(userGovernanceActions.approveRegistrationRoleRequest).toHaveBeenCalledWith("registration-role-request-1");
    expect(dispatch).toHaveBeenCalledWith({ type: "ASSIGN_USER_ROLE", userId: "u-candidate", roleId: "software-committer" });
    expect(dispatch).toHaveBeenCalledWith({ type: "TOGGLE_USER_ACTIVE", userId: "u-candidate", isActive: true });
    await waitFor(() => expect(userGovernanceActions.listUsers).toHaveBeenCalledTimes(2));

    await userEvent.click(within(rejectRequest).getByRole("button", { name: "拒绝并保持停用" }));
    expect(userGovernanceActions.rejectRegistrationRoleRequest).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("dialog", { name: "拒绝注册申请？" })).getByRole("button", { name: "确认拒绝" }));
    expect(userGovernanceActions.rejectRegistrationRoleRequest).toHaveBeenCalledWith("registration-role-request-2");
  });

  it("shows recorded access outcomes in history and lets an obsolete request close without overwriting account settings", async () => {
    const actions: UserGovernanceActions = {
      listUsers: vi.fn(async () => []), createUser: vi.fn(async () => undefined), updateOrganizationRoles: vi.fn(async () => undefined),
      setUserActive: vi.fn(async () => undefined), deleteUser: vi.fn(async () => undefined),
      listRegistrationRoleRequests: vi.fn(async status => status === "decided" ? [
        registrationRoleRequest({ id: "basic", status: "rejected", decisionOutcome: "basic-enabled", decisionCanLogin: true, decisionRoleIds: ["software-user"] }),
        registrationRoleRequest({ id: "legacy", userName: "Legacy candidate", status: "rejected" })
      ] : [registrationRoleRequest({ accountChanged: true })]),
      approveRegistrationRoleRequest: vi.fn(), enableBasicRegistrationRoleRequest: vi.fn(),
      rejectRegistrationRoleRequest: vi.fn(async () => registrationRoleRequest({ status: "rejected", decisionOutcome: "rejected-preserved", decisionCanLogin: true, decisionRoleIds: ["hardware-user"] }))
    };
    const { dispatch } = renderPageWithActions(actions); await openApprovalsWorkspace();
    expect(await screen.findByRole("button", { name: "批准申请角色" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "按普通成员启用" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "关闭申请，保留现状" }));
    const dialog = screen.getByRole("dialog", { name: "拒绝注册申请？" }); expect(dialog).toHaveTextContent("保留最新设置");
    await userEvent.click(within(dialog).getByRole("button", { name: "确认拒绝" }));
    expect(actions.rejectRegistrationRoleRequest).toHaveBeenCalledWith("registration-role-request-1");
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "TOGGLE_USER_ACTIVE" }));
    await userEvent.click(screen.getByRole("radio", { name: "处理历史" }));
    expect(await screen.findByText("已按软件开发启用")).toBeInTheDocument();
    expect(screen.getByText("决定时：可登录 · 软件开发")).toBeInTheDocument();
    expect(screen.getByText("已拒绝提升（未记录账号结果）")).toBeInTheDocument();
  });

  it("shows request loading and retry states without claiming an empty approval queue", async () => {
    let rejectLoad!: (failure: Error) => void;
    const loading = new Promise<RegistrationRoleRequest[]>((_resolve, reject) => { rejectLoad = reject; });
    const actions: UserGovernanceActions = {
      listUsers: vi.fn(async () => []), createUser: vi.fn(async () => undefined),
      updateOrganizationRoles: vi.fn(async () => undefined), setUserActive: vi.fn(async () => undefined), deleteUser: vi.fn(async () => undefined),
      listRegistrationRoleRequests: vi.fn().mockImplementationOnce(() => loading).mockResolvedValue([])
    };
    renderPageWithActions(actions);
    await openApprovalsWorkspace();
    expect(screen.getByRole("status", { name: "正在加载注册申请" })).toBeInTheDocument();
    expect(screen.queryByText("暂无待处理角色申请。")).not.toBeInTheDocument();
    await act(async () => { rejectLoad(new Error("申请服务不可用")); await loading.catch(() => undefined); });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("申请服务不可用");
    expect(screen.queryByText("暂无待处理角色申请。")).not.toBeInTheDocument();
    await userEvent.click(within(alert).getByRole("button", { name: "重试" }));
    expect(await screen.findByText("暂无待处理角色申请。")).toBeInTheDocument();
    expect(actions.listRegistrationRoleRequests).toHaveBeenNthCalledWith(2, "pending");
  });

  it("restores the approval history workspace from the URL and keeps decided requests read-only", async () => {
    window.history.replaceState(null, "", "/organization/members?tab=approvals&requests=decided");
    const actions: UserGovernanceActions = {
      listUsers: vi.fn(async () => []), createUser: vi.fn(async () => undefined),
      updateOrganizationRoles: vi.fn(async () => undefined), setUserActive: vi.fn(async () => undefined), deleteUser: vi.fn(async () => undefined),
      listRegistrationRoleRequests: vi.fn(async (status) => status === "decided" ? [registrationRoleRequest({
        organizationName: "研发组织", status: "approved", decidedAt: "2026-06-12T00:01:00.000Z", decidedByUserId: "u-admin"
      })] : [])
    };
    render(<UserPermissionsPage state={{ ...createPrototypeState(), activeRoleId: "admin" }} dispatch={vi.fn()}
      onNavigate={vi.fn()} search={window.location.search} userGovernanceActions={actions} userDirectoryStatus="ready" />);

    expect(screen.getByRole("tab", { name: /注册申请/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("radio", { name: "处理历史" })).toBeChecked();
    expect(await screen.findByText("Committer Candidate")).toBeInTheDocument();
    expect(screen.getByText("研发组织")).toBeInTheDocument();
    expect(screen.getByText("已通过")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批准申请角色" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "拒绝并保持停用" })).not.toBeInTheDocument();
    expect(actions.listRegistrationRoleRequests).toHaveBeenCalledWith("decided");
    await userEvent.click(screen.getByRole("radio", { name: "待处理" }));
    expect(await screen.findByText("暂无待处理角色申请。")).toBeInTheDocument();
    expect(actions.listRegistrationRoleRequests).toHaveBeenLastCalledWith("pending");
    expect(new URLSearchParams(window.location.search).has("requests")).toBe(false);
  });

  it("waits for approval success before changing member roles or activation and preserves server refusals", async () => {
    let rejectApproval!: (failure: Error) => void;
    const approval = new Promise<RegistrationRoleRequest>((_resolve, reject) => { rejectApproval = reject; });
    const actions: UserGovernanceActions = {
      listUsers: vi.fn(async () => []), createUser: vi.fn(async () => undefined),
      updateOrganizationRoles: vi.fn(async () => undefined), setUserActive: vi.fn(async () => undefined), deleteUser: vi.fn(async () => undefined),
      listRegistrationRoleRequests: vi.fn(async () => [registrationRoleRequest({ organizationName: "软件组织" })]),
      approveRegistrationRoleRequest: vi.fn(() => approval)
    };
    const { dispatch } = renderPageWithActions(actions);
    await openApprovalsWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: "批准申请角色" }));
    const dialog = screen.getByRole("dialog", { name: "通过注册申请？" });
    expect(dialog).toHaveTextContent("软件组织");
    expect(dialog).toHaveTextContent("通过后立即启用账号");
    await userEvent.click(within(dialog).getByRole("button", { name: "通过并启用" }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "ASSIGN_USER_ROLE" }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "TOGGLE_USER_ACTIVE" }));
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(dialog).toBeInTheDocument();
    await act(async () => { rejectApproval(new Error("服务端拒绝审批")); await approval.catch(() => undefined); });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("服务端拒绝审批");
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "ASSIGN_USER_ROLE" }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "TOGGLE_USER_ACTIVE" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.getByText("Committer Candidate")).toBeInTheDocument();
    expect(actions.listUsers).toHaveBeenCalledTimes(1);
  });

  it("switches between account and approval workspaces instead of stacking both sections", async () => {
    renderPageWithActions({
      listUsers: vi.fn(async () => []),
      createUser: vi.fn(async () => undefined),
      updateOrganizationRoles: vi.fn(async () => undefined),
      setUserActive: vi.fn(async () => undefined),
      deleteUser: vi.fn(async () => undefined),
      listRegistrationRoleRequests: vi.fn(async () => [registrationRoleRequest()])
    });

    expect(screen.getByRole("tab", { name: /成员列表/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("search", { name: "用户筛选" })).toBeInTheDocument();
    expect(screen.queryByRole("tabpanel", { name: /注册申请/ })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/当前有.*条注册角色申请待处理/)).toBeInTheDocument();
    });

    const accounts = screen.getByRole("tab", { name: /成员列表/ });
    const approvals = screen.getByRole("tab", { name: /注册申请/ });
    expect(document.getElementById(approvals.getAttribute("aria-controls")!)).toHaveAttribute("hidden");
    accounts.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(approvals).toHaveFocus();
    expect(accounts).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");

    expect(approvals).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById(accounts.getAttribute("aria-controls")!)).toHaveAttribute("hidden");
    expect(approvals).toHaveAttribute("aria-controls", screen.getByRole("tabpanel", { name: /注册申请/ }).id);
    expect(screen.getByRole("tabpanel", { name: /注册申请/ })).toBeInTheDocument();
    expect(screen.queryByRole("search", { name: "用户筛选" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "平台用户" })).not.toBeInTheDocument();
  });

  it("renders compact role labels in the table and moves the selector into member details", async () => {
    renderPage();
    const row = screen.getByText("Liu Min").closest("tr")!;
    expect(within(row).getByText("软件开发")).toHaveClass("member-role-label");
    expect(within(row).queryByRole("combobox")).not.toBeInTheDocument();
    const details = await openMemberDetails("Liu Min");
    expect(within(details).getByRole("group", { name: "组织角色选择" })).toBeInTheDocument();
    expect(within(details).getByRole("checkbox", { name: "软件开发" })).toBeChecked();
  });

  it("shows activation actions in overflow without repeating the user name", async () => {
    renderPage();
    const activeUserRow = screen.getByText("Liu Min").closest("tr")!;
    const disabledUserRow = screen.getByText("Tao Lin").closest("tr")!;

    expect(within(activeUserRow).queryByRole("button", { name: "停用" })).not.toBeInTheDocument();
    expect(within(disabledUserRow).queryByRole("button", { name: "启用" })).not.toBeInTheDocument();
    expect(within(activeUserRow).queryByRole("button", { name: "停用 Liu Min" })).not.toBeInTheDocument();
    expect(within(disabledUserRow).queryByRole("button", { name: "启用 Tao Lin" })).not.toBeInTheDocument();
    await userEvent.click(within(activeUserRow).getByRole("button", { name: /：更多$/ }));
    expect(screen.getByRole("menuitem", { name: "停用" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(within(disabledUserRow).getByRole("button", { name: /：更多$/ }));
    expect(screen.getByRole("menuitem", { name: "启用" })).toBeInTheDocument();
  });

  it("keeps only role and status header filters and sorts recent activity", async () => {
    renderPage();

    const table = screen.getByRole("table", { name: "平台用户" });
    const checks: Array<[string, string, string]> = [
      ["组织角色", "筛选组织角色", "管理员"],
      ["状态", "筛选状态", "启用"]
    ];

    for (const [headerName, buttonName, optionName] of checks) {
      const header = within(table).getByRole("columnheader", { name: new RegExp(headerName) });
      await userEvent.click(within(header).getByRole("button", { name: buttonName }));
      expect(within(header).getByRole("checkbox", { name: optionName })).toBeInTheDocument();
      await userEvent.click(within(header).getByRole("button", { name: buttonName }));
    }

    expect(within(table).queryByRole("button", { name: "筛选用户" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: "筛选职务" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: "筛选最近活跃" })).not.toBeInTheDocument();
    const activityHeader = within(table).getByRole("columnheader", { name: /最近活跃/ });
    await userEvent.click(within(activityHeader).getByRole("button", { name: "最近活跃" }));
    expect(activityHeader).toHaveAttribute("aria-sort", "ascending");

    const roleHeader = within(table).getByRole("columnheader", { name: /组织角色/ });
    await userEvent.click(within(roleHeader).getByRole("button", { name: "筛选组织角色" }));
    await userEvent.click(within(roleHeader).getByRole("checkbox", { name: "管理员" }));

    expect(within(table).getByText("Xu Yun")).toBeInTheDocument();
    expect(within(table).queryByText("Liu Min")).not.toBeInTheDocument();
  });

  it("sorts accounts from the shared table shell and exposes aria-sort", async () => {
    renderPage();

    const table = screen.getByRole("table", { name: "平台用户" });
    const userHeader = within(table).getByRole("columnheader", { name: /用户/ });
    expect(userHeader).toHaveAttribute("aria-sort", "ascending");

    await userEvent.click(within(userHeader).getByRole("button", { name: "用户" }));
    expect(userHeader).toHaveAttribute("aria-sort", "descending");

    await userEvent.click(within(userHeader).getByRole("button", { name: "用户" }));
    expect(userHeader).toHaveAttribute("aria-sort", "ascending");
  });

  it("shows an empty state when search filters match no accounts", async () => {
    renderPage();

    await userEvent.type(screen.getByRole("searchbox", { name: "搜索用户" }), "不存在的账号名");

    const table = screen.getByRole("table", { name: "平台用户" });
    expect(within(table).getByText("没有符合筛选条件的用户，请调整搜索或筛选条件。")).toBeInTheDocument();
    expect(within(table).queryByText("Xu Yun")).not.toBeInTheDocument();
  });

  it("gives user management action buttons visible chrome instead of text-only controls", () => {
    // Buttons on this page consume the shared `.button` base contract; the
    // scope no longer redefines geometry or colors (FA-10).
    const css = readStylesheet("src/styles.css");
    const baseButtonStyles = declarationsFor(css, ".button");
    const primaryButtonStyles = declarationsFor(css, ".button.primary");
    expect(baseButtonStyles.background).toBe("var(--surface)");
    expect(baseButtonStyles.border).toBe("1px solid var(--border)");
    expect(baseButtonStyles["border-radius"]).toBe("var(--radius-md)");
    expect(primaryButtonStyles.background).toBe("var(--primary)");
    expect(primaryButtonStyles["border-color"]).toBe("var(--primary)");
  });

  it("shows only one compact action and overflow for each member", () => {
    renderPage();
    const row = screen.getByText("Wang Jie").closest("tr")!;
    const actions = within(row).getByRole("group", { name: "Wang Jie 操作" });
    expect(within(actions).getAllByRole("button")).toHaveLength(2);
    for (const button of within(actions).getAllByRole("button")) expect(button).toHaveAttribute("data-size", "sm");
    expect(within(row).queryByRole("button", { name: /注销/ })).not.toBeInTheDocument();
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

    // 11 users still paginate at 10 per page in the shared table shell.
    expect(screen.getByText(/第 1 \/ 2 页 · 共 11 条/)).toBeInTheDocument();
    expect(within(screen.getByText("Legacy Reviewer").closest("tr")!).getByText("软件MDE")).toBeInTheDocument();
    expect(within(screen.getByText("Legacy Viewer").closest("tr")!).getByText("硬件开发")).toBeInTheDocument();
    const roleHeader = screen.getByRole("columnheader", { name: /组织角色/ });
    await userEvent.click(within(roleHeader).getByRole("button", { name: "筛选组织角色" }));
    await userEvent.click(within(roleHeader).getByRole("checkbox", { name: "软件MDE" }));

    expect(screen.getByText("Legacy Reviewer")).toBeInTheDocument();
    expect(screen.queryByText("Legacy Viewer")).not.toBeInTheDocument();
  });
});
