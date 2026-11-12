import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/agent/XiaozeProvider", () => ({
  XiaozeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  XiaozeProactiveInsights: () => null
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: vi.fn()
}));
import { canAccessPage } from "./app/permissions";
import App from "./App";
import { appReducer } from "@/application/state/appState";
import { initialState } from "./mockData";
import { declarationsFor, readStylesheet } from "./test/cssAssertions";

const guestState = { ...initialState, activeRoleId: "guest" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("permission-aware routing", () => {
  it.each(["guest", "hardware-user", "admin"])("matches workflow sidebar entries to route permissions for %s", (roleId) => {
    window.history.replaceState(null, "", "/parameter-home");
    render(<App initialAppState={{ ...initialState, activeRoleId: roleId }} />);

    const sidebar = screen.getByRole("complementary", { name: "主导航侧边栏" });
    for (const [pageKey, label] of [["logs", "智能分析"], ["log-admin", "日志后台"], ["knowledge", "知识库"], ["knowledge-admin", "知识后台"]] as const) {
      expect(within(sidebar).queryByRole("link", { name: label }) !== null).toBe(canAccessPage(roleId, pageKey));
    }
    expect(sidebar.textContent?.includes("日志分析")).toBe(canAccessPage(roleId, "logs"));
    expect(sidebar.textContent?.includes("知识库")).toBe(canAccessPage(roleId, "knowledge"));
  });

  it.each([false, true])("hides organization management from Guest at compact height %s", async (compactHeight) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: compactHeight && query === "(max-height: 820px)", media: query,
      addEventListener: vi.fn(), removeEventListener: vi.fn()
    }));
    window.history.replaceState(null, "", "/parameter-home");

    render(<App initialAppState={guestState} />);

    const navigation = within(screen.getByRole("navigation", { name: /主导航|涓诲鑸?/ }));
    expect(navigation.getByRole("link", { name: "项目参数" })).toBeInTheDocument();
    expect(navigation.queryByRole("link", { name: /变更审阅|鍙傛暟瀹￠槄/ })).not.toBeInTheDocument();
    expect(navigation.queryByRole("link", { name: /参数调试|鍙傛暟璋冭瘯/ })).not.toBeInTheDocument();
    const sidebar = within(screen.getByRole("complementary", { name: "主导航侧边栏" }));
    expect(sidebar.queryByRole("link", { name: "组织管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开 组织管理" })).not.toBeInTheDocument();
    expect(sidebar.getByRole("button", { name: "问题反馈" })).toBeInTheDocument();
  });

  it.each(["guest", "hardware-user", "software-user", "hardware-committer", "software-committer"])("returns %s to the workbench from an old management address", async (activeRoleId) => {
    window.history.replaceState(null, "", "/user-permissions?organizationId=secret");
    const userGovernanceActions = {
      listUsers: vi.fn(), createUser: vi.fn(), updateOrganizationRoles: vi.fn(),
      setUserActive: vi.fn(), deleteUser: vi.fn(), listRegistrationRoleRequests: vi.fn()
    };
    render(<App initialAppState={{ ...initialState, activeRoleId }} userGovernanceActions={userGovernanceActions} />);

    await waitFor(() => expect(window.location.pathname).toBe("/parameter-home"));
    expect(window.location.search).toBe("");
    expect(screen.getByText("该页面不可访问，已返回工作台。")).toBeInTheDocument();
    expect(screen.queryByText("组织概览")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "用户权限" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "平台用户" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加成员" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "管理邀请" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "业务交接" })).not.toBeInTheDocument();
    for (const action of Object.values(userGovernanceActions)) expect(action).not.toHaveBeenCalled();
  });

  it.each([
    { label: "project-scoped administrator", roles: [{ projectId: "project-a", roleId: "admin" }], permissions: ["parameter:view"] },
    { label: "organization administrator without management permission", roles: [{ projectId: null, roleId: "admin" }], permissions: ["parameter:view"] }
  ])("does not expose management to an API $label", async ({ roles, permissions }) => {
    window.history.replaceState(null, "", "/organization/projects");
    const authClient = { getCurrentAuthContext: vi.fn(async () => ({
      user: { id: "project-admin", organizationId: "home", name: "Project Admin", title: "", isActive: true },
      organization: { id: "home", name: "Home" },
      roles, permissions,
      projectMemberships: [{ projectId: "project-a", roles: ["hardware-user" as const] }]
    })) };
    render(<App runtimeMode="api" initialAppState={initialState} authClient={authClient} />);

    await waitFor(() => expect(window.location.pathname).toBe("/parameter-home"));
    expect(screen.queryByRole("link", { name: "组织管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开 组织管理" })).not.toBeInTheDocument();
    expect(screen.queryByText("组织概览")).not.toBeInTheDocument();
  });

  it.each(["/organization", "/organization/resources", "/organization/settings", "/user-permissions/legacy"])("returns a guest from %s", async (path) => {
    window.history.replaceState(null, "", path);
    render(<App initialAppState={guestState} />);
    await waitFor(() => expect(window.location.pathname).toBe("/parameter-home"));
    expect(screen.queryByRole("navigation", { name: "组织管理范围" })).not.toBeInTheDocument();
  });

  it("removes the retired platform console utility entry for platform-admin", async () => {
    window.history.replaceState(null, "", "/parameter-home");

    render(<App initialAppState={{ ...initialState, activeRoleId: "platform-admin", currentUserId: "u-platform-admin" }} />);

    expect(screen.queryByRole("link", { name: "平台控制台" })).not.toBeInTheDocument();
  });

  it("lets Admin see the shared user permissions utility entry", async () => {
    window.history.replaceState(null, "", "/parameter-home");

    render(<App initialAppState={{ ...initialState, activeRoleId: "admin" }} />);

    const settingsEntry = await screen.findByRole("button", { name: /^打开 组织管理$/ });
    expect(settingsEntry).toBeInTheDocument();

    fireEvent.click(settingsEntry);

    await waitFor(() => {
      expect(document.querySelector(".topbar-title")).toHaveTextContent("组织概览");
    });
  });

  it.each(["admin", "platform-admin"])("uses one organization utility entry for %s", (activeRoleId) => {
    window.history.replaceState(null, "", "/parameter-home");
    render(<App initialAppState={{ ...initialState, activeRoleId }} />);

    const sidebar = within(screen.getByRole("complementary", { name: "主导航侧边栏" }));
    expect(sidebar.queryByRole("link", { name: "组织目录" })).not.toBeInTheDocument();
    const organization = sidebar.getByRole("link", { name: "组织管理" });
    expect(organization).toHaveAttribute("href", activeRoleId === "platform-admin" ? "/platform/organizations" : "/organization");
    fireEvent.click(organization);
    expect(window.location.pathname).toBe(activeRoleId === "platform-admin" ? "/platform/organizations" : "/organization");
    expect(sidebar.getByRole("link", { name: "组织管理" })).toHaveClass("active");
  });

  it("filters personal workbench entries by role", async () => {
    const renderRole = (activeRoleId: string) => {
      cleanup();
      window.history.replaceState(null, "", "/parameter-home");
      render(<App initialAppState={{ ...initialState, activeRoleId }} />);
    };

    renderRole("guest");

    expect(await screen.findByRole("region", { name: "主要功能" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开 处理审阅/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开 管理后台/ })).not.toBeInTheDocument();

    renderRole("hardware-user");

    expect(await screen.findByRole("button", { name: /打开 修改参数/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开 管理后台/ })).not.toBeInTheDocument();

    renderRole("hardware-committer");

    expect(await screen.findByRole("button", { name: /打开 处理审阅/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开 管理后台/ })).not.toBeInTheDocument();

    renderRole("admin");

    expect(await screen.findByRole("button", { name: /打开 管理后台/ })).toBeInTheDocument();
  });

  it("prevents Guest from mutating parameter values in the reducer", () => {
    const next = appReducer(guestState, {
      type: "ADD_PARAMETER_SUBMISSION_ROUND",
      items: [{ parameterId: guestState.parameters[0].id, targetValue: "123", reason: "guest attempt" }]
    });

    expect(next).toBe(guestState);
  });

  it("shows permission denied when Guest opens an Admin URL directly", () => {
    window.history.replaceState(null, "", "/log-admin");

    render(<App initialAppState={guestState} />);

    expect(screen.getByRole("heading", { name: "无权访问该页面" })).toBeInTheDocument();
    expect(screen.getByText(/当前角色：访客/)).toBeInTheDocument();
    expect(screen.getByText(/所需角色：管理员/)).toBeInTheDocument();
  });

  it("does not render WiseAgent or Xiaoze on permission denied pages", () => {
    window.history.replaceState(null, "", "/debugging-admin");

    render(<App initialAppState={{ ...initialState, activeRoleId: "user" }} runtimeMode="mock" />);

    expect(screen.getByRole("heading", { name: "无权访问该页面" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开 WiseAgent" })).not.toBeInTheDocument();
    expect(document.querySelector(".xiaoze-chat-toggle-anchor")).not.toBeInTheDocument();
  });

  it("uses a stable permission denied layout", () => {
    window.history.replaceState(null, "", "/debugging-admin");

    render(<App initialAppState={guestState} />);

    expect(document.querySelector(".permission-denied-page")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回可访问的工作台" })).toHaveClass("permission-denied-action");
  });

  it("keeps the permission denied action from rendering as text-only", () => {
    const css = readStylesheet("src/styles.css");
    const actionStyles = declarationsFor(css, ".permission-denied-page .permission-denied-action");
    const primaryStyles = declarationsFor(css, ".permission-denied-page .permission-denied-action.primary");
    expect(actionStyles["border-radius"]).toBe("var(--radius-md)");
    expect(primaryStyles.background).toBe("var(--app-primary)");
    expect(primaryStyles.color).toBe("var(--primary-foreground)");
  });
});

describe("permission route matrix", () => {
  it("keeps User out of organization management and review and admin pages", () => {
    expect(canAccessPage("user", "parameter-review")).toBe(false);
    expect(canAccessPage("software-user", "parameter-review")).toBe(true);
    expect(canAccessPage("user", "parameter-admin")).toBe(false);
    expect(canAccessPage("user", "log-admin")).toBe(false);
    expect(canAccessPage("user", "debugging-admin")).toBe(false);
    expect(canAccessPage("user", "user-permissions")).toBe(false);
    expect(canAccessPage("user", "logs")).toBe(true);
    expect(canAccessPage("user", "debugging")).toBe(true);
  });

  it("lets Committer review while keeping organization management and admin pages restricted", () => {
    expect(canAccessPage("committer", "parameter-review")).toBe(true);
    expect(canAccessPage("committer", "parameter-admin")).toBe(false);
    expect(canAccessPage("committer", "log-admin")).toBe(false);
    expect(canAccessPage("committer", "debugging-admin")).toBe(false);
    expect(canAccessPage("committer", "user-permissions")).toBe(false);
  });
});
