import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { OrganizationWorkspace } from "./OrganizationWorkspace";
import { createPrototypeState } from "@/infrastructure/mock/prototypeState";
import type { AuthContextDto } from "@/infrastructure/http/authClient";
import { createOrganizationWorkspaceClient } from "@/infrastructure/http/userGovernanceClient";

const state = { ...createPrototypeState(), activeRoleId: "platform-admin" as const };
const actor: AuthContextDto = { user: { id: state.currentUserId, organizationId: "home", name: "Platform actor", title: "Administrator", isActive: true }, organization: { id: "home", name: "Home organization" }, roles: [{ projectId: null, roleId: "platform-admin" }], permissions: ["users:manage", "platform:access"] };
function response(body: unknown) { return new Response(JSON.stringify(body), { status: 200 }); }
afterEach(() => { vi.unstubAllGlobals(); });

describe("organization workspace target ownership", () => {
  it("shows editable target participants with their exact roles and inactive status", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("operating-scope")) return response({ actor, organization: { id: "target", name: "Target organization" } });
      expect(url.searchParams.get("organizationId")).toBe("target");
      if (url.pathname.endsWith("project-candidates")) return response({ items: [{ id: "project-one", name: "Target project" }, { id: "project-empty", name: "Empty project" }] });
      if (url.pathname === "/api/v1/projects/project-one/members") return response({ projectId: "project-one", members: [
        { userId: "editor", name: "Existing editor", username: "editor", title: "Engineer", isActive: true, roles: ["hardware-user", "software-committer"] },
        { userId: "inactive", name: "Inactive editor", username: null, title: "Engineer", isActive: false, roles: ["software-user"] }
      ] });
      if (url.pathname === "/api/v1/projects/project-empty/members") return response({ projectId: "project-empty", members: [] });
      throw new Error(`Unexpected request ${url.pathname}`);
    }));
    render(<OrganizationWorkspace state={state} dispatch={vi.fn()} onNavigate={vi.fn()} search="?organizationId=target" area="projects" workspaceClient={createOrganizationWorkspaceClient()} />);
    const table = await screen.findByRole("table", { name: "项目参与名单" });
    const editor = within(table).getByRole("row", { name: /Existing editor/ });
    expect(within(editor).getByText("硬件开发、软件MDE")).toBeInTheDocument();
    expect(within(editor).getByText("已启用")).toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "修改 Existing editor 的项目编辑角色" })).toBeEnabled();
    const inactive = within(table).getByRole("row", { name: /Inactive editor/ });
    expect(within(inactive).getByText("软件开发")).toBeInTheDocument();
    expect(within(inactive).getByText("已停用")).toBeInTheDocument();
    expect(within(inactive).getByRole("button", { name: "修改 Inactive editor 的项目编辑角色" })).toBeEnabled();
    await userEvent.click(screen.getByRole("combobox", { name: "选择项目" }));
    await userEvent.click(await screen.findByRole("option", { name: "Empty project" }));
    expect(await screen.findByText("暂无项目参与者")).toBeInTheDocument();
    expect(screen.queryByText("Existing editor")).not.toBeInTheDocument();
  });
  it("binds device governance and resource navigation to the visible target and ignores a prior target's late inventory", async () => {
    let completeOld!: (value: Response) => void;
    const bridge = (id: string) => ({ id, ownerUserId: `${id}-owner`, ownerName: `${id} owner`, machineLabel: `${id} PC`, platform: "linux", arch: "amd64", clientVersion: "1.0", createdAt: "2026-01-01T00:00:00Z", lastSeenAt: null, revokedAt: null, online: false });
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("operating-scope")) { const id = JSON.parse(String(init?.body)).organizationId; return response({ actor, organization: { id, name: `${id} organization` } }); }
      if (url.pathname === "/api/v1/device-bridges/organization") {
        if (url.searchParams.get("organizationId") === "old") return new Promise(resolve => { completeOld = resolve; });
        return response({ items: [bridge("current")] });
      }
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const onNavigate = vi.fn(), props = { state, dispatch: vi.fn(), onNavigate, area: "bridges" as const, workspaceClient: createOrganizationWorkspaceClient() };
    const view = render(<OrganizationWorkspace {...props} search="?organizationId=old" />);
    await vi.waitFor(() => expect(completeOld).toBeDefined());
    view.rerender(<OrganizationWorkspace {...props} search="?organizationId=current" />);
    expect(await screen.findByText("current PC")).toBeInTheDocument();
    await act(async () => completeOld(response({ items: [bridge("old")] })));
    expect(screen.queryByText("old PC")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "集成凭据" }));
    expect(onNavigate).toHaveBeenLastCalledWith("/organization/integrations?organizationId=current");
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("device-bridges/organization")).every(([input]) => new URL(String(input), "http://localhost").searchParams.has("organizationId"))).toBe(true);
  });

  it("fails closed when a legacy home-only connection receives an explicit target", () => {
    render(<OrganizationWorkspace state={state} dispatch={vi.fn()} onNavigate={vi.fn()} search="?organizationId=foreign" />);
    expect(screen.getByText("当前组织管理连接不支持切换组织。")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("显示名称")).not.toBeInTheDocument();
  });
  it("shows the target and home identity and keeps navigation explicitly scoped", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("operating-scope")) return response({ actor, organization: { id: "target", name: "Target organization" } });
      if (url.pathname === "/api/v1/organization") return response({ organization: { id: "target", name: "Target organization", createdAt: "2026-01-01T00:00:00Z" } });
      throw new Error(`Unexpected request ${url.pathname} ${init?.method}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const navigate = vi.fn();
    render(<OrganizationWorkspace state={state} dispatch={vi.fn()} onNavigate={navigate} search="?organizationId=target" area="profile" workspaceClient={createOrganizationWorkspaceClient()} />);
    const scope = await screen.findByRole("region", { name: "当前操作组织" });
    expect(within(scope).getByText("Target organization")).toBeInTheDocument();
    expect(within(scope).getByText("所属组织：Home organization")).toBeInTheDocument();
    expect(await screen.findByLabelText("显示名称")).toHaveValue("Target organization");
    await userEvent.click(screen.getByRole("button", { name: "成员与权限" }));
    expect(navigate).toHaveBeenLastCalledWith("/organization/members?organizationId=target");
    await userEvent.click(screen.getByRole("button", { name: "返回所属组织" }));
    expect(navigate).toHaveBeenLastCalledWith("/organization");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/organization?organizationId=target"))).toBe(true);
  });

  it("ignores a late entry response after changing target without hydrating the home shell", async () => {
    let completeOld!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("operating-scope")) {
        const target = JSON.parse(String(init?.body)).organizationId;
        if (target === "old") return new Promise((resolve) => { completeOld = resolve; });
        return response({ actor, organization: { id: target, name: "Current organization" } });
      }
      return response({ organization: { id: "current", name: "Current organization", createdAt: "2026-01-01T00:00:00Z" } });
    }));
    const dispatch = vi.fn(), props = { state, dispatch, onNavigate: vi.fn(), area: "profile" as const, workspaceClient: createOrganizationWorkspaceClient() };
    const view = render(<OrganizationWorkspace {...props} search="?organizationId=old" />);
    view.rerender(<OrganizationWorkspace {...props} search="?organizationId=current" />);
    expect(await screen.findByLabelText("显示名称")).toHaveValue("Current organization");
    await act(async () => { completeOld(response({ actor, organization: { id: "old", name: "Late old organization" } })); });
    expect(screen.getByLabelText("显示名称")).toHaveValue("Current organization");
    expect(screen.queryByText("Late old organization")).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
