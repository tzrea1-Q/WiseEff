import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createAuthClient } from "@/infrastructure/http/authClient";
import { createPlatformOrganizationsClient, type OrganizationErasure, type PlatformOrganization } from "@/infrastructure/http/platformOrganizationsClient";
import { OrganizationProjectsPanel, type ProjectMembershipClient } from "./OrganizationProjectsPanel";
import { OrganizationProjectBulkGrants } from "./OrganizationProjectBulkGrants";
import { OrganizationAssetHandoverPanel } from "./OrganizationAssetHandoverPanel";
import { OrganizationProjectHandoverPanel } from "./OrganizationProjectHandoverPanel";
import { PlatformOrganizationsPage } from "./PlatformOrganizationsPage";
import { OrganizationAdministratorControls } from "./OrganizationAdministratorControls";
import { OrganizationErasureDialog } from "./OrganizationErasureDialog";
import { ExperienceRegistrationSettings } from "./ExperienceRegistrationSettings";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const organization: PlatformOrganization = { id: "target", name: "目标组织", status: "active", createdAt: "2026-10-01T00:00:00Z", administrators: [{ id: "admin", name: "管理员", isActive: true, canLogin: true }] };
const authentication = { provider: "local" as const, selfRegisterEnabled: false, hasLocalAdmin: true, evaluationOrganizationName: null };
const person = { id: "alice", name: "Alice", title: "工程师", roleId: "software-user" as const, roles: [], isActive: true, createdAt: "2026-10-01", lastActive: "never" };
function projectClient(): ProjectMembershipClient {
  return { listProjectCandidates: vi.fn().mockResolvedValue([{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }]), getProjectMembers: vi.fn().mockResolvedValue({ projectId: "beta", members: [] }),
    listUsers: vi.fn().mockResolvedValue([person]), listTeams: vi.fn().mockResolvedValue([]), updateProjectMember: vi.fn().mockResolvedValue({ projectId: "beta", members: [] }) };
}

it("restores the URL project, preserves the organization and supports browser history changes", async () => {
  const client = projectClient(), onNavigate = vi.fn();
  const view = render(<OrganizationProjectsPanel client={client} search="?organizationId=target&projectId=beta&keep=yes" organizationId="target" onNavigate={onNavigate} />);
  await waitFor(() => expect(client.getProjectMembers).toHaveBeenLastCalledWith("beta"));
  expect(client.getProjectMembers).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("combobox", { name: "选择项目" })).toHaveTextContent("Beta");
  await userEvent.click(screen.getByRole("combobox", { name: "选择项目" }));
  await userEvent.click(screen.getByRole("option", { name: "Alpha" }));
  expect(onNavigate).toHaveBeenCalledWith("/organization/projects?organizationId=target&projectId=alpha&keep=yes");
  view.rerender(<OrganizationProjectsPanel client={client} search="?organizationId=target&projectId=beta" organizationId="target" onNavigate={onNavigate} />);
  await waitFor(() => expect(client.getProjectMembers).toHaveBeenLastCalledWith("beta"));
  expect(screen.getByRole("combobox", { name: "选择项目" })).toHaveTextContent("Beta");
});

it("shows the project, participant label and fixed creation action before a draft exists", async () => {
  const client = projectClient();
  render(<OrganizationProjectsPanel client={client} search="?projectId=beta" />);
  await userEvent.click(await screen.findByRole("button", { name: "添加参与者" }));
  const dialog = screen.getByRole("dialog", { name: "配置项目参与者" });
  expect(within(dialog).getByText("项目：Beta")).toBeInTheDocument();
  expect(within(dialog).getByText("参与成员")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "添加参与者" })).toBeDisabled();
  expect(within(dialog).queryByRole("button", { name: "移除项目编辑角色" })).not.toBeInTheDocument();
  await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "选择参与成员" })).toBeEnabled());
  await userEvent.click(within(dialog).getByRole("combobox", { name: "选择参与成员" }));
  await userEvent.click(screen.getByRole("option", { name: "Alice" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "项目编辑角色" }));
  await userEvent.click(await screen.findByRole("checkbox", { name: "软件开发" }));
  await userEvent.keyboard("{Escape}");
  await userEvent.click(within(dialog).getByRole("button", { name: "添加参与者" }));
  await waitFor(() => expect(client.updateProjectMember).toHaveBeenCalledWith("beta", "alice", { roles: ["software-user"], expectedRoles: [] }));
});

it("shows project participation without write controls in read-only mode", async () => {
  const client = projectClient();
  render(<OrganizationProjectsPanel client={client} readOnly />);
  await screen.findByText("暂无项目参与者");
  expect(screen.queryByRole("button", { name: "添加参与者" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "批量授予项目角色" })).not.toBeInTheDocument();
});

it("allows direct member selection when no teams exist", async () => {
  const client = projectClient();
  render(<OrganizationProjectBulkGrants client={client} projectId="beta" projectName="Beta" onUpdated={vi.fn()} onClose={vi.fn()} />);
  await screen.findByRole("combobox", { name: "选择来源团队" });
  await userEvent.click(screen.getByRole("button", { name: "选择实际授权成员" }));
  expect(screen.getByRole("checkbox", { name: /Alice/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("checkbox", { name: /Alice/ }));
  await userEvent.keyboard("{Escape}");
  await userEvent.click(screen.getByRole("button", { name: "授予项目编辑角色" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "软件开发" }));
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "预览授权" })).toBeEnabled();
});

it("keeps feedback work available when the knowledge handover service fails", async () => {
  let failKnowledge = true;
  const fetcher = vi.fn<typeof fetch>(async input => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path.includes("knowledge/handovers") && failKnowledge) return new Response(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "知识清单暂不可用" } }), { status: 503 });
    return new Response(JSON.stringify(path.includes("product-feedback/handovers") ? { items: [{ id: "feedback", kind: "feedback-draft", title: "待交接反馈", responsibleUserId: null, responsibleUserName: null, pending: true }], candidates: [] } : { items: [], candidates: [] }));
  });
  vi.stubGlobal("fetch", fetcher);
  render(<OrganizationAssetHandoverPanel enabled currentUserId="admin" onNavigate={vi.fn()} />);
  expect(await screen.findByText("知识清单暂不可用")).toBeInTheDocument();
  expect(await screen.findByRole("table", { name: "反馈业务交接" })).toHaveTextContent("待交接反馈");
  failKnowledge = false;
  await userEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(screen.queryByText("知识清单暂不可用")).not.toBeInTheDocument());
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes("product-feedback/handovers"))).toHaveLength(1);
});

it("combines all three empty handover groups into a single empty state", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ items: [], candidates: [] }))));
  render(<OrganizationAssetHandoverPanel enabled currentUserId="admin" onNavigate={vi.fn()} />);
  expect(await screen.findByText("暂无待交接事项")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByText("交接规则").closest("details")).not.toHaveAttribute("open");
});

it("offers a single assignment action for a non-draft project handover", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ items: [{ id: "review", kind: "hardware-review", projectId: "beta", projectName: "Beta", title: "审核任务", responsibleUserId: null, responsibleUserName: null, pending: true, version: "1", historicalAttribution: { actors: {} }, candidates: [] }] }))));
  render(<OrganizationProjectHandoverPanel currentUserId="admin" pendingOnly onNavigate={vi.fn()} refreshSignal={0} />);
  await screen.findByRole("button", { name: "指派处理人" });
  await userEvent.click(screen.getByRole("button", { name: "审核任务：更多" }));
  expect(screen.queryByRole("menuitem", { name: "指定接任者" })).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "打开项目业务" })).toBeInTheDocument();
});

it("keeps the directory and direct entry usable when authentication metadata fails", async () => {
  const client = { ...createPlatformOrganizationsClient(), list: vi.fn().mockResolvedValue([organization]) }, onNavigate = vi.fn();
  const authClient = { ...createAuthClient(), getLocalAuthConfig: vi.fn().mockRejectedValue(new Error("登录配置暂不可用")) };
  render(<PlatformOrganizationsPage client={client} authClient={authClient} onNavigate={onNavigate} />);
  expect(await screen.findByRole("table", { name: "平台组织目录" })).toHaveTextContent("目标组织");
  expect(screen.getByRole("alert")).toHaveTextContent("登录配置暂不可用");
  expect(screen.getByRole("button", { name: "创建组织" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "进入组织" }));
  expect(onNavigate).toHaveBeenCalledWith("/organization?organizationId=target");
});

it("keeps emergency administrator controls collapsed and names additive grants accurately", async () => {
  const client = { ...createPlatformOrganizationsClient(), getAdministratorRecovery: vi.fn().mockResolvedValue({ members: [{ id: "alice", name: "Alice", isActive: true }], usableAdministratorIds: ["admin"] }) };
  render(<OrganizationAdministratorControls organization={organization} authentication={authentication} client={client} onUpdated={vi.fn()} onPendingChange={vi.fn()} />);
  await screen.findByRole("button", { name: "增授管理员角色" });
  expect(screen.getByText("紧急停用管理员")).not.toBeVisible();
  await userEvent.click(screen.getByText("紧急操作"));
  expect(screen.getByRole("button", { name: "紧急停用管理员" })).toBeVisible();
});

it("keeps emergency disable available when login configuration cannot be read", async () => {
  const client = { ...createPlatformOrganizationsClient(), getAdministratorRecovery: vi.fn().mockResolvedValue({ members: [], usableAdministratorIds: ["admin"] }), emergencyDisableAdministrator: vi.fn().mockResolvedValue(organization) };
  render(<OrganizationAdministratorControls organization={organization} authentication={null} client={client} onUpdated={vi.fn()} onPendingChange={vi.fn()} />);
  expect(await screen.findByRole("button", { name: "增授管理员角色" })).toBeDisabled();
  await userEvent.click(screen.getByText("紧急操作"));
  await userEvent.click(screen.getByRole("button", { name: "紧急停用管理员" }));
  await userEvent.click(screen.getByRole("combobox", { name: "紧急停用的管理员" }));
  await userEvent.click(screen.getByRole("option", { name: "管理员" }));
  await userEvent.type(screen.getByRole("textbox", { name: "紧急停用原因" }), "管理员离职");
  await userEvent.click(screen.getByRole("button", { name: "确认紧急停用" }));
  await waitFor(() => expect(client.emergencyDisableAdministrator).toHaveBeenCalledWith("target", "admin", "管理员离职"));
});

it("does not retry a running cleanup and keeps a failed retry beside its own record", async () => {
  const record: OrganizationErasure = { id: "running", targetOrganizationId: "running-org", actorUserId: "admin", status: "running", stage: "domains", counts: {}, domains: {}, attempts: 1, errorCode: null, createdAt: "2026-10-01", updatedAt: "2026-10-01", completedAt: null };
  const client = { listErasures: vi.fn().mockResolvedValue([record, { ...record, id: "failed", targetOrganizationId: "failed-org", status: "failed" }]), startErasure: vi.fn(), retryErasure: vi.fn().mockRejectedValue(new Error("任务尚未就绪，请刷新进度。")) };
  render(<OrganizationErasureDialog client={client} onClose={vi.fn()} onUpdated={vi.fn()} />);
  const running = await screen.findByRole("region", { name: "组织 running-org 清理" });
  expect(within(running).queryByRole("button", { name: "继续清理" })).not.toBeInTheDocument();
  const failed = screen.getByRole("region", { name: "组织 failed-org 清理" });
  await userEvent.click(within(failed).getByRole("button", { name: "继续清理" }));
  expect(await within(failed).findByRole("alert")).toHaveTextContent("任务尚未就绪，请刷新进度。");
  expect(screen.getByRole("region", { name: "组织 running-org 清理" })).toBeInTheDocument();
  expect(client.retryErasure).toHaveBeenCalledWith("failed");
});

it("saves experience registration only when changed and prevents choosing a suspended organization", async () => {
  const settings = { enabled: false, available: false, organizationId: "target", organizationName: "目标组织", source: "platform" as const };
  const client = { ...createPlatformOrganizationsClient(), list: vi.fn().mockResolvedValue([organization, { ...organization, id: "suspended", name: "停用组织", status: "suspended" }]),
    getExperienceRegistration: vi.fn().mockResolvedValue(settings), updateExperienceRegistration: vi.fn().mockImplementation(async (payload) => ({ ...settings, ...payload, available: payload.enabled })) };
  render(<ExperienceRegistrationSettings client={client} local onClose={vi.fn()} />);
  const save = await screen.findByRole("button", { name: "保存设置" });
  await waitFor(() => expect(screen.queryByText("正在加载体验注册设置")).not.toBeInTheDocument());
  expect(save).toBeDisabled();
  await userEvent.click(screen.getByRole("combobox", { name: "体验目标组织" }));
  expect(screen.getByRole("option", { name: "停用组织（不可接纳新成员）" })).toHaveAttribute("data-disabled");
  await userEvent.keyboard("{Escape}");
  await userEvent.click(screen.getByRole("checkbox", { name: "开启公开体验注册" }));
  expect(save).toBeEnabled();
  await userEvent.click(save);
  expect(await screen.findByText("体验注册设置已保存。")).toBeInTheDocument();
  expect(client.updateExperienceRegistration).toHaveBeenCalledWith({ enabled: true, organizationId: "target" });
  expect(save).toBeDisabled();
});
