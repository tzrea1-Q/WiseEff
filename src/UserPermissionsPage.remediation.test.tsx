import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { UserPermissionsPage, type RegistrationRoleRequest, type UserPermissionsPageProps } from "./UserPermissionsPage";
import { createPrototypeState } from "./mockData";
import { createTestUserGovernanceActions } from "./test/harness";

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });
function setup(props: Partial<UserPermissionsPageProps> = {}) {
  const state = { ...createPrototypeState(), activeRoleId: "admin" as const };
  render(<UserPermissionsPage state={state} dispatch={vi.fn()} onNavigate={vi.fn()} search="" userDirectoryStatus="ready" {...props} />);
  return state;
}

it("offers invitation and direct creation through one member entry", async () => {
  const onInvite = vi.fn(); setup({ onInvite });
  await userEvent.click(screen.getByRole("button", { name: "添加成员" }));
  const choice = screen.getByRole("dialog", { name: "添加成员" });
  expect(within(choice).getByRole("button", { name: "直接创建账号" })).toBeVisible();
  await userEvent.click(within(choice).getByRole("button", { name: "邀请加入" }));
  expect(onInvite).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText("初始密码")).not.toBeInTheDocument();
});

it("protects typed account data on Escape while explicit cancellation discards it", async () => {
  setup(); await userEvent.click(screen.getByRole("button", { name: "添加成员" }));
  const dialog = screen.getByRole("dialog", { name: "添加成员" });
  await userEvent.type(within(dialog).getByLabelText("姓名"), "未保存姓名");
  await userEvent.keyboard("{Escape}");
  await userEvent.click(within(await screen.findByRole("dialog", { name: "放弃未保存的更改？" })).getByRole("button", { name: "继续编辑" }));
  expect(within(dialog).getByLabelText("姓名")).toHaveValue("未保存姓名");
  await userEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps pending counts independent of searchable paginated history and shows its decision maker", async () => {
  const state = { ...createPrototypeState(), activeRoleId: "admin" as const };
  const pending: RegistrationRoleRequest = { id: "pending", organizationId: "org", userId: "person", userName: "待处理申请", username: "pending.member", currentRoleId: "software-user", requestedRoleId: "software-committer", status: "pending", createdAt: "2026-10-24", decidedAt: null, decidedByUserId: null };
  const history = Array.from({ length: 12 }, (_, index) => ({ ...pending, id: `history-${index}`, userName: `History ${index}`, status: "approved" as const, decidedAt: "2026-10-24", decidedByUserId: state.currentUserId }));
  const listRegistrationRoleRequests = vi.fn(async (status = "pending") => status === "pending" ? [pending] : history);
  setup({ state, userGovernanceActions: createTestUserGovernanceActions({ listRegistrationRoleRequests }) });
  await userEvent.click(await screen.findByRole("tab", { name: /注册申请.*1/ }));
  await userEvent.click(screen.getByRole("radio", { name: "处理历史" }));
  const table = await screen.findByRole("table", { name: "注册申请历史" });
  expect(within(table).getAllByText(state.users.find((user) => user.id === state.currentUserId)!.name).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();
  await userEvent.type(screen.getByRole("searchbox", { name: "搜索处理历史" }), "History 11");
  expect(within(table).getByText("History 11")).toBeInTheDocument();
  expect(within(table).queryByText("History 0")).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /注册申请.*1/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "成员列表" }));
  expect(screen.getByText(/条注册角色申请待处理/)).toBeVisible();
});

it("resolves a linked member and keeps all mutation controls out of a read-only workspace", async () => {
  const base = createPrototypeState(), target = base.users[1];
  setup({ search: `?memberId=${target.id}`, readOnly: true });
  const dialog = screen.getByRole("dialog", { name: `${target.name} · 成员资料` });
  expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("tab", { name: "访问权限" }));
  expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  expect(screen.queryByRole("button", { name: "添加成员" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /：更多$/ })).not.toBeInTheDocument();
});

it("removes password reset for a protected platform account and an account without local credentials", async () => {
  const base = createPrototypeState();
  const state = { ...base, activeRoleId: "admin" as const, users: base.users.map((user, index) => {
    if (index === 1) return { ...user, roleId: "platform-admin" as const, roles: [{ projectId: null, roleId: "platform-admin" as const }] };
    if (index === 2) { const { username: _username, ...external } = user; return external; }
    return user;
  }) };
  setup({ state, userGovernanceActions: createTestUserGovernanceActions({ resetUserPassword: vi.fn() }) });
  for (const target of state.users.slice(1, 3)) {
    const row = screen.getByText(target.name).closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: /：更多$/ }));
    expect(screen.queryByRole("menuitem", { name: `重置 ${target.name} 的密码` })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
  }
});

it("ends the current session after successfully resetting the current account password", async () => {
  const base = createPrototypeState(), self = base.users.find((user) => user.id === base.currentUserId)!;
  const onCurrentAccountChanged = vi.fn(async () => undefined), resetUserPassword = vi.fn(async () => undefined);
  setup({ userGovernanceActions: createTestUserGovernanceActions({ resetUserPassword }), onCurrentAccountChanged });
  await userEvent.click(within(screen.getByText(self.name).closest("tr")!).getByRole("button", { name: /：更多$/ }));
  await userEvent.click(screen.getByRole("menuitem", { name: `重置 ${self.name} 的密码` }));
  const dialog = screen.getByRole("dialog", { name: "重置密码" });
  expect(dialog).toHaveTextContent("这是当前账号");
  await userEvent.type(within(dialog).getByLabelText("新密码", { exact: true }), "fixture-password");
  await userEvent.type(within(dialog).getByLabelText("确认新密码"), "fixture-password");
  await userEvent.click(within(dialog).getByRole("button", { name: "确认重置" }));
  expect(resetUserPassword).toHaveBeenCalledWith(self.id, "fixture-password");
  expect(onCurrentAccountChanged).toHaveBeenCalledWith(true);
});

it("uses the overview identity filter and lets an unmatched result be cleared", async () => {
  setup({ search: "?identity=pending" });
  expect(screen.getByRole("checkbox", { name: "等待身份系统同步" })).toBeChecked();
  expect(screen.getByText("没有符合筛选条件的用户，请调整搜索或筛选条件。")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "清除筛选条件" }));
  expect(screen.getByText("Xu Yun")).toBeVisible();
});
