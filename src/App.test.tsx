import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/agent/XiaozeProvider", () => ({
  XiaozeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  XiaozeProactiveInsights: () => null
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: vi.fn()
}));

import { existsSync, readFileSync } from "node:fs";
import App, { appReducer } from "./App";
import { initialState } from "./mockData";
import type { DebuggingGateway } from "@/application/ports/DebuggingGateway";
import type { LogAnalysisRepository } from "@/application/ports/LogAnalysisRepository";
import type { ParameterRepository } from "@/application/ports/ParameterRepository";
import { createDebuggingAdminClient } from "@/infrastructure/http/debuggingAdminClient";
import type { UserGovernanceActions } from "@/UserPermissionsPage";

const userState = { ...initialState, activeRoleId: "user", changeRequests: [] };
const committerState = { ...initialState, activeRoleId: "committer" };
const adminState = { ...initialState, activeRoleId: "admin" };
const apiParameter = {
  ...initialState.parameters[0],
  id: `${initialState.activeProjectId}-api-runtime-param`,
  projectId: initialState.activeProjectId,
  name: "api_runtime_voltage_limit"
};
const apiProject = {
  id: initialState.activeProjectId,
  name: "API Runtime Project",
  code: "API-RUN"
};
const apiDebugDevice = {
  id: "api-debug-device",
  name: "API Debug Device",
  projectId: initialState.activeProjectId,
  firmware: "v1.0.0",
  status: "online" as const,
  lastSeenAt: "2026-05-25T08:00:00.000Z"
};
const apiDebugParameter = {
  ...initialState.debugParameters[0],
  id: "api-debug-param",
  name: "api_debug_runtime_parameter",
  projectId: initialState.activeProjectId
};

function createAppParameterRepository(overrides: Partial<ParameterRepository> = {}): ParameterRepository {
  return {
    listProjects: vi.fn().mockResolvedValue([apiProject]),
    listParameters: vi.fn().mockResolvedValue([apiParameter]),
    getParameter: vi.fn().mockResolvedValue(apiParameter),
    listParameterHistory: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
    saveDraft: vi.fn().mockResolvedValue({
      id: "draft-api-runtime",
      projectId: initialState.activeProjectId,
      parameterId: apiParameter.id,
      targetValue: "42",
      reason: "Tune value",
      updatedAt: "2026-05-25T08:00:00.000Z"
    }),
    deleteDraft: vi.fn().mockResolvedValue(undefined),
    listChangeRequests: vi.fn().mockResolvedValue([]),
    listSubmissionRounds: vi.fn().mockResolvedValue([]),
    submitParameterChanges: vi.fn().mockResolvedValue({ ...initialState.parameterSubmissionRounds[0], id: "api-runtime-round" }),
    withdrawSubmissionRound: vi.fn().mockResolvedValue({ ...initialState.parameterSubmissionRounds[0], id: "api-runtime-round", status: "已撤回" }),
    reviewChange: vi.fn().mockResolvedValue({ ...initialState.changeRequests[0], id: "api-runtime-change" }),
    createImportPreview: vi.fn().mockResolvedValue({
      id: "api-runtime-batch",
      projectId: initialState.activeProjectId,
      sourceName: "import.csv",
      status: "previewed",
      createdAt: "2026-05-25T08:00:00.000Z",
      summary: { added: 0, updated: 0, unchanged: 0, conflict: 0, highRisk: 0 },
      items: []
    }),
    applyImportBatch: vi.fn().mockResolvedValue({
      id: "api-runtime-batch",
      projectId: initialState.activeProjectId,
      sourceName: "import.csv",
      status: "applied",
      createdAt: "2026-05-25T08:00:00.000Z",
      appliedAt: "2026-05-25T08:01:00.000Z",
      summary: { added: 0, updated: 0, unchanged: 0, conflict: 0, highRisk: 0 },
      items: []
    }),
    ...overrides
  };
}

function createAppDebuggingGateway(overrides: Partial<DebuggingGateway> = {}): DebuggingGateway {
  return {
    listDevices: vi.fn().mockResolvedValue([apiDebugDevice]),
    listParameters: vi.fn().mockResolvedValue([apiDebugParameter]),
    detectTargets: vi.fn().mockResolvedValue([]),
    readNode: vi.fn().mockResolvedValue({ ok: true }),
    writeNode: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides
  };
}

function createAppDebuggingAdminApiMock() {
  const seedNode = {
    id: "node-1",
    projectId: "aurora",
    name: "Fast charge current",
    description: "Node",
    module: "Battery",
    enabled: true,
    bindings: [{ protocol: "hdc", nodePath: "/sys/hdc/current", accessMode: "RW", enabled: true }]
  };

  return {
    seedNode,
    get: vi.fn().mockResolvedValue({ items: [seedNode] }),
    post: vi.fn().mockResolvedValue({ item: seedNode }),
    patch: vi.fn().mockResolvedValue({ item: seedNode }),
    put: vi.fn()
  };
}

function createAppLogAnalysisRepository(overrides: Partial<LogAnalysisRepository> = {}): LogAnalysisRepository {
  return {
    listLogs: vi.fn().mockResolvedValue([]),
    getLog: vi.fn().mockResolvedValue(null),
    uploadLog: vi.fn(),
    getJob: vi.fn(),
    rerunLog: vi.fn(),
    archiveLog: vi.fn(),
    unarchiveLog: vi.fn(),
    submitFeedback: vi.fn(),
    ...overrides
  };
}

function createResolvedAuthClient() {
  return {
    getCurrentAuthContext: vi.fn(async () => ({
      user: {
        id: "u-api-user",
        organizationId: "org-chargelab",
        name: "API User",
        email: "api-user@chargelab.cn",
        title: "API Parameter User",
        isActive: true
      },
      organization: { id: "org-chargelab", name: "ChargeLab" },
      roles: [{ projectId: null, roleId: "user" }],
      permissions: ["parameter:edit"]
    }))
  };
}

function createResolvedAdminAuthClient() {
  return {
    getCurrentAuthContext: vi.fn(async () => ({
      user: {
        id: "u-api-admin",
        organizationId: "org-chargelab",
        name: "API Admin",
        email: "api-admin@chargelab.cn",
        title: "API Platform Owner",
        isActive: true
      },
      organization: { id: "org-chargelab", name: "ChargeLab" },
      roles: [{ projectId: null, roleId: "admin" }],
      permissions: ["admin:access", "users:manage", "debugging:admin", "debugging:view"]
    }))
  };
}

type TestUserGovernanceActions = UserGovernanceActions & {
  listUsers: ReturnType<typeof vi.fn>;
};

function createUserGovernanceActions(overrides: Partial<TestUserGovernanceActions> = {}): TestUserGovernanceActions {
  return {
    listUsers: vi.fn().mockResolvedValue(adminState.users),
    createUser: vi.fn().mockResolvedValue(undefined),
    assignUserRole: vi.fn().mockResolvedValue(undefined),
    setUserActive: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.removeItem("wiseeff.sidebar.collapsed");
  window.history.replaceState(null, "", "/");
});

function expectSelectValue(trigger: HTMLElement, value: string) {
  if (trigger instanceof HTMLSelectElement) {
    expect(trigger).toHaveValue(value);
    return;
  }

  expect(trigger).toHaveAttribute("data-value", value);
}

function changeSelectValue(trigger: HTMLElement, optionName: string | RegExp) {
  if (trigger instanceof HTMLSelectElement) {
    const option = Array.from(trigger.options).find((item) =>
      typeof optionName === "string" ? item.textContent === optionName || item.value === optionName : optionName.test(item.textContent ?? "")
    );

    expect(option).toBeDefined();
    fireEvent.change(trigger, { target: { value: option?.value } });
    return;
  }

  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

function readCssBlock(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

function findTableRowByText(text: string) {
  return Array.from(screen.getByRole("table").querySelectorAll<HTMLTableRowElement>("tbody tr")).find((row) =>
    row.textContent?.includes(text)
  ) as HTMLTableRowElement | undefined;
}

function stateForCurrentPath() {
  switch (window.location.pathname) {
    case "/parameter-review":
      return committerState;
    case "/parameter-admin":
    case "/parameter-admin/projects":
    case "/log-admin":
    case "/debugging-admin":
      return adminState;
    case "/logs":
    case "/log-dashboard":
    case "/debugging":
    case "/node-debugging":
    case "/parameter-submissions":
      return userState;
    default:
      return initialState;
  }
}

function renderAppForCurrentPath() {
  return render(<App initialAppState={stateForCurrentPath()} />);
}

describe("WiseEff app shell", () => {
  it("declares the WiseEff favicon assets in the document shell", () => {
    const indexHtml = readFileSync("index.html", "utf8");

    expect(indexHtml).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(indexHtml).toContain('<link rel="apple-touch-icon" href="/wiseeff-icon.svg" />');
    expect(indexHtml).toContain('<meta name="theme-color" content="#003D9B" />');
    expect(existsSync("public/favicon.svg")).toBe(true);
    expect(existsSync("public/wiseeff-icon.svg")).toBe(true);

    const favicon = readFileSync("public/favicon.svg", "utf8");
    const fullIcon = readFileSync("public/wiseeff-icon.svg", "utf8");

    expect(favicon).toContain('aria-label="雷泽 favicon"');
    expect(favicon).toContain("#003D9B");
    expect(favicon).toContain('stroke-linecap="round"');
    expect(favicon).not.toContain("wiseeff-icon-spark");

    expect(fullIcon).toContain('aria-label="雷泽闪电水泽图标"');
    expect(fullIcon).toContain("wiseeff-icon-bolt");
    expect(fullIcon).toContain("wiseeff-icon-marsh-wave-tertiary");
    expect(fullIcon).toContain("#50DCFF");
  });

  it("does not render WiseAgent FAB in api mode", () => {
    window.history.replaceState(null, "", "/parameters");

    render(<App authClient={createResolvedAuthClient()} runtimeMode="api" />);

    expect(screen.queryByLabelText("打开 WiseAgent")).not.toBeInTheDocument();
  });

  it("does not render Xiaoze or WiseAgent controls in mock mode", () => {
    render(<App initialAppState={userState} runtimeMode="mock" />);

    expect(screen.queryByLabelText("打开 WiseAgent")).not.toBeInTheDocument();
    expect(document.querySelector(".xiaoze-chat-toggle-anchor")).not.toBeInTheDocument();
  });

  it("renders the WiseEff platform homepage on the home route", () => {
    window.history.replaceState(null, "", "/");

    renderAppForCurrentPath();

    const homeRoot = document.querySelector(".linear-template-home");
    expect(screen.getByRole("main", { name: "雷泽首页" })).toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(homeRoot).toBeInTheDocument();
    expect(homeRoot).toHaveClass("light-homepage");
    expect(homeRoot).toHaveAttribute("data-theme", "light");
    expect(homeRoot?.querySelector(".linear-logo-link .wiseeff-icon")).toBeInTheDocument();
    expect(homeRoot?.querySelector(".linear-logo-link .wiseeff-icon-bolt")).toBeInTheDocument();
    expect(homeRoot?.querySelector(".linear-logo-link .wiseeff-icon-marsh-wave-secondary")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "让业务流程更智能、更高效、更可控" })).toBeInTheDocument();
    expect(screen.queryByText("智能参数管理")).not.toBeInTheDocument();
    expect(document.querySelector(".topbar")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("打开 WiseAgent")).not.toBeInTheDocument();
  });

  it("hydrates the active user and role from the API auth context", async () => {
    window.history.replaceState(null, "", "/parameter-home");

    render(
      <App
        authClient={{
          getCurrentAuthContext: async () => ({
            user: {
              id: "u-api-admin",
              organizationId: "org-chargelab",
              name: "API Admin",
              email: "api-admin@chargelab.cn",
              title: "API Platform Owner",
              isActive: true
            },
            organization: { id: "org-chargelab", name: "ChargeLab" },
            roles: [{ projectId: null, roleId: "admin" }],
            permissions: ["admin:access"]
          })
        }}
        initialAppState={initialState}
        parameterRepository={createAppParameterRepository()}
        runtimeMode="api"
      />
    );

    expect(await screen.findByText("API Admin")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("shows local login when API auth context is unauthenticated and enters the app after login", async () => {
    window.history.replaceState(null, "", "/parameter-home");
    const authClient = {
      getCurrentAuthContext: vi.fn().mockRejectedValue(new Error("Session is not active.")),
      login: vi.fn(async () => ({
        token: "we_local_test",
        expiresAt: "2026-06-19T00:00:00.000Z",
        auth: {
          user: {
            id: "u-local",
            organizationId: "org-local",
            name: "Local Admin",
            username: "local.admin",
            title: "Owner",
            isActive: true
          },
          organization: { id: "org-local", name: "Local Org" },
          roles: [{ projectId: null, roleId: "admin" }],
          permissions: ["admin:access", "users:manage"]
        }
      }))
    };

    render(<App authClient={authClient} initialAppState={initialState} parameterRepository={createAppParameterRepository()} runtimeMode="api" />);

    expect(await screen.findByRole("heading", { name: "登录雷泽" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "local.admin" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "strong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("Local Admin")).toBeInTheDocument();
    expect(authClient.login).toHaveBeenCalledWith({ username: "local.admin", password: "strong-password" });
  });

  it("registers a local user account from the auth screen", async () => {
    window.history.replaceState(null, "", "/parameter-home");
    const authClient = {
      getCurrentAuthContext: vi.fn().mockRejectedValue(new Error("Authorization bearer token is required.")),
      register: vi.fn(async () => ({
        token: "we_local_registered",
        expiresAt: "2026-06-19T00:00:00.000Z",
        auth: {
          user: {
            id: "u-new-admin",
            organizationId: "org-new",
            name: "New Admin",
            username: "new.admin",
            title: "software-user",
            isActive: true
          },
          organization: { id: "org-new", name: "软件部" },
          roles: [{ projectId: null, roleId: "software-user" }],
          permissions: ["parameter:edit"]
        }
      }))
    };

    render(<App authClient={authClient} initialAppState={initialState} parameterRepository={createAppParameterRepository()} runtimeMode="api" />);

    fireEvent.click(await screen.findByRole("tab", { name: "注册" }));
    changeSelectValue(screen.getByRole("combobox", { name: "组织" }), "软件部");
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "New Admin" } });
    changeSelectValue(screen.getByRole("combobox", { name: "角色" }), "Software User");
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "new.admin" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "strong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "注册" }));

    expect(await screen.findByText("New Admin")).toBeInTheDocument();
    expect(await screen.findByText("Software User")).toBeInTheDocument();
    expect(authClient.register).toHaveBeenCalledWith({
      organization: "软件部",
      name: "New Admin",
      username: "new.admin",
      roleId: "software-user",
      password: "strong-password"
    });
  });

  it("keeps committer self-registration on the auth screen while approval is pending", async () => {
    window.history.replaceState(null, "", "/parameter-home");
    const parameterRepository = createAppParameterRepository();
    const authClient = {
      getCurrentAuthContext: vi.fn().mockRejectedValue(new Error("Authorization bearer token is required.")),
      register: vi.fn(async () => ({
        status: "pending_approval" as const,
        user: {
          id: "u-new-committer",
          organizationId: "org-chargelab",
          name: "New Committer",
          username: "new.committer",
          title: "hardware-user",
          isActive: false
        },
        organization: { id: "org-chargelab", name: "ChargeLab" },
        requestedRoleId: "hardware-committer",
        assignedRoleId: "hardware-user"
      }))
    };

    render(<App authClient={authClient} initialAppState={initialState} parameterRepository={parameterRepository} runtimeMode="api" />);

    fireEvent.click(await screen.findByRole("tab", { name: "注册" }));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "New Committer" } });
    changeSelectValue(screen.getByRole("combobox", { name: "角色" }), "Hardware Committer");
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "new.committer" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "strong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "注册" }));

    const pendingNotice = (await screen.findByRole("heading", { name: "注册申请已提交" })).closest("section");
    expect(pendingNotice).not.toBeNull();
    expect(within(pendingNotice as HTMLElement).getAllByText(/Hardware Committer/).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "注册雷泽" })).toBeInTheDocument();
    expect(screen.queryByLabelText("组织")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("姓名")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("角色")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("用户名")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("密码")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "注册" })).not.toBeInTheDocument();
    expect(screen.queryByText("New Committer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开用户菜单" })).not.toBeInTheDocument();
    expect(parameterRepository.listProjects).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "登录" }));
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
    expect(authClient.register).toHaveBeenCalledWith({
      organization: "硬件部",
      name: "New Committer",
      username: "new.committer",
      roleId: "hardware-committer",
      password: "strong-password"
    });
  });

  it("does not offer Admin as a self-service registration role", async () => {
    window.history.replaceState(null, "", "/parameter-home");
    const authClient = {
      getCurrentAuthContext: vi.fn().mockRejectedValue(new Error("Authorization bearer token is required.")),
      register: vi.fn()
    };

    render(<App authClient={authClient} initialAppState={initialState} parameterRepository={createAppParameterRepository()} runtimeMode="api" />);

    fireEvent.click(await screen.findByRole("tab", { name: "注册" }));
    const roleSelector = screen.getByRole("combobox", { name: "角色" });
    if (!(roleSelector instanceof HTMLSelectElement)) {
      fireEvent.click(roleSelector);
    }
    const roleLabels =
      roleSelector instanceof HTMLSelectElement
        ? Array.from(roleSelector.options).map((option) => option.textContent)
        : screen.getAllByRole("option").map((option) => option.textContent);

    expect(roleLabels).toContain("Hardware Committer");
    expect(roleLabels).toContain("Software Committer");
    expect(roleLabels).not.toContain("Admin");
  });

  it("keeps the auth screen scrollable when registration content exceeds the viewport", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const authScreenCss = readCssBlock(css, ".auth-screen");

    expect(authScreenCss).toContain("height: 100vh;");
    expect(authScreenCss).toContain("overflow-y: auto;");
    expect(authScreenCss).toContain("-webkit-overflow-scrolling: touch;");
    expect(authScreenCss).toContain("align-items: start;");
  });

  it("updates the current profile and logs out from the topbar menu", async () => {
    window.history.replaceState(null, "", "/parameter-home");
    const authClient = {
      getCurrentAuthContext: vi.fn(async () => ({
        user: {
          id: "u-api-admin",
          organizationId: "org-chargelab",
          name: "API Admin",
          email: "api-admin@chargelab.cn",
          title: "API Platform Owner",
          isActive: true
        },
        organization: { id: "org-chargelab", name: "ChargeLab" },
        roles: [{ projectId: null, roleId: "admin" }],
        permissions: ["admin:access", "users:manage"]
      })),
      updateCurrentUserProfile: vi.fn(async () => ({
        user: {
          id: "u-api-admin",
          organizationId: "org-chargelab",
          name: "Renamed Admin",
          email: "api-admin@chargelab.cn",
          title: "Owner",
          isActive: true
        },
        organization: { id: "org-chargelab", name: "ChargeLab" },
        roles: [{ projectId: null, roleId: "admin" }],
        permissions: ["admin:access", "users:manage"]
      })),
      logout: vi.fn(async () => undefined)
    };

    render(<App authClient={authClient} initialAppState={adminState} parameterRepository={createAppParameterRepository()} runtimeMode="api" />);

    fireEvent.click(await screen.findByRole("button", { name: "打开用户菜单" }));
    fireEvent.click(screen.getByRole("button", { name: "个人资料" }));
    const dialog = screen.getByRole("dialog", { name: "个人资料" });
    expect(screen.queryByLabelText("用户菜单")).not.toBeInTheDocument();
    expect(dialog.closest(".topbar")).toBeNull();
    expect(screen.getByRole("button", { name: "取消" })).toHaveClass("profile-dialog__button--secondary");
    expect(screen.getByRole("button", { name: "保存" })).toHaveClass("profile-dialog__button--primary");
    expect(dialog).not.toHaveTextContent("显示称谓");
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "Renamed Admin" } });
    fireEvent.change(screen.getByLabelText("职务"), { target: { value: "Owner" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findAllByText("Renamed Admin")).not.toHaveLength(0);
    expect(authClient.updateCurrentUserProfile).toHaveBeenCalledWith({ name: "Renamed Admin", title: "Owner" });

    fireEvent.click(screen.getByRole("button", { name: "打开用户菜单" }));
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(await screen.findByRole("heading", { name: "登录雷泽" })).toBeInTheDocument();
    expect(authClient.logout).toHaveBeenCalledTimes(1);
  });

  it("routes user governance page mutations through injected API-mode actions", async () => {
    window.history.replaceState(null, "", "/user-permissions");
    const userGovernanceActions = createUserGovernanceActions();

    render(
      <App
        initialAppState={adminState}
        runtimeMode="api"
        authClient={{
          getCurrentAuthContext: vi.fn(async () => ({
            user: {
              id: "u-xu-yun",
              organizationId: "org-chargelab",
              name: "Xu Yun",
              email: "xu@chargelab.cn",
              title: "Platform Owner",
              isActive: true
            },
            organization: { id: "org-chargelab", name: "ChargeLab" },
            roles: [{ projectId: null, roleId: "admin" }],
            permissions: ["admin:access", "users:manage"]
          }))
        }}
        userGovernanceActions={userGovernanceActions}
      />
    );

    const row = await screen.findByText("Liu Min").then((cell) => cell.closest("tr")!);
    changeSelectValue(within(row).getByRole("combobox", { name: "调整 Liu Min 的角色" }), "software-committer");
    await waitFor(() => expect(userGovernanceActions.assignUserRole).toHaveBeenCalledWith("u-liu-min", "software-committer"));
  });

  it("hydrates backend governed users before rendering API-mode user governance", async () => {
    window.history.replaceState(null, "", "/user-permissions");
    const userGovernanceActions = createUserGovernanceActions({
      listUsers: vi.fn().mockResolvedValue([
        {
          id: "u-backend-governed",
          name: "Backend Governed User",
          email: "backend-governed@chargelab.cn",
          title: "Backend Operator",
          roleId: "software-user",
          isActive: true,
          createdAt: "2026-06-02T00:00:00.000Z",
          lastActive: "never"
        }
      ])
    });

    render(
      <App
        initialAppState={adminState}
        runtimeMode="api"
        authClient={{
          getCurrentAuthContext: vi.fn(async () => ({
            user: {
              id: "u-xu-yun",
              organizationId: "org-chargelab",
              name: "Xu Yun",
              email: "xu@chargelab.cn",
              title: "Platform Owner",
              isActive: true
            },
            organization: { id: "org-chargelab", name: "ChargeLab" },
            roles: [{ projectId: null, roleId: "admin" }],
            permissions: ["admin:access", "users:manage"]
          }))
        }}
        parameterRepository={createAppParameterRepository()}
        userGovernanceActions={userGovernanceActions}
      />
    );

    expect(await screen.findByText("Backend Governed User")).toBeInTheDocument();
    expect(userGovernanceActions.listUsers).toHaveBeenCalledTimes(1);
  });

  it("does not hydrate backend governed users on non-user-governance API pages", async () => {
    window.history.replaceState(null, "", "/parameters");
    const userGovernanceActions = createUserGovernanceActions({
      listUsers: vi.fn().mockResolvedValue([
        {
          id: "u-backend-governed",
          name: "Backend Governed User",
          email: "backend-governed@chargelab.cn",
          title: "Backend Operator",
          roleId: "software-user",
          isActive: true,
          createdAt: "2026-06-02T00:00:00.000Z",
          lastActive: "never"
        }
      ])
    });

    render(
      <App
        initialAppState={adminState}
        runtimeMode="api"
        authClient={{
          getCurrentAuthContext: vi.fn(async () => ({
            user: {
              id: "u-xu-yun",
              organizationId: "org-chargelab",
              name: "Xu Yun",
              email: "xu@chargelab.cn",
              title: "Platform Owner",
              isActive: true
            },
            organization: { id: "org-chargelab", name: "ChargeLab" },
            roles: [{ projectId: null, roleId: "admin" }],
            permissions: ["admin:access", "users:manage"]
          }))
        }}
        parameterRepository={createAppParameterRepository()}
        userGovernanceActions={userGovernanceActions}
      />
    );

    expect(await screen.findAllByText("api_runtime_voltage_limit")).not.toHaveLength(0);
    expect(userGovernanceActions.listUsers).not.toHaveBeenCalled();
  });

  it("does not rehydrate API auth context after local route changes", async () => {
    window.history.replaceState(null, "", "/parameter-home");
    const authClient = {
      getCurrentAuthContext: vi.fn(async () => ({
        user: {
          id: "u-xu-yun",
          organizationId: "org-chargelab",
          name: "Xu Yun",
          email: "xu@chargelab.cn",
          title: "Platform Owner",
          isActive: true
        },
        organization: { id: "org-chargelab", name: "ChargeLab" },
        roles: [{ projectId: null, roleId: "admin" }],
        permissions: ["admin:access", "users:manage"]
      }))
    };

    render(
      <App
        initialAppState={adminState}
        runtimeMode="api"
        authClient={authClient}
        parameterRepository={createAppParameterRepository()}
      />
    );

    expect(await screen.findByText("Xu Yun")).toBeInTheDocument();
    window.history.pushState(null, "", "/debugging");
    window.dispatchEvent(new PopStateEvent("popstate"));

    await waitFor(() => expect(window.location.pathname).toBe("/debugging"));
    expect(authClient.getCurrentAuthContext).toHaveBeenCalledTimes(1);
  });

  it("hydrates parameter runtime data from the API repository after auth", async () => {
    window.history.replaceState(null, "", "/parameters");
    const parameterRepository = createAppParameterRepository();

    render(
      <App
        authClient={{
          getCurrentAuthContext: async () => ({
            user: {
              id: "u-api-user",
              organizationId: "org-chargelab",
              name: "API User",
              email: "api-user@chargelab.cn",
              title: "API Parameter User",
              isActive: true
            },
            organization: { id: "org-chargelab", name: "ChargeLab" },
            roles: [{ projectId: null, roleId: "user" }],
            permissions: ["parameter:edit"]
          })
        }}
        initialAppState={{ ...initialState, activeRoleId: "user" }}
        parameterRepository={parameterRepository}
        runtimeMode="api"
      />
    );

    expect(await screen.findAllByText("api_runtime_voltage_limit")).not.toHaveLength(0);
    expect(parameterRepository.listProjects).toHaveBeenCalledTimes(1);
    expect(parameterRepository.listParameters).toHaveBeenCalledTimes(1);
    expect(parameterRepository.listChangeRequests).toHaveBeenCalledTimes(1);
    expect(parameterRepository.listSubmissionRounds).toHaveBeenCalledTimes(1);
    expect(parameterRepository.listDrafts).toHaveBeenCalledTimes(1);
  });

  it("hydrates debugging runtime data from the API gateway after auth", async () => {
    window.localStorage.setItem("wiseeff.nodeDebugging.protocol", "hdc");
    window.history.replaceState(null, "", "/node-debugging");
    const debuggingGateway = createAppDebuggingGateway();

    render(
      <App
        authClient={{
          getCurrentAuthContext: async () => ({
            user: {
              id: "u-api-debug",
              organizationId: "org-chargelab",
              name: "API Debugger",
              email: "api-debugger@chargelab.cn",
              title: "API Debug Engineer",
              isActive: true
            },
            organization: { id: "org-chargelab", name: "ChargeLab" },
            roles: [{ projectId: null, roleId: "admin" }],
            permissions: ["admin:access", "debugging:use"]
          })
        }}
        debuggingGateway={debuggingGateway}
        initialAppState={adminState}
        parameterRepository={createAppParameterRepository()}
        runtimeMode="api"
      />
    );

    expect(await screen.findByText("api_debug_runtime_parameter")).toBeInTheDocument();
    expect(debuggingGateway.listDevices).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(debuggingGateway.listParameters).toHaveBeenCalledWith({ projectId: initialState.activeProjectId, protocol: "hdc" }));
  });

  it("skips debugging runtime hydration for roles without debugging access", async () => {
    window.history.replaceState(null, "", "/parameters");
    const debuggingGateway = createAppDebuggingGateway();

    render(
      <App
        authClient={{
          getCurrentAuthContext: async () => ({
            user: {
              id: "u-api-guest",
              organizationId: "org-chargelab",
              name: "API Guest",
              email: "api-guest@chargelab.cn",
              title: "External Viewer",
              isActive: true
            },
            organization: { id: "org-chargelab", name: "ChargeLab" },
            roles: [{ projectId: null, roleId: "guest" }],
            permissions: ["parameter:view"]
          })
        }}
        debuggingGateway={debuggingGateway}
        initialAppState={{ ...initialState, activeRoleId: "guest" }}
        parameterRepository={createAppParameterRepository()}
        runtimeMode="api"
      />
    );

    expect(await screen.findByText("API Guest")).toBeInTheDocument();
    await waitFor(() => expect(debuggingGateway.listDevices).not.toHaveBeenCalled());
    expect(debuggingGateway.listParameters).not.toHaveBeenCalled();
  });

  it("does not read mock node parameters before API debugging hydration on node debugging routes", async () => {
    window.history.replaceState(null, "", "/node-debugging");
    const debuggingGateway = createAppDebuggingGateway({
      listParameters: vi.fn(() => new Promise<never>(() => undefined)),
      detectTargets: vi.fn().mockResolvedValue([
        { id: "api-target", deviceId: apiDebugDevice.id, label: "API Debug Target" }
      ]),
      createSession: vi.fn().mockResolvedValue({
        id: "api-node-session",
        projectId: initialState.activeProjectId,
        deviceId: apiDebugDevice.id,
        targetId: "api-target",
        status: "active",
        startedAt: "2026-06-01T00:00:00.000Z",
        endedAt: null
      }),
      readNode: vi.fn().mockResolvedValue({ ok: true, value: "3000" })
    });

    render(
      <App
        authClient={createResolvedAdminAuthClient()}
        debuggingGateway={debuggingGateway}
        initialAppState={userState}
        parameterRepository={createAppParameterRepository()}
        runtimeMode="api"
      />
    );

    await waitFor(() => expect(debuggingGateway.listParameters).toHaveBeenCalledWith({ projectId: initialState.activeProjectId, protocol: "hdc" }));
    expect(debuggingGateway.detectTargets).not.toHaveBeenCalled();
    expect(debuggingGateway.readNode).not.toHaveBeenCalled();
  });

  it("hydrates node debugging parameters for the persisted selected protocol", async () => {
    window.history.replaceState(null, "", "/node-debugging");
    window.localStorage.setItem("wiseeff.nodeDebugging.protocol", "adb");
    const debuggingGateway = createAppDebuggingGateway();

    render(
      <App
        authClient={createResolvedAdminAuthClient()}
        debuggingGateway={debuggingGateway}
        initialAppState={userState}
        parameterRepository={createAppParameterRepository()}
        runtimeMode="api"
      />
    );

    await waitFor(() => expect(debuggingGateway.listParameters).toHaveBeenCalledWith({
      projectId: initialState.activeProjectId,
      protocol: "adb"
    }));
  });

  it("keeps debugging runtime hydration independent when parameter refresh fails", async () => {
    window.localStorage.setItem("wiseeff.nodeDebugging.protocol", "hdc");
    window.history.replaceState(null, "", "/node-debugging");
    const debuggingGateway = createAppDebuggingGateway();
    const parameterRepository = createAppParameterRepository({
      listProjects: vi.fn().mockRejectedValue(new Error("parameter API unavailable"))
    });

    render(
      <App
        authClient={{
          getCurrentAuthContext: async () => ({
            user: {
              id: "u-api-debug-independent",
              organizationId: "org-chargelab",
              name: "API Debug Independent",
              email: "api-debug-independent@chargelab.cn",
              title: "API Debug Engineer",
              isActive: true
            },
            organization: { id: "org-chargelab", name: "ChargeLab" },
            roles: [{ projectId: null, roleId: "admin" }],
            permissions: ["admin:access", "debugging:use"]
          })
        }}
        debuggingGateway={debuggingGateway}
        initialAppState={adminState}
        parameterRepository={parameterRepository}
        runtimeMode="api"
      />
    );

    expect(await screen.findByText("api_debug_runtime_parameter")).toBeInTheDocument();
    expect(parameterRepository.listProjects).toHaveBeenCalledTimes(1);
    expect(debuggingGateway.listDevices).toHaveBeenCalled();
    expect(debuggingGateway.listParameters).toHaveBeenCalledWith({ projectId: initialState.activeProjectId, protocol: "hdc" });
  });

  it("threads debugging runtime props through debugging route cases", () => {
    const routesSource = readFileSync("src/app/routes.tsx", "utf8");
    const debuggingCase = routesSource.slice(
      routesSource.indexOf('case "debugging":'),
      routesSource.indexOf('case "node-debugging":')
    );
    const nodeDebuggingCase = routesSource.slice(
      routesSource.indexOf('case "node-debugging":'),
      routesSource.indexOf('case "debugging-admin":')
    );

    expect(debuggingCase).toContain("NoEntryPage");
    expect(debuggingCase).not.toContain("DebuggingPageWithRuntimeProps");
    expect(nodeDebuggingCase).toContain('debuggingActions={runtimeMode === "api" ? debuggingActions : undefined}');
    expect(nodeDebuggingCase).not.toContain("debuggingGateway={debuggingGateway}");
  });

  it("advances an API-hydrated review with the request baseVersion as expectedVersion", async () => {
    window.history.replaceState(null, "", "/parameter-review");
    const apiReview = {
      ...initialState.changeRequests[0],
      id: "api-review-with-version",
      parameterId: apiParameter.id,
      projectId: apiProject.id,
      status: "硬件Committer检视" as const,
      baseVersion: 7
    };
    const parameterRepository = createAppParameterRepository({
      listChangeRequests: vi.fn().mockResolvedValue([apiReview]),
      reviewChange: vi.fn().mockResolvedValue({ ...apiReview, status: "软件Committer检视" })
    });

    render(
      <App
        authClient={{
          getCurrentAuthContext: async () => ({
            user: {
              id: "u-api-reviewer",
              organizationId: "org-chargelab",
              name: "API Reviewer",
              email: "api-reviewer@chargelab.cn",
              title: "API Reviewer",
              isActive: true
            },
            organization: { id: "org-chargelab", name: "ChargeLab" },
            roles: [{ projectId: null, roleId: "hardware-committer" }],
            permissions: ["parameter:review"]
          })
        }}
        initialAppState={{ ...initialState, activeRoleId: "hardware-committer" }}
        parameterRepository={parameterRepository}
        runtimeMode="api"
      />
    );

    expect(await screen.findAllByText(apiReview.title)).not.toHaveLength(0);
    fireEvent.click(within(screen.getByRole("complementary", { name: "审阅详情" })).getByRole("button", { name: "推进流程" }));

    await waitFor(() => expect(parameterRepository.reviewChange).toHaveBeenCalledWith({
      requestId: "api-review-with-version",
      decision: "advance",
      expectedVersion: 7
    }));
  });

  it("hydrates parameter runtime state while preserving unrelated local state", () => {
    const state = {
      ...initialState,
      activeProjectId: "aurora",
      activeRoleId: "admin",
      notifications: ["keep this notification"]
    };
    const apiDraft = {
      id: "api-draft-1",
      projectId: apiProject.id,
      parameterId: apiParameter.id,
      targetValue: "4200",
      reason: "Hold for review",
      updatedAt: "2026-05-25T08:30:00.000Z"
    };
    const next = appReducer(state, {
      type: "HYDRATE_PARAMETER_RUNTIME",
      projects: [apiProject],
      parameters: [apiParameter],
      changeRequests: [],
      parameterSubmissionRounds: [],
      parameterDrafts: [apiDraft]
    });

    expect(next.parameters).toEqual([apiParameter]);
    expect(next.changeRequests).toEqual([]);
    expect(next.parameterDrafts).toEqual([apiDraft]);
    expect(next.parameterSubmissionRounds).toEqual([
      expect.objectContaining({
        id: "draft-api-draft-1",
        projectId: apiProject.id,
        projectName: apiProject.name,
        createdAt: apiDraft.updatedAt,
        status: "\u5df2\u6682\u5b58",
        items: [
          expect.objectContaining({
            parameterId: apiParameter.id,
            name: apiParameter.name,
            module: apiParameter.module,
            currentValue: apiParameter.currentValue,
            targetValue: apiDraft.targetValue,
            unit: apiParameter.unit,
            risk: apiParameter.risk,
            reason: apiDraft.reason
          })
        ]
      })
    ]);
    expect(next.configDraft.projects).toEqual([apiProject]);
    expect(next.activeProjectId).toBe(state.activeProjectId);
    expect(next.activeRoleId).toBe(state.activeRoleId);
    expect(next.notifications).toBe(state.notifications);
    expect(next.logs).toBe(state.logs);
    expect(next.debugParameters).toBe(state.debugParameters);
    expect(next.users).toBe(state.users);
  });

  it("clears cached API parameter drafts when hydrating a different authenticated user", () => {
    const apiDraft = {
      id: "api-draft-1",
      projectId: apiProject.id,
      parameterId: apiParameter.id,
      targetValue: "4200",
      reason: "Previous user draft",
      updatedAt: "2026-05-25T08:30:00.000Z"
    };
    const draftRound = {
      ...initialState.parameterSubmissionRounds[0],
      id: "draft-api-draft-1",
      status: "已暂存" as const
    };
    const submittedRound = {
      ...initialState.parameterSubmissionRounds[0],
      id: "api-runtime-round",
      status: "硬件Committer检视" as const
    };
    const state = {
      ...initialState,
      currentUserId: "u-zhao-heng",
      activeRoleId: "hardware-user",
      parameterDrafts: [apiDraft],
      parameterSubmissionRounds: [draftRound, submittedRound]
    };
    const next = appReducer(state, {
      type: "HYDRATE_AUTH_CONTEXT",
      user: {
        id: "u-liu-min",
        name: "Liu Min",
        email: "liu@chargelab.cn",
        username: "liu.min",
        title: "Software Engineer",
        roleId: "software-user",
        isActive: true,
        createdAt: "2025-02-03T08:04:00.000Z",
        lastActive: "just now"
      },
      roleId: "software-user"
    });

    expect(next.currentUserId).toBe("u-liu-min");
    expect(next.parameterDrafts).toEqual([]);
    expect(next.parameterSubmissionRounds).toEqual([submittedRound]);
  });

  it("hydrates debugging runtime state and mirrors parameters into the config draft", () => {
    const state = {
      ...adminState,
      debugParameters: initialState.debugParameters,
      configDraft: {
        ...adminState.configDraft,
        debugParameters: initialState.debugParameters
      }
    };
    const next = appReducer(state, {
      type: "HYDRATE_DEBUG_RUNTIME",
      devices: [
        {
          id: apiDebugDevice.id,
          name: apiDebugDevice.name,
          projectId: apiDebugDevice.projectId,
          firmware: apiDebugDevice.firmware,
          status: "已连接",
          lastSeen: apiDebugDevice.lastSeenAt
        }
      ],
      debugParameters: [apiDebugParameter]
    });

    expect(next.devices).toEqual([
      expect.objectContaining({
        id: apiDebugDevice.id,
        name: apiDebugDevice.name
      })
    ]);
    expect(next.debugParameters).toEqual([apiDebugParameter]);
    expect(next.configDraft.debugParameters).toEqual([apiDebugParameter]);
  });

  it("stores API debug sessions and operation events while ignoring snapshot summaries", () => {
    const startedAt = "2026-05-25T08:01:00.000Z";
    const sessionState = appReducer(adminState, {
      type: "SET_DEBUG_ACTIVE_SESSION",
      session: {
        id: "session-1",
        projectId: initialState.activeProjectId,
        deviceId: apiDebugDevice.id,
        targetId: "target-1",
        status: "active",
        startedAt,
        endedAt: null
      },
      target: { id: "target-1", deviceId: apiDebugDevice.id, label: "API Target" }
    });
    const operationState = appReducer(sessionState, {
      type: "UPSERT_DEBUG_NODE_OPERATION",
      operation: {
        id: "op-write-1",
        sessionId: "session-1",
        parameterId: initialState.debugParameters[0].id,
        nodePath: initialState.debugParameters[0].nodePath,
        operationType: "write",
        status: "succeeded",
        requestedValue: "4200",
        verified: true,
        durationMs: 12,
        snapshotId: "snapshot-valid",
        createdAt: "2026-05-25T08:02:00.000Z"
      }
    });
    const invalidSnapshotState = appReducer(operationState, {
      type: "UPSERT_DEBUG_SNAPSHOT",
      snapshot: {
        id: "snapshot-invalid",
        sessionId: "session-1",
        status: "invalid",
        risk: "High",
        createdAt: "2026-05-25T08:02:00.000Z"
      }
    });
    const validSnapshotState = appReducer(invalidSnapshotState, {
      type: "UPSERT_DEBUG_SNAPSHOT",
      snapshot: {
        id: "snapshot-valid",
        sessionId: "session-1",
        status: "valid",
        risk: "High",
        createdAt: "2026-05-25T08:03:00.000Z"
      }
    });

    expect(sessionState.debuggingSessionStartedAt).toBe(startedAt);
    expect(sessionState.debuggingActiveSessionId).toBe("session-1");
    expect(operationState.debugEvents.at(-1)).toMatchObject({
      kind: "push",
      snapshotId: "snapshot-valid",
      parameterIds: [initialState.debugParameters[0].id]
    });
    expect(invalidSnapshotState.lastDebugSnapshot).toBeNull();
    expect(validSnapshotState.lastDebugSnapshot).toBeNull();
  });

  it("does not convert valid API snapshot summaries into empty rollback snapshots", () => {
    const next = appReducer(initialState, {
      type: "UPSERT_DEBUG_SNAPSHOT",
      snapshot: {
        id: "snapshot-summary-only",
        sessionId: "session-1",
        status: "valid",
        risk: "High",
        createdAt: "2026-05-25T08:03:00.000Z"
      }
    });

    expect(next.lastDebugSnapshot).toBeNull();
  });

  it("defaults mock parameter workflow assignees to concrete eligible users instead of global admin", () => {
    const next = appReducer({ ...initialState, activeRoleId: "admin" }, {
      type: "ADD_CHANGE_REQUEST",
      parameterId: initialState.parameters[0].id,
      targetValue: "3200",
      reason: "Validate workflow assignee defaults"
    });

    expect(next.changeRequests[0].workflowAssignees).toEqual({
      hardwareCommitterId: "u-wang-jie",
      softwareCommitterId: "u-sun-mei",
      softwareUserId: "u-liu-min"
    });
    expect(next.changeRequests[0].assignedTo).toBe("u-wang-jie");
  });

  it("keeps the platform homepage inside the app scroll container", () => {
    window.history.replaceState(null, "", "/");

    renderAppForCurrentPath();

    expect(screen.getByRole("main", { name: "雷泽首页" }).closest(".main-content.home-content")).toBeInTheDocument();
  });

  it("provides two parameter-home workbench shortcuts plus the sub-app card entry", () => {
    window.history.replaceState(null, "", "/");

    renderAppForCurrentPath();

    const workbenchShortcut = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href="/parameter-home"]')).filter(
      (link) => link.className.includes("linear-button") || link.getAttribute("aria-label") === "进入雷泽工作台"
    );

    expect(workbenchShortcut).toHaveLength(2);

    const subAppPrimary = document.querySelectorAll<HTMLAnchorElement>('a.sub-app-card-primary[href="/parameter-home"]');
    expect(subAppPrimary).toHaveLength(1);

    expect(document.querySelector('a[href="/parameters"]')).not.toBeInTheDocument();
  });

  it("adds a parameter management homepage without replacing the platform homepage", () => {
    window.history.replaceState(null, "", "/parameter-home");

    renderAppForCurrentPath();

    expect(screen.getByRole("main", { name: "参数管理首页" })).toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "智能参数管理" })).not.toBeInTheDocument();
    expect(screen.queryByText("参数运营中枢")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "推荐依据" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "热榜" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "个人工作台" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "待办事项" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "主要功能" })).toBeInTheDocument();
    expect(screen.queryByText("管理视角")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开 管理后台/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开 新建项目/ })).toBeInTheDocument();
    expect(screen.queryByText("我要治理")).not.toBeInTheDocument();
    expect(screen.getByText("参数更新趋势")).toBeInTheDocument();
    expect(screen.getByText("各项目参数更新情况")).toBeInTheDocument();
    expect(screen.queryByText("关键参数变化")).not.toBeInTheDocument();
    expect(screen.queryByText("审核合入情况")).not.toBeInTheDocument();
    expect(document.querySelector(".topbar")).toBeInTheDocument();
    const topbar = document.querySelector(".topbar") as HTMLElement;
    const timeWindowSelect = within(topbar).getByRole("combobox", { name: "时间范围" });

    expect(topbar.querySelector(".topbar-title")).toHaveTextContent("我的工作台");
    expect(topbar.querySelector(".topbar-subtitle")).toHaveTextContent("待办事项 · 主要功能 · 热榜");
    expect(screen.queryByRole("button", { name: "进入 参数修改" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "进入 参数审阅" })).not.toBeInTheDocument();
    expect(within(topbar).queryByRole("navigation", { name: "参数管理快捷入口" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "参数管理快捷入口" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "对比分析" })).not.toBeInTheDocument();
    expectSelectValue(timeWindowSelect, "30d");
    expect(screen.getAllByRole("button", { name: "看板" }).filter((btn) => btn.classList.contains("active"))).toHaveLength(0);
    const activeNavButtons = screen.getAllByRole("button", { name: "我的工作台" }).filter((btn) => btn.classList.contains("active"));
    expect(activeNavButtons.length).toBe(1);
  });

  it("updates parameter homepage analytics from the topbar time range selector", () => {
    window.history.replaceState(null, "", "/parameter-home");

    renderAppForCurrentPath();

    const topbar = document.querySelector(".topbar") as HTMLElement;
    const timeWindowSelect = within(topbar).getByRole("combobox", { name: "时间范围" });

    expect(screen.getByText(/近 30 天 ·/)).toBeInTheDocument();

    changeSelectValue(timeWindowSelect, "7天");

    expectSelectValue(timeWindowSelect, "7d");
    expect(screen.getByText(/近 7 天 ·/)).toBeInTheDocument();
    expect(screen.queryByText(/近 30 天 ·/)).not.toBeInTheDocument();
  });

  it("keeps the WiseEff workbench shell on non-home routes", () => {
    window.history.replaceState(null, "", "/parameters");

    renderAppForCurrentPath();

    const workbenchBrand = document.querySelector(".brand-mark .wiseeff-icon");
    expect(workbenchBrand).toBeInTheDocument();
    expect(workbenchBrand).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("雷泽")).toBeInTheDocument();
    expect(screen.getByText("Driven by AI")).toBeInTheDocument();
    expect(screen.queryByText("AI 驱动的企业业务效率平台")).not.toBeInTheDocument();
    expect(document.querySelector(".topbar")).toBeInTheDocument();
    expect(screen.queryByLabelText("打开 WiseAgent")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "项目参数用户工作台" })).toBeInTheDocument();
  });

  it("opens the project initialization wizard from the parameter workspace topbar", () => {
    window.history.replaceState(null, "", "/parameters");

    renderAppForCurrentPath();

    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));

    expect(screen.getByRole("dialog", { name: "新项目参数初始化" })).toBeInTheDocument();
    expect(screen.getByLabelText("项目信息")).toHaveClass("project-init-form-card");
  });

  it("hides project initialization from Guest parameter routes", () => {
    window.history.replaceState(null, "", "/parameters");

    render(<App initialAppState={{ ...initialState, activeRoleId: "guest" }} />);

    const topbar = document.querySelector(".topbar") as HTMLElement;
    expect(topbar).toBeInTheDocument();
    expect(within(topbar).queryByRole("button", { name: "新建项目" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "新项目参数初始化" })).not.toBeInTheDocument();
  });

  it("does not allow switching roles from the topbar user menu", () => {
    window.history.replaceState(null, "", "/debugging-admin");

    render(<App initialAppState={{ ...initialState, activeRoleId: "guest" }} />);

    expect(screen.getByRole("heading", { name: "Permission denied" })).toBeInTheDocument();

    const topbar = document.querySelector(".topbar") as HTMLElement;
    fireEvent.click(within(topbar).getByRole("button", { name: "打开用户菜单" }));

    expect(within(topbar).queryByRole("combobox", { name: "Prototype role" })).not.toBeInTheDocument();
    expect(within(topbar).getByLabelText("当前用户角色")).toHaveTextContent("Guest");
    expect(screen.getByRole("heading", { name: "Permission denied" })).toBeInTheDocument();
  });

  it("exposes the three sub-app entries on the homepage main region", () => {
    window.history.replaceState(null, "", "/");

    renderAppForCurrentPath();

    const homepage = screen.getByRole("main", { name: "雷泽首页" });

    expect(within(homepage).getByRole("heading", { name: "参数管理", level: 3 })).toBeInTheDocument();
    expect(within(homepage).getByRole("heading", { name: "调试平台", level: 3 })).toBeInTheDocument();
    expect(within(homepage).getByRole("heading", { name: "日志分析", level: 3 })).toBeInTheDocument();

    expect(within(homepage).getByRole("link", { name: /进入参数首页/ })).toHaveAttribute("href", "/parameter-home");
    expect(within(homepage).getByRole("link", { name: /进入日志分析/ })).toHaveAttribute("href", "/logs");
    expect(within(homepage).getByRole("link", { name: /进入节点调试/ })).toHaveAttribute("href", "/node-debugging");

    expect(within(homepage).getByRole("heading", { name: "一条可审阅工作流，三种场景接入" })).toBeInTheDocument();

    expect(within(homepage).queryByRole("heading", { name: "不是另一个后台系统" })).not.toBeInTheDocument();
    expect(within(homepage).queryByRole("heading", { name: "参数流转，从查询到审阅" })).not.toBeInTheDocument();
    expect(within(homepage).queryByRole("heading", { name: "日志分析，不只给结论" })).not.toBeInTheDocument();
    expect(within(homepage).queryByRole("heading", { name: "调试动作，保留控制权" })).not.toBeInTheDocument();

    expect(homepage).toHaveTextContent("参数目录");
    expect(homepage).not.toHaveTextContent(/Aurora|Nebula|Atlas|ChargeLab_X01|charging_thermal_trace|battery_pack_temp|关键温度/);
  });

  it("links the localized homepage CTAs into the WiseEff parameter homepage", () => {
    window.history.replaceState(null, "", "/");

    renderAppForCurrentPath();

    expect(screen.getAllByRole("link", { name: /打开我的工作台|进入雷泽工作台/ }).every((link) => link.getAttribute("href") === "/parameter-home")).toBe(true);
    expect(screen.getByRole("link", { name: "查看演示" })).toHaveAttribute("href", "#platform-flow");
    expect(document.body).not.toHaveTextContent("Linear is a better way");
    expect(document.body).not.toHaveTextContent("Powering the world's best product teams.");
  });

  it("switches the platform flow tabs across WiseEff applications", () => {
    window.history.replaceState(null, "", "/");

    renderAppForCurrentPath();

    expect(screen.getByRole("tab", { name: "参数管理" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getByText("参数目录")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "调试平台" }));
    expect(screen.getByRole("tab", { name: "调试平台" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getByText("调试场景")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "日志分析" }));
    expect(screen.getByRole("tab", { name: "日志分析" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getByText("证据链路")).toBeInTheDocument();
  });

  it("moves the platform flow tab selection by keyboard", () => {
    window.history.replaceState(null, "", "/");

    renderAppForCurrentPath();

    const firstTab = screen.getByRole("tab", { name: "参数管理" });

    firstTab.focus();
    fireEvent.keyDown(firstTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "调试平台" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(screen.getByRole("tab", { name: "调试平台" }), { key: "ArrowLeft" });
    expect(firstTab).toHaveAttribute("aria-selected", "true");
  });

  it("navigates from parameter homepage entries into parameter management routes", () => {
    window.history.replaceState(null, "", "/parameter-home");

    renderAppForCurrentPath();

    expect(screen.queryByRole("navigation", { name: "参数管理快捷入口" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /打开 管理后台/ }));
    expect(window.location.pathname).toBe("/parameter-admin");

    window.history.replaceState(null, "", "/parameter-home");
    cleanup();
    renderAppForCurrentPath();

    expect(screen.queryByRole("navigation", { name: "参数管理快捷入口" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /打开 新建项目/ }));
    expect(screen.getByRole("dialog", { name: "新项目参数初始化" })).toBeInTheDocument();
    expect(screen.getByLabelText("项目信息")).toHaveClass("project-init-form-card");
  });

  it("preserves contextual query strings when navigating from parameter homepage hotspots", () => {
    window.history.replaceState(null, "", "/parameter-home");

    renderAppForCurrentPath();

    const hotspotRegion = screen.getByRole("region", { name: "热榜" });
    fireEvent.click(within(hotspotRegion).getAllByRole("button", { name: /进入/ })[0]);

    expect(["/parameters", "/parameter-review"]).toContain(window.location.pathname);
    expect(window.location.search).toMatch(/module=|project=/);
  });

  it("renders parameter homepage hotspots as leaderboard with AI panel instead of legacy cards", () => {
    window.history.replaceState(null, "", "/parameter-home");

    renderAppForCurrentPath();

    const hotspotRegion = screen.getByRole("region", { name: "热榜" });

    expect(document.querySelector(".hotspot-card")).not.toBeInTheDocument();
    expect(within(hotspotRegion).queryByRole("button", { name: /查看评分/ })).not.toBeInTheDocument();
    expect(document.querySelector(".hotspot-row")).toBeInTheDocument();
    expect(document.querySelector(".hotspot-list")).toBeInTheDocument();
    expect(within(hotspotRegion).getByRole("region", { name: /AI 评分拆解/ })).toBeInTheDocument();
    expect(within(hotspotRegion).queryByText("AI 建议动作")).not.toBeInTheDocument();
    expect(within(hotspotRegion).getByRole("button", { name: /创建高风险专项审阅/ })).toBeInTheDocument();
  });

  it("navigates from a hotspot AI primary action with contextual query strings", () => {
    window.history.replaceState(null, "", "/parameter-home");

    renderAppForCurrentPath();

    fireEvent.click(screen.getByRole("button", { name: /创建高风险专项审阅/ }));

    expect(window.location.pathname).toBe("/parameter-review");
    expect(window.location.search).toContain("filter=high-risk");
    expect(window.location.search).toContain("module=");
  });

  it("uses the TopBar project selector and operation-bar risk/module filters", () => {
    window.history.replaceState(null, "", "/parameters");

    renderAppForCurrentPath();

    const getTableRow = (parameterName: string) =>
      Array.from(screen.getByRole("table").querySelectorAll<HTMLElement>("tbody tr")).find((row) =>
        row.textContent?.includes(parameterName)
      );
    const projectSelect = screen.getByRole("combobox", { name: "项目" });

    expectSelectValue(projectSelect, "aurora");
    expect(screen.queryByRole("complementary", { name: "参数筛选" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "按名称 / 描述 / 模块搜索" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选重要性" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选模块" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "筛选模块" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Charging Policy" }));

    expect(within(screen.getByRole("table")).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByText("battery_health_guard_enable")).not.toBeInTheDocument();

    changeSelectValue(projectSelect, /Nebula/);

    expectSelectValue(projectSelect, "nebula");
    expect(screen.getByRole("button", { name: "筛选模块" })).toBeInTheDocument();
    expect(getTableRow("fast_charge_current_limit_ma")).toHaveTextContent("4200");
  });

  it("exports the currently filtered project parameters as an Excel-readable file", async () => {
    window.history.replaceState(null, "", "/parameters");
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:project-parameters");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const clickAnchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    renderAppForCurrentPath();

    fireEvent.click(screen.getByRole("button", { name: "筛选模块" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Charging Policy" }));
    fireEvent.click(screen.getByRole("button", { name: "导出 Excel" }));

    const exportedBlob = createObjectUrl.mock.calls[0]?.[0] as Blob;
    const exportedText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result)));
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsText(exportedBlob);
    });

    expect(exportedBlob.type).toContain("application/vnd.ms-excel");
    expect(exportedText).toContain("fast_charge_current_limit_ma");
    expect(exportedText).toContain("charge_voltage_limit_mv");
    expect(exportedText).not.toContain("battery_health_reserve_pct");
    expect(clickAnchor).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:project-parameters");
  });

  it("labels the parameter value column as a current-to-recommended diff", () => {
    window.history.replaceState(null, "", "/parameters");

    renderAppForCurrentPath();

    expect(screen.getByRole("columnheader", { name: "当前 → 推荐" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "推荐值" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Recommended" })).not.toBeInTheDocument();
  });

  it("consumes parameter route context from query strings", () => {
    window.history.replaceState(
      null,
      "",
      "/parameters?project=nebula&module=Battery%20Safety&parameter=nebula-battery-temp-target"
    );

    renderAppForCurrentPath();

    const projectSelect = screen.getByRole("combobox", { name: "项目" });

    expectSelectValue(projectSelect, "nebula");
    expect(screen.getByRole("button", { name: "筛选模块" })).toHaveClass("active");
    expect(within(screen.getByRole("table")).getByText("battery_temp_target_c")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByText("fast_charge_current_limit_ma")).not.toBeInTheDocument();
  });

  it("keeps the parameter example value aligned inside a normal table cell", () => {
    window.history.replaceState(null, "", "/parameters");

    renderAppForCurrentPath();

    const fastChargeRow = Array.from(screen.getByRole("table").querySelectorAll<HTMLTableRowElement>("tbody tr")).find(
      (row) => row.textContent?.includes("fast_charge_current_limit_ma")
    );
    const exampleCell = fastChargeRow?.querySelector<HTMLTableCellElement>("td[data-label='当前 → 推荐']");

    expect(exampleCell).toBeInTheDocument();
    expect(exampleCell).toHaveTextContent("3200");
    expect(exampleCell?.querySelector(".parameter-value-diff")).toBeInTheDocument();
  });

  it("removes the parameter page header subtitle and submit-change shortcut", () => {
    window.history.replaceState(null, "", "/parameters");

    renderAppForCurrentPath();

    expect(screen.queryByText(/当前项目：/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交变更" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /提交本轮|鎻愴氦鏈疆/ })).not.toBeInTheDocument();
  });

  it("opens a hidden personal submission history page from the parameter workbench", () => {
    window.history.replaceState(null, "", "/parameters");

    render(<App initialAppState={userState} />);

    expect(screen.queryByRole("button", { name: "我的历史提交" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "历史提交" }));

    expect(window.location.pathname).toBe("/parameter-submissions");
    expect(screen.getByText("我的提交轮次")).toBeInTheDocument();
    expect(document.querySelector(".workspace-header")).not.toBeInTheDocument();
    expect(within(document.querySelector(".topbar") as HTMLElement).getByRole("button", { name: "返回工作台" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "我的历史提交" })).not.toBeInTheDocument();
  });

  it("submits a round with multiple parameter changes and shows it in personal history", () => {
    window.history.replaceState(null, "", "/parameters");

    render(<App initialAppState={userState} />);

    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: /编辑 charge_voltage_limit_mv/ }));
    fireEvent.change(screen.getByLabelText("目标值"), { target: { value: "4310" } });
    fireEvent.change(screen.getByLabelText("修改原因"), { target: { value: "验证多参数提交" } });
    fireEvent.change(screen.getByLabelText("修改原因 fast_charge_current_limit_ma"), { target: { value: "验证首个参数提交" } });
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));

    fireEvent.click(screen.getAllByRole("button", { name: /提交本轮/ })[0]);

    const dialog = screen.getByRole("dialog", { name: "提交本轮参数" });
    expect(within(dialog).getByText(/本轮提交包含\s*2\s*个参数修改/)).toBeInTheDocument();
    expect(within(dialog).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(within(dialog).getByText("charge_voltage_limit_mv")).toBeInTheDocument();
    expect(within(dialog).getByText(/4310/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "确认提交" }));
    fireEvent.click(screen.getByRole("button", { name: "历史提交" }));

    expect(screen.getByText("我的提交轮次")).toBeInTheDocument();
    expect(document.querySelector(".workspace-header")).not.toBeInTheDocument();
    expect(screen.queryByText(/PRS-/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/本轮提交包含\s*2\s*个参数/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.getByText("charge_voltage_limit_mv")).toBeInTheDocument();
  });

  it("shows API-created submission rounds for the current user display name", () => {
    window.history.replaceState(null, "", "/parameter-submissions");
    const simpleParameter = initialState.parameters.find((parameter) => parameter.name === "fast_charge_current_limit_ma");
    expect(simpleParameter).toBeDefined();
    const zhaoRound = {
      ...initialState.parameterSubmissionRounds[0],
      id: "api-zhao-round",
      projectId: simpleParameter!.projectId,
      projectName: "Aurora 量产平台",
      submitter: "Zhao Heng",
      createdAt: "刚刚",
      status: "硬件Committer检视" as const,
      summary: "Hardware User API 提交。",
      items: [
        {
          requestId: "api-zhao-request",
          parameterId: simpleParameter!.id,
          name: simpleParameter!.name,
          module: simpleParameter!.module,
          currentValue: "3850",
          targetValue: "3200",
          unit: simpleParameter!.unit,
          risk: simpleParameter!.risk,
          reason: "验证 API 提交按用户展示"
        }
      ]
    };

    render(
      <App
        initialAppState={{
          ...initialState,
          currentUserId: "u-zhao-heng",
          activeRoleId: "hardware-user",
          parameterSubmissionRounds: [zhaoRound]
        }}
      />
    );

    const historyPanel = screen.getByRole("complementary", { name: "我的提交轮次" });
    expect(historyPanel).toHaveTextContent("提交轮次");
    expect(historyPanel).toHaveTextContent("1 轮");
    expect(screen.getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "提交轮次详情" })).toHaveTextContent("Zhao Heng");
    expect(screen.queryByText("当前还没有你的历史提交。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撤回本轮提交" })).toBeEnabled();
  });

  it("formats ISO submission timestamps on the personal history page", () => {
    window.history.replaceState(null, "", "/parameter-submissions");
    const simpleParameter = initialState.parameters.find((parameter) => parameter.name === "fast_charge_current_limit_ma");
    expect(simpleParameter).toBeDefined();
    const zhaoRound = {
      ...initialState.parameterSubmissionRounds[0],
      id: "api-zhao-round-iso",
      projectId: simpleParameter!.projectId,
      projectName: "Aurora 量产平台",
      submitter: "Zhao Heng",
      createdAt: "2026-06-17T03:10:21.456Z",
      status: "硬件Committer检视" as const,
      summary: "Hardware User API 提交。",
      items: [
        {
          requestId: "api-zhao-request-iso",
          parameterId: simpleParameter!.id,
          name: simpleParameter!.name,
          module: simpleParameter!.module,
          currentValue: "3850",
          targetValue: "3200",
          unit: simpleParameter!.unit,
          risk: simpleParameter!.risk,
          reason: "验证时间格式"
        }
      ]
    };

    render(
      <App
        initialAppState={{
          ...initialState,
          currentUserId: "u-zhao-heng",
          activeRoleId: "hardware-user",
          parameterSubmissionRounds: [zhaoRound]
        }}
      />
    );

    expect(screen.queryByText("2026-06-17T03:10:21.456Z")).not.toBeInTheDocument();
    expect(screen.getAllByText(/分钟前|小时前|天前|2026/).length).toBeGreaterThan(0);
  });

  it("does not show role-owned submission rounds as personal history when a current user is known", () => {
    window.history.replaceState(null, "", "/parameter-submissions");
    const simpleParameter = initialState.parameters.find((parameter) => parameter.name === "fast_charge_current_limit_ma");
    expect(simpleParameter).toBeDefined();
    const roleOwnedRound = {
      ...initialState.parameterSubmissionRounds[0],
      id: "legacy-role-round",
      projectId: simpleParameter!.projectId,
      projectName: "Aurora 量产平台",
      submitter: "Hardware User",
      createdAt: "刚刚",
      items: [
        {
          requestId: "legacy-role-request",
          parameterId: simpleParameter!.id,
          name: simpleParameter!.name,
          module: simpleParameter!.module,
          currentValue: "3850",
          targetValue: "3200",
          unit: simpleParameter!.unit,
          risk: simpleParameter!.risk,
          reason: "旧角色名提交不应进入个人历史"
        }
      ]
    };

    render(
      <App
        initialAppState={{
          ...initialState,
          currentUserId: "u-zhao-heng",
          activeRoleId: "hardware-user",
          parameterSubmissionRounds: [roleOwnedRound]
        }}
      />
    );

    const historyPanel = screen.getByRole("complementary", { name: "我的提交轮次" });
    expect(historyPanel).toHaveTextContent("0 轮");
    expect(screen.queryByText("fast_charge_current_limit_ma")).not.toBeInTheDocument();
    expect(screen.getByText("当前还没有你的历史提交。")).toBeInTheDocument();
  });

  it("keeps submission round detail copy to a single prompt line and a single-row timeline", () => {
    window.history.replaceState(null, "", "/parameters");

    render(<App initialAppState={userState} />);

    fireEvent.click(screen.getByRole("button", { name: /编辑 fast_charge_current_limit_ma/ }));
    fireEvent.click(screen.getByRole("button", { name: /编辑 charge_voltage_limit_mv/ }));
    fireEvent.change(screen.getByLabelText("目标值"), { target: { value: "4310" } });
    fireEvent.change(screen.getByLabelText("修改原因"), { target: { value: "验证提交轮次详情" } });
    fireEvent.change(screen.getByLabelText("修改原因 fast_charge_current_limit_ma"), { target: { value: "验证提交轮次首项" } });
    fireEvent.click(screen.getByRole("button", { name: "提交参数" }));
    fireEvent.click(screen.getAllByRole("button", { name: /提交本轮/ })[0]);

    const dialog = screen.getByRole("dialog", { name: "提交本轮参数" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认提交" }));
    fireEvent.click(screen.getByRole("button", { name: "历史提交" }));

    const detail = screen.getByRole("region", { name: "提交轮次详情" });
    expect(within(detail).getAllByText(/本轮提交包含\s*\d+\s*个参数/)).toHaveLength(1);

    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".submission-timeline {");
    expect(readCssBlock(css, ".submission-timeline")).toContain("grid-template-columns: repeat(5, minmax(0, 1fr));");
  });

  it("renders complex DTS values in personal submission history without stretching the detail layout", () => {
    window.history.replaceState(null, "", "/parameter-submissions");
    const dtsParameter = initialState.parameters.find((parameter) => parameter.name === "dts_fast_charge_profile_matrix");
    expect(dtsParameter).toBeDefined();
    const complexRound = {
      ...initialState.parameterSubmissionRounds[0],
      id: "PRS-complex",
      projectId: dtsParameter!.projectId,
      projectName: "Aurora 量产平台",
      submitter: "Zhao Heng",
      createdAt: "刚刚",
      items: [
        {
          requestId: "PRQ-complex",
          parameterId: dtsParameter!.id,
          name: dtsParameter!.name,
          module: dtsParameter!.module,
          currentValue: dtsParameter!.currentValue,
          targetValue: dtsParameter!.currentValue.replace('"burst"', '"boost"'),
          unit: dtsParameter!.unit,
          risk: dtsParameter!.risk,
          valueKind: dtsParameter!.valueKind,
          reason: "同步 DTS 矩阵配置"
        }
      ]
    };

    render(
      <App
        initialAppState={{
          ...initialState,
          currentUserId: "u-zhao-heng",
          activeRoleId: "hardware-user",
          parameterSubmissionRounds: [complexRound]
        }}
      />
    );

    const detail = document.querySelector<HTMLElement>(".submission-round-detail");
    expect(detail).not.toBeNull();
    const complexCard = within(detail!).getByText("dts_fast_charge_profile_matrix").closest(".submission-diff-card");
    expect(complexCard).toHaveClass("submission-diff-card--history-complex");
    expect(complexCard!.querySelector(".diff-values")).not.toBeInTheDocument();
    expect(complexCard!.querySelector(".history-submission-code-grid")).not.toBeInTheDocument();

    const diff = complexCard!.querySelector<HTMLElement>(".history-submission-diff");
    expect(diff).toBeInTheDocument();
    expect(diff).toHaveClass("submission-preview-diff");
    expect(diff!.querySelectorAll(".submission-preview-diff-row[data-kind='remove']")).toHaveLength(1);
    expect(diff!.querySelectorAll(".submission-preview-diff-row[data-kind='add']")).toHaveLength(1);
    expect(diff!.querySelector(".submission-preview-diff-row[data-kind='remove'] code")).toHaveTextContent('"burst"');
    expect(diff!.querySelector(".submission-preview-diff-row[data-kind='add'] code")).toHaveTextContent('"boost"');

    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".submission-history-layout {\n  display: grid;\n  grid-template-columns: 320px minmax(0, 1fr);");
    expect(readCssBlock(css, ".submission-history-layout")).toContain("grid-template-columns: 1fr;");
    expect(css).toContain(".submission-history-layout .history-panel,\n.submission-history-layout .submission-round-detail {");
    expect(css).toContain("grid-column: auto;");
    expect(readCssBlock(css, ".submission-round-detail")).toContain("min-width: 0;");
    expect(readCssBlock(css, ".history-diff-list")).toContain("overflow: hidden;");
    expect(readCssBlock(css, ".history-submission-diff")).toContain("max-height: 300px;");
  });

  it("uses the same history card structure for simple values and compacts the submission metrics", () => {
    window.history.replaceState(null, "", "/parameter-submissions");
    const simpleParameter = initialState.parameters.find((parameter) => parameter.name === "fast_charge_current_limit_ma");
    expect(simpleParameter).toBeDefined();
    const simpleRound = {
      ...initialState.parameterSubmissionRounds[0],
      id: "PRS-simple",
      projectId: simpleParameter!.projectId,
      projectName: "Aurora 量产平台",
      submitter: "Zhao Heng",
      createdAt: "刚刚",
      items: [
        {
          requestId: "PRQ-simple",
          parameterId: simpleParameter!.id,
          name: simpleParameter!.name,
          module: simpleParameter!.module,
          currentValue: "3850",
          targetValue: "3200",
          unit: simpleParameter!.unit,
          risk: simpleParameter!.risk,
          reason: "同步推荐电流限制"
        }
      ]
    };

    render(
      <App
        initialAppState={{
          ...initialState,
          currentUserId: "u-zhao-heng",
          activeRoleId: "hardware-user",
          parameterSubmissionRounds: [simpleRound]
        }}
      />
    );

    const detail = screen.getByRole("region", { name: "提交轮次详情" });
    const simpleCard = within(detail).getByText("fast_charge_current_limit_ma").closest(".submission-diff-card");

    expect(simpleCard).toHaveClass("submission-diff-card--history");
    expect(simpleCard).not.toHaveClass("submission-diff-card--history-complex");
    expect(simpleCard!.querySelector(".diff-values")).not.toBeInTheDocument();
    expect(simpleCard!.querySelector(".history-submission-code-grid")).not.toBeInTheDocument();
    expect(within(simpleCard as HTMLElement).getAllByText("数值配置")).toHaveLength(2);
    expect(within(simpleCard as HTMLElement).getByText("当前 1 行")).toBeInTheDocument();
    expect(within(simpleCard as HTMLElement).getByText("目标 1 行")).toBeInTheDocument();

    const diff = simpleCard!.querySelector<HTMLElement>(".history-submission-diff");
    expect(diff).toBeInTheDocument();
    expect(diff!.querySelector(".submission-preview-diff-row[data-kind='remove'] code")).toHaveTextContent("3850 mA");
    expect(diff!.querySelector(".submission-preview-diff-row[data-kind='add'] code")).toHaveTextContent("3200 mA");

    const css = readFileSync("src/styles.css", "utf8");
    expect(readCssBlock(css, ".submission-history-summary")).toContain("display: grid;");
    expect(readCssBlock(css, ".submission-history-summary")).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(readCssBlock(css, ".submission-history-summary .metric-card")).toContain("min-height: 96px;");
    expect(readCssBlock(css, ".submission-history-summary .metric-bar")).toContain("height: 4px;");
  });

  it("keeps row-level detail view available without exposing a standalone comparison action", () => {
    window.history.replaceState(null, "", "/parameters");

    renderAppForCurrentPath();

    const topbar = document.querySelector(".topbar") as HTMLElement;
    expect(within(topbar).queryByRole("button", { name: /跨项目对比/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "对比参数" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "跨项目对比" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));

    expect(window.location.pathname).toBe("/parameters");
    expect(screen.getByRole("dialog", { name: /fast_charge_current_limit_ma/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "跨项目对比" })).toBeInTheDocument();
  });

  it("renders a no-entry state for the retired standalone comparison route without redirecting", () => {
    window.history.replaceState(null, "", "/parameter-comparison?project=nebula&module=Battery%20Safety");

    renderAppForCurrentPath();

    expect(window.location.pathname).toBe("/parameter-comparison");
    expect(screen.getByRole("region", { name: "页面不可用" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "页面不可用" })).toBeInTheDocument();
    expect(screen.queryByLabelText("打开 WiseAgent")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "参数工作台" }));

    expect(window.location.pathname).toBe("/parameters");
  });

  it("requires a rejection reason when an admin sends a parameter request back", () => {
    window.history.replaceState(null, "", "/parameter-review");

    render(<App initialAppState={adminState} />);

    const reviewDetail = screen.getByRole("complementary", { name: "审阅详情" });
    const advanceButton = within(reviewDetail).getByRole("button", { name: "推进流程" });
    const rejectButton = within(reviewDetail).getByRole("button", { name: "打回修改" });

    expect(advanceButton).toHaveClass("full");
    expect(rejectButton).toHaveClass("full");

    fireEvent.click(rejectButton);

    const dialog = screen.getByRole("alertdialog", { name: "打回修改" });
    const reasonInput = within(dialog).getByLabelText("打回原因");
    fireEvent.change(reasonInput, { target: { value: "热测试数据缺少高温工况说明，需要补充后再提交。" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "提交打回" }));

    expect(screen.queryByRole("dialog", { name: "打回修改" })).not.toBeInTheDocument();
    expect(reviewDetail).toHaveTextContent("已打回");
    expect(reviewDetail).toHaveTextContent("热测试数据缺少高温工况说明，需要补充后再提交。");
  });

  it("shows parameter initialization reviews and approves them", () => {
    window.history.replaceState(null, "", "/parameter-review");
    const state = appReducer(initialState, {
      type: "SUBMIT_PARAMETER_INITIALIZATION",
      draft: {
        projectName: "Zephyr",
        projectCode: "ZEP",
        ownerUserId: "u-xu-yun",
        sourceProjectIds: ["aurora", "nebula"],
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: ["nebula"],
        selectedModules: ["Battery Safety"],
        selectedRisks: ["Medium"],
        selectedParameterIds: ["battery-temp-target"],
        notes: "Initialize from Aurora"
      }
    });

    render(<App initialAppState={{ ...state, activeRoleId: "admin" }} />);

    const reviewTable = screen.getByRole("table");
    expect(within(reviewTable).getByText("参数初始化")).toBeInTheDocument();
    expect(within(reviewTable).getAllByText("Zephyr").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "通过初始化" }));

    fireEvent.click(screen.getByRole("tab", { name: "历史审阅" }));

    const approvedReviewTable = screen.getByRole("table");
    expect(within(approvedReviewTable).getByText("参数初始化")).toBeInTheDocument();
    expect(within(approvedReviewTable).getByText("已通过")).toBeInTheDocument();
  });

  it("prevents ordinary parameter submissions while initialization is pending review", () => {
    const pendingState = appReducer(initialState, {
      type: "SUBMIT_PARAMETER_INITIALIZATION",
      draft: {
        projectName: "Zephyr",
        projectCode: "ZEP",
        ownerUserId: "u-xu-yun",
        sourceProjectIds: ["aurora", "nebula"],
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: ["nebula"],
        selectedModules: ["Battery Safety"],
        selectedRisks: ["Medium"],
        selectedParameterIds: ["battery-temp-target"],
        notes: "Initialize from Aurora"
      }
    });
    const pendingProjectId = pendingState.parameterInitializationReviews[0].projectId;

    window.history.replaceState(null, "", `/parameters?project=${pendingProjectId}`);

    render(<App initialAppState={{ ...pendingState, activeProjectId: "aurora", activeRoleId: "user" }} />);

    expect(screen.getByText("初始化待审阅")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /提交本轮|鎻愴氦鏈疆/ })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: /检索参数表|妫€绱㈠弬鏁拌〃/ })).toBeInTheDocument();
    expect(screen.queryByText("fast_charge_current_limit_ma")).not.toBeInTheDocument();
  });

  it("shows an approved initialization project in the parameters project selector", () => {
    const submittedState = appReducer({ ...initialState, activeRoleId: "admin" }, {
      type: "SUBMIT_PARAMETER_INITIALIZATION",
      draft: {
        projectName: "Zephyr",
        projectCode: "ZEP",
        ownerUserId: "u-xu-yun",
        sourceProjectIds: ["aurora", "nebula"],
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: ["nebula"],
        selectedModules: ["Battery Safety"],
        selectedRisks: ["Medium"],
        selectedParameterIds: ["battery-temp-target"],
        notes: "Initialize from Aurora"
      }
    });
    const approvedState = appReducer(submittedState, {
      type: "APPROVE_PARAMETER_INITIALIZATION",
      reviewId: submittedState.parameterInitializationReviews[0].id
    });

    window.history.replaceState(null, "", "/parameters");

    render(<App initialAppState={{ ...approvedState, activeRoleId: "user" }} />);

    const projectSelect = screen.getByRole("combobox", { name: "项目" });
    changeSelectValue(projectSelect, "Zephyr");

    expectSelectValue(projectSelect, "zep");
    expect(window.location.search).toContain("project=zep");
    expect(within(screen.getByRole("table")).getByText("battery_temp_target_c")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("待项目确认")).toBeInTheDocument();
  });

  it("keeps approved runtime project queries on the retired comparison no-entry route", () => {
    const submittedState = appReducer({ ...initialState, activeRoleId: "admin" }, {
      type: "SUBMIT_PARAMETER_INITIALIZATION",
      draft: {
        projectName: "Zephyr",
        projectCode: "ZEP",
        ownerUserId: "u-xu-yun",
        sourceProjectIds: ["aurora", "nebula"],
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: ["nebula"],
        selectedModules: ["Battery Safety"],
        selectedRisks: ["Medium"],
        selectedParameterIds: ["battery-temp-target"],
        notes: "Initialize from Aurora"
      }
    });
    const approvedState = appReducer(submittedState, {
      type: "APPROVE_PARAMETER_INITIALIZATION",
      reviewId: submittedState.parameterInitializationReviews[0].id
    });
    const approvedProjectId = approvedState.parameterInitializationReviews[0].projectId;

    window.history.replaceState(null, "", `/parameter-comparison?project=${approvedProjectId}`);

    render(<App initialAppState={{ ...approvedState, activeRoleId: "user" }} />);

    expect(window.location.pathname).toBe("/parameter-comparison");
    expect(window.location.search).toContain(`project=${approvedProjectId}`);
    expect(screen.getByRole("region", { name: "页面不可用" })).toBeInTheDocument();
  });

  it("does not duplicate the active review workflow step in the detail timeline", () => {
    window.history.replaceState(null, "", "/parameter-review");

    renderAppForCurrentPath();

    const reviewDetail = screen.getByRole("complementary", { name: "审阅详情" });

    expect(within(reviewDetail).getAllByText("硬件MDE检视")).toHaveLength(1);
    expect(reviewDetail).toHaveTextContent("软件MDE检视");
    expect(reviewDetail).toHaveTextContent("软件开发人员合入");
    expect(reviewDetail).toHaveTextContent("软件 MDE：Sun Mei。");
    expect(reviewDetail).toHaveTextContent("软件开发人员：Chen Na。");
    expect(reviewDetail).not.toHaveTextContent("Committer");
    expect(reviewDetail).not.toHaveTextContent("User");
    expect(reviewDetail).toHaveTextContent("当前处理人：Wang Jie。");
  });

  it("clearly marks the active review workflow step", () => {
    window.history.replaceState(null, "", "/parameter-review");

    renderAppForCurrentPath();

    const reviewDetail = screen.getByRole("complementary", { name: "审阅详情" });
    const currentMarker = within(reviewDetail).getByText("当前流程");
    const currentStep = currentMarker.closest(".vertical-timeline-item");

    expect(currentStep).toHaveClass("vertical-timeline-item--current");
    expect(currentStep).toHaveTextContent("流程 1");
    expect(currentStep).toHaveTextContent("硬件MDE检视");
    expect(reviewDetail).not.toHaveTextContent("硬件Committer检视");
    expect(currentStep).toHaveTextContent("当前处理人：Wang Jie。");
    expect(within(reviewDetail).getAllByText("当前流程")).toHaveLength(1);
  });

  it("consumes parameter review context from project and module query strings", () => {
    window.history.replaceState(null, "", "/parameter-review?project=aurora&module=Battery%20Safety");

    renderAppForCurrentPath();

    const reviewDetail = screen.getByRole("complementary", { name: "审阅详情" });

    expect(reviewDetail).toHaveTextContent("Battery Safety");
    expect(reviewDetail).toHaveTextContent("电池目标温度下调");
    expect(reviewDetail).not.toHaveTextContent(/PRQ-\d+/);
  });

  it("falls back to module-only matching for parameter review query strings", () => {
    window.history.replaceState(null, "", "/parameter-review?module=Charging%20Policy");

    renderAppForCurrentPath();

    const reviewDetail = screen.getByRole("complementary", { name: "审阅详情" });

    expect(reviewDetail).toHaveTextContent("Charging Policy");
    expect(reviewDetail).toHaveTextContent("快充输入电流调整");
    expect(reviewDetail).not.toHaveTextContent(/PRQ-\d+/);
  });

  it("omits the duplicate in-page header on the parameter review workbench", () => {
    window.history.replaceState(null, "", "/parameter-review");

    renderAppForCurrentPath();

    expect(document.querySelector(".workbench-page > .page-header")).not.toBeInTheDocument();
    expect(document.querySelector(".topbar-title")).toHaveTextContent("参数管理员工作台");
  });

  it("combines parameter review filters into the table headers", () => {
    window.history.replaceState(null, "", "/parameter-review");

    renderAppForCurrentPath();

    const table = screen.getByRole("table");
    const headerRow = within(table).getAllByRole("row")[0];

    expect(document.querySelector(".review-queue-filters")).not.toBeInTheDocument();
    expect(within(headerRow).getByRole("button", { name: "筛选项目" })).toBeInTheDocument();
    expect(within(headerRow).getByRole("button", { name: "筛选模块" })).toBeInTheDocument();
    expect(within(headerRow).getByRole("button", { name: "筛选提交人" })).toBeInTheDocument();

    fireEvent.click(within(headerRow).getByRole("button", { name: "筛选提交人" }));
    fireEvent.click(within(headerRow).getByRole("checkbox", { name: "H. Zhao" }));

    expect(within(headerRow).getByRole("button", { name: "筛选提交人" })).toHaveClass("active");
    expect(within(table).getByText("快充输入电流调整")).toBeInTheDocument();
    expect(within(table).queryByText("电池目标温度下调")).not.toBeInTheDocument();

    const styles = readFileSync("src/styles.css", "utf8");
    const reviewTableContainerRule = readCssBlock(styles, ".review-table-wrap [data-slot=\"table-container\"]");
    expect(reviewTableContainerRule).toContain("overflow-x: auto;");
    expect(readCssBlock(styles, ".review-table-wrap table")).toContain("min-width:");
  });

  it("keeps parameter review header filters only on project, module, submitter, and status", () => {
    window.history.replaceState(null, "", "/parameter-review");

    renderAppForCurrentPath();

    const table = screen.getByRole("table");
    const checks: Array<[string, string, string]> = [
      ["项目", "筛选项目", "Aurora 量产平台"],
      ["模块", "筛选模块", "Charging Policy"],
      ["提交人", "筛选提交人", "H. Zhao"],
      ["状态", "筛选状态", "硬件Committer检视"]
    ];

    for (const [headerName, buttonName, optionName] of checks) {
      const header = within(table).getByRole("columnheader", { name: new RegExp(headerName) });
      fireEvent.click(within(header).getByRole("button", { name: buttonName }));
      expect(within(header).getByRole("checkbox", { name: optionName })).toBeInTheDocument();
      fireEvent.click(within(header).getByRole("button", { name: buttonName }));
    }

    expect(screen.queryByRole("button", { name: "筛选请求编号" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选变更" })).not.toBeInTheDocument();

    const statusHeader = within(table).getByRole("columnheader", { name: /状态/ });
    fireEvent.click(within(statusHeader).getByRole("button", { name: "筛选状态" }));
    fireEvent.click(within(statusHeader).getByRole("checkbox", { name: "硬件Committer检视" }));
    const visibleBodyRows = Array.from(table.querySelectorAll("tbody tr"));
    expect(visibleBodyRows.length).toBeGreaterThan(0);
    expect(visibleBodyRows.every((row) => row.textContent?.includes("硬件MDE检视"))).toBe(true);
    expect(within(table).getByText("快充输入电流调整")).toBeInTheDocument();
  });

  it("does not expose request identifiers in the parameter review UI", () => {
    window.history.replaceState(null, "", "/parameter-review");

    renderAppForCurrentPath();

    const requestIdPattern = /PRQ-\d+|PRS-\d+/;

    expect(screen.queryByRole("columnheader", { name: "请求编号" })).not.toBeInTheDocument();
    expect(screen.getByRole("table")).not.toHaveTextContent(requestIdPattern);
    expect(screen.getByRole("complementary", { name: "审阅详情" })).not.toHaveTextContent(requestIdPattern);
  });

  it("keeps Excel-style header filters next to their header labels", () => {
    const styles = readFileSync("src/styles.css", "utf8");
    const reviewHeaderRule = readCssBlock(styles, ".review-column-filter-head");

    expect(reviewHeaderRule).toContain("display: inline-flex;");
    expect(reviewHeaderRule).toContain("gap: 4px;");
  });

  it("switches the review table between pending requests and role-specific review history", () => {
    window.history.replaceState(null, "", "/parameter-review");

    renderAppForCurrentPath();

    const pendingTab = screen.getByRole("tab", { name: "待审阅" });
    const historyTab = screen.getByRole("tab", { name: "历史审阅" });
    const pendingTable = screen.getByRole("table");

    expect(pendingTab).toHaveAttribute("aria-selected", "true");
    expect(within(pendingTable).getByText("快充输入电流调整")).toBeInTheDocument();
    expect(within(pendingTable).queryByText("SOC 平滑窗口调整")).not.toBeInTheDocument();

    fireEvent.click(historyTab);

    const historyTable = screen.getByRole("table");
    expect(historyTab).toHaveAttribute("aria-selected", "true");
    expect(within(historyTable).getByText("SOC 平滑窗口调整")).toBeInTheDocument();
    expect(within(historyTable).queryByText("快充输入电流调整")).not.toBeInTheDocument();

    fireEvent.click(within(historyTable).getByText("SOC 平滑窗口调整"));

    const reviewDetail = screen.getByRole("complementary", { name: "审阅详情" });
    expect(reviewDetail).toHaveTextContent("SOC 平滑窗口调整");
    expect(reviewDetail).not.toHaveTextContent(/PRQ-\d+/);
    expect(within(reviewDetail).queryByRole("button", { name: "推进流程" })).not.toBeInTheDocument();
    expect(within(reviewDetail).queryByRole("button", { name: "打回修改" })).not.toBeInTheDocument();
  });

  it("labels and aligns the review change column", () => {
    window.history.replaceState(null, "", "/parameter-review");

    renderAppForCurrentPath();

    expect(screen.getByRole("columnheader", { name: "变更" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "建议变更" })).not.toBeInTheDocument();

    const changeCell = screen.getByRole("table").querySelector<HTMLTableCellElement>("td.change-cell");

    expect(changeCell).toBeInTheDocument();
    expect(changeCell?.firstElementChild).toHaveClass("value-change");
  });

  it("opens submission details from the review table change column", () => {
    window.history.replaceState(null, "", "/parameter-review");

    renderAppForCurrentPath();

    const row = screen.getByRole("row", { name: /快充输入电流调整/ });
    fireEvent.click(within(row).getByRole("button", { name: "查看 快充输入电流调整 提交详情" }));

    const dialog = screen.getByRole("dialog", { name: "提交详情" });
    expect(dialog).toHaveTextContent("fast_charge_current_limit_ma");
    expect(dialog).not.toHaveTextContent(/PRQ-\d+|PRS-\d+/);
    expect(dialog.querySelector(".diff-values")).not.toBeInTheDocument();
    expect(dialog.querySelector(".history-submission-diff")).toBeInTheDocument();
    expect(dialog.querySelector(".submission-preview-diff-row[data-kind='remove'] code")).toHaveTextContent("3800 mA");
    expect(dialog.querySelector(".submission-preview-diff-row[data-kind='add'] code")).toHaveTextContent("3200 mA");
  });

  it("summarizes complex parameter changes in the review table instead of flattening config values", () => {
    window.history.replaceState(null, "", "/parameter-review");
    const complexParameter = initialState.parameters.find((parameter) => parameter.name === "dts_fast_charge_profile_matrix");
    expect(complexParameter).toBeDefined();
    const complexTargetValue = complexParameter!.currentValue.replace('"burst"', '"boost"');
    const complexRequest = {
      ...initialState.changeRequests[0],
      id: "PRQ-complex-table",
      submissionRoundId: "PRS-complex-table",
      projectId: complexParameter!.projectId,
      parameterId: complexParameter!.id,
      module: complexParameter!.module,
      title: complexParameter!.name,
      currentValue: complexParameter!.currentValue,
      targetValue: complexTargetValue,
      valueKind: "complex" as const,
      submitter: "Xu Yun",
      status: "硬件Committer检视" as const
    };

    render(
      <App
        initialAppState={{
          ...initialState,
          activeRoleId: "admin",
          changeRequests: [complexRequest, ...initialState.changeRequests]
        }}
      />
    );

    const row = screen.getByRole("row", { name: /dts_fast_charge_profile_matrix/ });
    const summary = row.querySelector(".parameter-value-summary");

    expect(summary).toBeInTheDocument();
    expect(summary).toHaveTextContent("复杂配置");
    expect(summary).toHaveTextContent("fast-charge-profile-matrix");
    expect(summary).toHaveTextContent("4 行 · 当前与目标不同");
    expect(summary?.getAttribute("title") ?? "").not.toContain('"burst"');
    expect(summary?.getAttribute("title") ?? "").not.toContain('"boost"');
    expect(row).not.toHaveTextContent('"burst"');
    expect(row).not.toHaveTextContent('"boost"');
  });

  it("keeps scalar review changes with trailing whitespace in the simple value layout", () => {
    window.history.replaceState(null, "", "/parameter-review");
    const scalarParameter = initialState.parameters.find((parameter) => parameter.name === "battery_health_reserve_pct");
    expect(scalarParameter).toBeDefined();
    const scalarRequest = {
      ...initialState.changeRequests[0],
      id: "PRQ-scalar-whitespace",
      submissionRoundId: "PRS-scalar-whitespace",
      projectId: scalarParameter!.projectId,
      parameterId: scalarParameter!.id,
      module: scalarParameter!.module,
      title: scalarParameter!.name,
      currentValue: "15",
      targetValue: "13\n",
      submitter: "Xu Yun",
      status: "硬件Committer检视" as const
    };

    render(
      <App
        initialAppState={{
          ...initialState,
          activeRoleId: "admin",
          changeRequests: [scalarRequest, ...initialState.changeRequests]
        }}
      />
    );

    const row = screen.getByRole("row", { name: /battery_health_reserve_pct/ });
    const changeButton = within(row).getByRole("button", { name: "查看 battery_health_reserve_pct 提交详情" });

    expect(changeButton.querySelector(".parameter-value-summary")).not.toBeInTheDocument();
    expect(changeButton.querySelector(".value-change__values")).toHaveTextContent("15");
    expect(changeButton.querySelector(".value-change__values")).toHaveTextContent("13");
    expect(changeButton).not.toHaveTextContent("复杂配置");
  });

  it("renders mixed simple and complex review submission details with the history diff layout", () => {
    window.history.replaceState(null, "", "/parameter-review");
    const simpleParameter = initialState.parameters.find((parameter) => parameter.name === "soc_estimation_smoothing");
    const complexParameter = initialState.parameters.find((parameter) => parameter.name === "dts_fast_charge_profile_matrix");
    expect(simpleParameter).toBeDefined();
    expect(complexParameter).toBeDefined();
    const complexTargetValue = complexParameter!.currentValue.replace('"burst"', '"boost"');
    const mixedRound = {
      ...initialState.parameterSubmissionRounds[0],
      id: "PRS-mixed",
      projectId: complexParameter!.projectId,
      projectName: "Aurora 量产平台",
      submitter: "Admin",
      createdAt: "刚刚",
      status: "硬件Committer检视" as const,
      summary: "本轮提交包含 2 个参数修改。",
      items: [
        {
          requestId: "PRQ-mixed-complex",
          parameterId: complexParameter!.id,
          name: complexParameter!.name,
          module: complexParameter!.module,
          currentValue: complexParameter!.currentValue,
          targetValue: complexTargetValue,
          unit: complexParameter!.unit,
          risk: complexParameter!.risk,
          valueKind: complexParameter!.valueKind,
          reason: "同步 DTS 矩阵配置"
        },
        {
          requestId: "PRQ-mixed-simple",
          parameterId: simpleParameter!.id,
          name: simpleParameter!.name,
          module: simpleParameter!.module,
          currentValue: "0.82",
          targetValue: "0.88",
          unit: simpleParameter!.unit,
          risk: simpleParameter!.risk,
          valueKind: simpleParameter!.valueKind,
          reason: "同步 SOC 平滑系数"
        }
      ]
    };
    const mixedRequests = mixedRound.items.map((item, index) => ({
      ...initialState.changeRequests[index],
      id: item.requestId,
      submissionRoundId: mixedRound.id,
      projectId: mixedRound.projectId,
      parameterId: item.parameterId,
      module: item.module,
      title: item.name,
      currentValue: item.currentValue,
      targetValue: item.targetValue,
      submitter: mixedRound.submitter,
      status: "硬件Committer检视" as const
    }));

    render(
      <App
        initialAppState={{
          ...initialState,
          activeRoleId: "admin",
          parameterSubmissionRounds: [mixedRound, ...initialState.parameterSubmissionRounds],
          changeRequests: [...mixedRequests, ...initialState.changeRequests]
        }}
      />
    );

    const row = screen.getByRole("row", { name: /dts_fast_charge_profile_matrix/ });
    fireEvent.click(within(row).getByRole("button", { name: "查看 dts_fast_charge_profile_matrix 提交详情" }));

    const dialog = screen.getByRole("dialog", { name: "提交详情" });
    expect(dialog.querySelector(".submission-dialog")).toHaveClass("submission-dialog--wide");
    expect(within(dialog).getByText("dts_fast_charge_profile_matrix")).toBeInTheDocument();
    expect(within(dialog).getByText("soc_estimation_smoothing")).toBeInTheDocument();
    expect(dialog.querySelector(".diff-values")).not.toBeInTheDocument();
    expect(dialog.querySelectorAll(".history-submission-diff")).toHaveLength(2);
    expect(dialog.querySelector(".submission-preview-diff-row[data-kind='remove'] code")).toHaveTextContent('"burst"');
    expect(dialog.querySelector(".submission-preview-diff-row[data-kind='add'] code")).toHaveTextContent('"boost"');
    expect(dialog).toHaveTextContent("0.82 ratio");
    expect(dialog).toHaveTextContent("0.88 ratio");

    const css = readFileSync("src/styles.css", "utf8");
    expect(readCssBlock(css, ".submission-detail-dialog .history-submission-diff")).toContain("max-height: 340px;");
  });

  it("opens synthesized submission details when a review row has no stored submission round", () => {
    window.history.replaceState(null, "", "/parameter-review");

    renderAppForCurrentPath();

    const row = screen.getByRole("row", { name: /预充阶段电压上限微调/ });
    fireEvent.click(within(row).getByRole("button", { name: "查看 预充阶段电压上限微调 提交详情" }));

    const dialog = screen.getByRole("dialog", { name: "提交详情" });
    expect(dialog).toHaveTextContent("预充阶段电压上限微调");
    expect(dialog).not.toHaveTextContent(/PRQ-\d+|PRS-\d+/);
  });

  it("opens the log upload dialog only after upload simulation", () => {
    window.history.replaceState(null, "", "/logs");

    renderAppForCurrentPath();

    expect(screen.queryByRole("dialog", { name: "上传日志" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /上传新日志/ }));

    expect(screen.getByRole("dialog", { name: "上传日志" })).toBeInTheDocument();
  });

  it("keeps the log upload action available while API log hydration is empty", async () => {
    window.history.replaceState(null, "", "/logs?project=aurora");

    render(
      <App
        initialAppState={{ ...userState, activeProjectId: "aurora", logs: [], archivedLogIds: [] }}
        runtimeMode="api"
        authClient={createResolvedAdminAuthClient()}
        parameterRepository={createAppParameterRepository()}
        logAnalysisRepository={createAppLogAnalysisRepository()}
        debuggingGateway={createAppDebuggingGateway()}
      />
    );

    await waitFor(() => {
      expect(document.querySelector(".topbar-page-actions .button.primary")).toBeInTheDocument();
    });
  });

  it("switches log analysis content from clickable history records", () => {
    window.history.replaceState(null, "", "/logs");

    renderAppForCurrentPath();

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    expect(within(history).getByRole("button", { name: /charging_thermal_trace_20260504\.log/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("快充阶段电池包温升过快，触发热降额链路。")).toBeInTheDocument();
    expect(screen.getByText("日志分析证据链")).toBeInTheDocument();
    expect(screen.getByText("关联处置：下调快充电流上限")).toBeInTheDocument();

    fireEvent.click(within(history).getByRole("button", { name: /usb_pd_negotiation_20260503\.log/ }));

    expect(screen.getByText("PD 协商在 9V/3A 档位稳定完成，未出现握手重试。")).toBeInTheDocument();
    expect(screen.getByText("关联处置：保留 9V/3A 充电档位")).toBeInTheDocument();
    expect(screen.getAllByText(/PD_CTRL Accept profile 9V\/3A/)).toHaveLength(2);

    fireEvent.click(within(history).getByRole("button", { name: /thermal_snapshot\.bin/ }));

    expect(screen.getByText("不支持的二进制热快照格式。")).toBeInTheDocument();
    expect(screen.getByText("关联处置：请重新上传 .log、.txt 或 .json 文本日志。")).toBeInTheDocument();
  });

  it("shows a log analysis evidence chain instead of suggested actions", () => {
    window.history.replaceState(null, "", "/logs");

    renderAppForCurrentPath();

    const analysis = screen.getByRole("region", { name: "分析结果" });
    expect(within(analysis).getByText("原始日志")).toBeInTheDocument();
    expect(within(analysis).getByText("日志分析证据链")).toBeInTheDocument();
    expect(within(analysis).getByText("证据 01")).toBeInTheDocument();
    expect(within(analysis).getByText("证据 02")).toBeInTheDocument();
    expect(within(analysis).getByText("证据 03")).toBeInTheDocument();
    expect(within(analysis).getByText("battery_pack_temp=46.8C over soft_limit=45C")).toBeInTheDocument();
    expect(within(analysis).getByText(/#20 10:24:01 WARN \[CHG_THERMAL\]/)).toBeInTheDocument();
    expect(within(analysis).getByText("电池包温度越过 45°C 软阈值，确认热异常触发点。")).toBeInTheDocument();
    expect(within(analysis).queryByText("建议动作")).not.toBeInTheDocument();
    expect(within(analysis).queryByText("应用缓解措施")).not.toBeInTheDocument();
  });

  it("uses Chinese visible copy on every page surface", () => {
    const pageChecks = [
      {
        path: "/",
        present: [
          "让业务流程更智能、更高效、更可控",
          "雷泽把参数管理、设备调试和日志分析连接成一条可审阅工作流",
          "参数管理",
          "日志分析",
          "调试平台"
        ],
        absent: ["WiseEff Prototype", "Linear is a better way", "Powering the world's best product teams", "Issue tracking you'll enjoy using"]
      },
      {
        path: "/parameter-home",
        present: ["热榜", "参数更新趋势", "各项目参数更新情况", "参数修改", "参数审阅"],
        absent: [
          "推荐依据",
          "保留原看板指标，用来解释工作台行动排序",
          "参数总量",
          "管理项目总数",
          "修改频次",
          "开发人员总数",
          "WiseEff Prototype",
          "Linear is a better way",
          "Powering the world's best product teams",
          "Issue tracking you'll enjoy using",
          "热门模块",
          "关键参数变化",
          "审核合入情况",
          "对比分析"
        ]
      },
      {
        path: "/parameters",
        present: ["重要性", "参数名称", "当前 → 推荐", "范围 / 单位", "更新时间"],
        absent: ["Filters", "All", "Current", "Range / Unit", "Importance", "Updated"]
      },
      {
        path: "/parameter-comparison",
        present: ["页面不可用", "参数工作台"],
        absent: [
          "Parameters",
          "Comparison",
          "AUR-Prod",
          "NEB-RD",
          "差异参数",
          "高重要性差异",
          "仅看差异",
          "当前选择 AUR-Prod",
          "当前选择 NEB-RD",
          "需要审阅后同步",
          "WiseAgent 已生成风险说明",
          "生产 vs 预发",
          "Export",
          "Sync Selected",
          "Parameter Key",
          "OpsAgent",
          "OpsAgent Insights",
          "View Historical Latency"
        ]
      },
      {
        path: "/parameter-review",
        present: ["待审阅", "历史审阅", "变更", "变更历史", "当前", "提交人"],
        absent: ["Filter Queue", "Pending Requests", "Req ID", "Submitter", "Proposed Change", "Change History", "Targeting module"]
      },
      {
        path: "/parameter-admin",
        present: ["项目参数管理后台", "项目共享参数库", "批量参数导入", "共享参数"],
        absent: ["项目参数 Admin", "items", "events"]
      },
      {
        path: "/logs",
        present: ["上传新日志", "分析结果", "原始日志", "日志分析证据链"],
        absent: ["Unsupported Log Format", "Drag and drop log files here", "Analysis Results", "Suggested Actions", "Apply Mitigation", "建议动作", "应用缓解措施"]
      },
      {
        path: "/log-admin",
        present: ["日志分析管理后台", "日志分析记录"],
        absent: ["日志分析 Admin", "Failed", "Complete", "Processing"]
      },
      {
        path: "/debugging",
        present: ["页面暂时不可用"],
        absent: ["实时可调参数"]
      },
      {
        path: "/debugging-admin",
        present: ["调试管理后台", "可调节点"],
        absent: ["参数调试 Admin", "Ready"]
      }
    ];

    pageChecks.forEach(({ path, present, absent }) => {
      cleanup();
      window.history.replaceState(null, "", path);
      renderAppForCurrentPath();

      present.forEach((text) => {
        expect(document.body).toHaveTextContent(text);
      });
      absent.forEach((text) => {
        expect(document.body).not.toHaveTextContent(text);
      });
    });
  });

  it("uses Chinese helper copy in the global chrome", () => {
    window.history.replaceState(null, "", "/parameters");

    renderAppForCurrentPath();

    expect(screen.getByText("雷泽")).toBeInTheDocument();
    expect(screen.getByText("Driven by AI")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Context-Aware Insight");
    expect(screen.queryByPlaceholderText("Ask OpsAgent...")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("OpsAgent");
  });

  it("renders the parameter debugging workspace route as unavailable", () => {
    window.history.replaceState(null, "", "/debugging");

    renderAppForCurrentPath();

    expect(screen.getByRole("heading", { level: 2, name: "页面暂时不可用" })).toBeInTheDocument();
    expect(screen.queryByText("实时可调参数")).not.toBeInTheDocument();
  });

  it("removes the global project selector from review and parameter admin topbars", () => {
    ["/parameter-review", "/parameter-admin"].forEach((path) => {
      cleanup();
      window.history.replaceState(null, "", path);
      renderAppForCurrentPath();

      const topbar = document.querySelector<HTMLElement>(".topbar");
      expect(topbar).not.toBeNull();
      expect(within(topbar as HTMLElement).queryByRole("combobox")).not.toBeInTheDocument();
    });
  });

  it("keeps the platform homepage as the root surface", () => {
    renderAppForCurrentPath();

    expect(screen.getByRole("heading", { name: "让业务流程更智能、更高效、更可控" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "智能参数管理" })).not.toBeInTheDocument();
  });

  it("provides a left-bottom feedback entry for internal testing feedback", () => {
    window.history.replaceState(null, "", "/parameter-home");

    renderAppForCurrentPath();

    const feedbackEntry = screen.getByRole("button", { name: "问题反馈" });
    expect(feedbackEntry).toBeInTheDocument();
    expect(feedbackEntry.closest(".feedback-entry")).toBeInTheDocument();
    const css = readFileSync("src/styles.css", "utf8");
    const navItemCss = readCssBlock(css, ".nav-item");
    const feedbackEntryCss = readCssBlock(css, ".feedback-entry");
    expect(css).toMatch(/\.utility-nav \{\r?\n  flex: 0 0 auto;/);
    expect(css).toMatch(/\.utility-nav \{\r?\n\s+display: block;/);
    expect(navItemCss).toContain("justify-content: flex-start;");
    expect(navItemCss).toContain("height: auto;");
    expect(feedbackEntryCss).toContain("align-items: flex-start;");

    fireEvent.click(feedbackEntry);

    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    expect(within(dialog).getByLabelText("反馈类型")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("问题描述")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "提交反馈" })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("问题描述"), { target: { value: "导出按钮需要提示成功状态" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "提交反馈" }));

    expect(screen.getByText("反馈已记录，内测团队会结合页面路径和问题类型跟进。")).toBeInTheDocument();
  });

  it("toggles and remembers the app sidebar collapsed state", () => {
    window.history.replaceState(null, "", "/parameters");

    const { unmount } = renderAppForCurrentPath();

    const sidebar = screen.getByRole("complementary", { name: "主导航侧边栏" });
    expect(sidebar).toHaveClass("sidebar-expanded");
    expect(screen.getByText("雷泽")).toBeInTheDocument();

    const collapseButton = screen.getByRole("button", { name: "收起侧边栏" });
    fireEvent.click(collapseButton);

    expect(sidebar).toHaveClass("sidebar-collapsed");
    expect(localStorage.getItem("wiseeff.sidebar.collapsed")).toBe("true");
    expect(screen.getByRole("button", { name: "展开侧边栏" })).toBeInTheDocument();

    unmount();
    renderAppForCurrentPath();

    expect(screen.getByRole("complementary", { name: "主导航侧边栏" })).toHaveClass("sidebar-collapsed");
    expect(localStorage.getItem("wiseeff.sidebar.collapsed")).toBe("true");
  });

  it("keeps the feedback dialog wide enough for form and screenshot capture columns", () => {
    window.history.replaceState(null, "", "/parameter-home");

    renderAppForCurrentPath();

    fireEvent.click(screen.getByRole("button", { name: "问题反馈" }));

    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    expect(dialog).toHaveClass("feedback-dialog");
    expect(within(dialog).getByText("问题信息")).toBeInTheDocument();
    expect(within(dialog).getByText("粘贴上传截图")).toBeInTheDocument();

    const css = readFileSync("src/styles.css", "utf8");
    const feedbackDialogCss = readCssBlock(css, ".feedback-dialog");
    const feedbackDialogFormCss = readCssBlock(css, ".feedback-dialog form");
    const feedbackContextCss = readCssBlock(css, ".feedback-context");
    const feedbackLayoutCss = readCssBlock(css, ".feedback-layout");
    const feedbackActionsCss = readCssBlock(css, ".feedback-dialog .dialog-actions");

    expect(feedbackDialogCss).toContain("max-width: min(900px, calc(100vw - 48px));");
    expect(feedbackDialogCss).toContain("overflow: hidden;");
    expect(feedbackDialogCss).toContain("padding: 0;");
    expect(feedbackDialogFormCss).toContain("display: grid;");
    expect(feedbackDialogFormCss).toContain("overflow: hidden;");
    expect(feedbackContextCss).toContain("justify-self: center;");
    expect(feedbackContextCss).toContain("width: calc(100% - 48px);");
    expect(feedbackLayoutCss).toContain("grid-template-columns: minmax(300px, 1fr) minmax(280px, 360px);");
    expect(feedbackLayoutCss).toContain("overflow: hidden;");
    expect(feedbackActionsCss).toContain("margin: 0;");
    expect(feedbackActionsCss).toContain("overflow: hidden;");
    expect(css).toMatch(/\.feedback-section \[data-slot="textarea"\] \{\r?\n\s+min-height: 112px;/);
    expect(css).toMatch(/\.feedback-screenshot-preview \{\r?\n\s+min-height: 132px;/);
  });

  it("includes responsive and reduced-motion styles for the log analysis workbench", () => {
    const css = readFileSync("src/styles.css", "utf8");

    expect(css).toContain(".logs-v2");
    expect(css).toContain("@media (max-width: 1100px)");
    expect(css).toContain("@media (max-width: 520px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".log-timeline__step--current span");
  });

  it("attaches a screenshot pasted from the clipboard for internal feedback", async () => {
    window.history.replaceState(null, "", "/parameter-home");
    const pastedImage = new File(["pasted screenshot"], "feedback.png", { type: "image/png" });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pasted-feedback-screenshot");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    renderAppForCurrentPath();

    fireEvent.click(screen.getByRole("button", { name: "问题反馈" }));
    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    const pasteZone = within(dialog).getByText("粘贴上传截图").closest("section") as HTMLElement;

    expect(within(dialog).queryByRole("button", { name: "截取当前页面" })).not.toBeInTheDocument();

    fireEvent.paste(pasteZone, { clipboardData: { files: [pastedImage] } });

    expect(await within(dialog).findByAltText("问题反馈截图预览")).toHaveAttribute("src", "blob:pasted-feedback-screenshot");
    expect(screen.getByText("截图已粘贴，可随反馈一起提交。")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("问题描述"), { target: { value: "对比页卡片内容发生重叠" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "提交反馈" }));

    expect(screen.getByText("反馈已记录，并附带粘贴截图。")).toBeInTheDocument();
  });

  it("shows inline guidance when pasted feedback content is not an image", () => {
    window.history.replaceState(null, "", "/parameter-home");
    const pastedText = new File(["not an image"], "notes.txt", { type: "text/plain" });

    renderAppForCurrentPath();

    fireEvent.click(screen.getByRole("button", { name: "问题反馈" }));
    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    const pasteZone = within(dialog).getByText("粘贴上传截图").closest("section") as HTMLElement;

    fireEvent.paste(pasteZone, { clipboardData: { files: [pastedText] } });

    expect(screen.getByText("请粘贴 PNG、JPG 或 WebP 格式截图。")).toBeInTheDocument();
    expect(within(dialog).queryByAltText("问题反馈截图预览")).not.toBeInTheDocument();
  });

  it("resolves direct tutorial urls back to the home surface", () => {
    window.history.replaceState(null, "", "/tutorial/parameters");

    renderAppForCurrentPath();

    expect(screen.getByRole("heading", { name: "让业务流程更智能、更高效、更可控" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "项目参数演示脚本" })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("provides 12 power-management parameters for every project", () => {
    const parameterCountsByProject = initialState.parameters.reduce<Record<string, number>>(
      (counts, parameter) => {
        counts[parameter.projectId] = (counts[parameter.projectId] ?? 0) + 1;
        return counts;
      },
      {}
    );

    expect(parameterCountsByProject).toEqual({
      atlas: 12,
      aurora: 12,
      nebula: 12
    });
  });

  it("renders the parameter admin projects workspace without hanging", () => {
    window.history.replaceState(null, "", "/parameter-admin/projects");

    render(<App initialAppState={adminState} />);

    const topbar = document.querySelector(".topbar") as HTMLElement;

    expect(screen.getByRole("navigation", { name: "参数管理后台分区" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "项目管理" })).toHaveClass("is-active");
    expect(screen.getByRole("table", { name: "项目管理列表" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "项目清单" })).toBeInTheDocument();
    expect(within(topbar).queryByRole("button", { name: "新建项目" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建项目" })).toBeInTheDocument();
    expect(document.querySelector(".project-admin-detail")).not.toBeInTheDocument();
  });

  it("edits project parameter config and reflects it in comparison data", () => {
    window.history.replaceState(null, "", "/parameter-admin");

    render(<App initialAppState={adminState} />);

    const targetRow = findTableRowByText("fast_charge_current_limit_ma");
    expect(targetRow).toBeDefined();
    fireEvent.click(within(targetRow as HTMLElement).getByRole("button", { name: "项目参数" }));
    const projectValues = screen.getByRole("dialog", { name: /项目参数值/ });
    const auroraCurrentValue = within(projectValues).getByLabelText("AUR-Prod 当前值");

    fireEvent.change(auroraCurrentValue, { target: { value: "3650" } });
    fireEvent.click(within(projectValues).getByRole("button", { name: "关闭" }));

    fireEvent.click(within(findTableRowByText("fast_charge_current_limit_ma") as HTMLElement).getByRole("button", { name: "修改" }));
    const sharedDefinition = screen.getByRole("dialog", { name: /参数定义/ });

    expect(screen.queryByText("配置源预览")).not.toBeInTheDocument();
    expect(within(sharedDefinition).getByLabelText("参数推荐值")).toHaveValue("3200");
    expect(screen.queryByLabelText("AUR-Prod 推荐值")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "对比分析" })).not.toBeInTheDocument();
  });

  it("adds and deletes shared project parameters from the project admin config", () => {
    window.history.replaceState(null, "", "/parameter-admin");

    render(<App initialAppState={adminState} />);

    expect(screen.getByText("项目共享参数库")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "修改" })[0]);
    expect(screen.getByRole("dialog", { name: /参数定义/ })).toHaveTextContent("共享参数定义");
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    fireEvent.click(screen.getAllByRole("button", { name: "项目参数" })[0]);
    expect(screen.getByRole("dialog", { name: /项目参数值/ })).toHaveTextContent("项目参数值");
    expect(screen.getByRole("dialog", { name: /项目参数值/ })).toHaveTextContent("所有项目共用同一条参数定义，只在这里维护各项目的实际值。");
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.queryByText("配置源预览")).not.toBeInTheDocument();
    expect(document.querySelector(".config-preview-panel")).not.toBeInTheDocument();
    const adminActions = screen.getByRole("toolbar", { name: "项目参数管理后台页面操作" });
    expect(adminActions).toHaveTextContent("批量参数导入");
    expect(adminActions).not.toHaveTextContent("保存到 JSON 文件");
    expect(adminActions).not.toHaveTextContent("导出 JSON");
    const configFormLabelCss = readCssBlock(readFileSync("src/styles.css", "utf8"), ".config-form-grid label");
    expect(configFormLabelCss).toContain("align-items: flex-start;");
    expect(configFormLabelCss).toContain("text-align: left;");
    expect(readCssBlock(readFileSync("src/styles.css", "utf8"), ".project-value-row label")).toContain("text-align: left;");
    expect(screen.queryByRole("button", { name: "NEB-RD" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新增参数" }));

    expect(screen.getByRole("dialog", { name: "新增参数" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("参数名"), { target: { value: "new_power_parameter_13" } });
    fireEvent.click(screen.getByRole("button", { name: "创建参数" }));

    expect(screen.getByText("new_power_parameter_13")).toBeInTheDocument();
    const newParameterRow = findTableRowByText("new_power_parameter_13");
    expect(newParameterRow).toBeDefined();
    fireEvent.click(within(newParameterRow as HTMLElement).getByRole("button", { name: "项目参数" }));
    expect(screen.getByRole("dialog", { name: /项目参数值/ })).toHaveTextContent("NEB-RD");
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    fireEvent.click(screen.getByRole("button", { name: /删除 new_power_parameter_13/ }));

    expect(screen.getByRole("dialog", { name: /删除参数/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /确认删除/ }));

    expect(screen.queryByDisplayValue("new_power_parameter_13")).not.toBeInTheDocument();
  });

  it("keeps the project shared parameter library list breathable and scannable", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const listBlock = readCssBlock(css, ".project-parameter-library-list");
    const rowBlock = readCssBlock(css, "[data-slot=\"button\"].project-parameter-list-row");
    const selectedBlock = readCssBlock(css, "[data-slot=\"button\"].project-parameter-list-row.selected");
    const nameBlock = readCssBlock(css, ".project-parameter-list-row strong");

    expect(listBlock).toContain("gap: 8px;");
    expect(listBlock).toContain("max-height: 520px;");
    expect(listBlock).toContain("overflow: auto;");
    expect(rowBlock).toContain("grid-template-columns: minmax(0, 1fr) auto;");
    expect(rowBlock).toContain("min-height: 68px;");
    expect(rowBlock).toContain("border-radius: 8px;");
    expect(rowBlock).toContain("transition: none;");
    expect(selectedBlock).toContain("background-color: #eef4ff;");
    expect(selectedBlock).toContain("box-shadow: inset 3px 0 0 var(--app-primary);");
    expect(nameBlock).toContain("font-size: 14px;");
    expect(nameBlock).toContain("overflow-wrap: anywhere;");
    expect(nameBlock).toContain("white-space: normal;");
  });

  it("does not render WiseAgent actions on parameter admin in mock mode", () => {
    window.history.replaceState(null, "", "/parameter-admin");

    renderAppForCurrentPath();

    expect(screen.queryByLabelText("打开 WiseAgent")).not.toBeInTheDocument();
  });

  it("does not expose local JSON save actions on parameter admin", () => {
    window.history.replaceState(null, "", "/parameter-admin");

    render(<App initialAppState={adminState} />);

    const adminActions = screen.getByRole("toolbar", { name: "项目参数管理后台页面操作" });
    expect(within(adminActions).queryByRole("button", { name: "保存到 JSON 文件" })).not.toBeInTheDocument();
    expect(within(adminActions).queryByRole("button", { name: /导出 JSON/ })).not.toBeInTheDocument();
  });

  it("does not show API mode guidance on parameter admin", async () => {
    window.history.replaceState(null, "", "/parameter-admin");

    render(
      <App
        authClient={createResolvedAdminAuthClient()}
        initialAppState={adminState}
        runtimeMode="api"
        parameterRepository={createAppParameterRepository()}
      />
    );

    expect(screen.queryByText("API 模式下参数库修改通过导入批次或审阅流程写入。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存到 JSON 文件" })).not.toBeInTheDocument();
  });

  it("edits debug node config from the debugging admin catalog", () => {
    window.history.replaceState(null, "", "/debugging-admin");

    render(<App initialAppState={adminState} runtimeMode="mock" />);

    const catalog = screen.getByRole("table", { name: "可调节点目录" });
    const chargerRow = within(catalog).getByRole("row", { name: /充电输入限流/ });
    fireEvent.click(within(chargerRow).getByRole("button", { name: "路径绑定" }));
    const editedPath = "/data/local/tmp/wiseeff_nodes/charger/input_current_limit_ma_edited";
    fireEvent.change(screen.getByLabelText("HDC 节点路径"), {
      target: { value: editedPath }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    fireEvent.click(within(chargerRow).getByRole("button", { name: "路径绑定" }));

    expect(screen.getByLabelText("HDC 节点路径")).toHaveValue(editedPath);
  });

  it("adds and disables debug nodes from the debugging admin catalog", () => {
    window.history.replaceState(null, "", "/debugging-admin");
    const nextName = "新调试节点";

    render(<App initialAppState={adminState} runtimeMode="mock" />);

    fireEvent.click(screen.getByRole("button", { name: "新增节点" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: nextName } });
    fireEvent.change(screen.getByLabelText("模块"), { target: { value: "Charging Policy" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const createdRow = screen.getByRole("row", { name: new RegExp(nextName) });
    expect(createdRow).toBeInTheDocument();

    fireEvent.click(within(createdRow).getByRole("button", { name: new RegExp(`禁用 ${nextName}`) }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "禁用" }));

    expect(within(createdRow).getByText("已禁用")).toBeInTheDocument();
  });

  it("renders the debugging admin context in a normalized workspace header", () => {
    window.history.replaceState(null, "", "/debugging-admin");

    render(<App initialAppState={stateForCurrentPath()} runtimeMode="mock" />);

    const topbar = document.querySelector(".topbar") as HTMLElement;
    expect(topbar).toHaveTextContent("可调节点");
    expect(topbar).toHaveTextContent("在线设备");
    expect(document.querySelector(".workspace-header")).not.toBeInTheDocument();
    expect(within(topbar).queryByRole("heading", { level: 1, name: "参数调试管理后台" })).not.toBeInTheDocument();
  });

  it("keeps the debugging admin shell using the parameter-admin main surface layout", () => {
    const styles = readFileSync("src/styles.css", "utf8");
    const shellBlock = readCssBlock(styles, ".debug-admin-shell");
    const mainBlock = readCssBlock(styles, ".param-admin-main");

    expect(shellBlock.length).toBeGreaterThan(0);
    expect(mainBlock).toContain("flex: 1;");
    expect(mainBlock).toContain("min-height: 0;");
  });

  it("does not expose mock JSON export controls in API mode", async () => {
    window.history.replaceState(null, "", "/debugging-admin");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    });
    vi.stubGlobal("fetch", fetchMock);
    const apiClient = createAppDebuggingAdminApiMock();

    render(
      <App
        authClient={createResolvedAdminAuthClient()}
        debuggingAdminClient={createDebuggingAdminClient(apiClient as never)}
        initialAppState={adminState}
        runtimeMode="api"
        parameterRepository={createAppParameterRepository()}
      />
    );

    expect(await screen.findByText("Fast charge current")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /配置源预览/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存到 JSON 文件" })).not.toBeInTheDocument();

    expect(fetchMock.mock.calls.some(([url]) => url === "/api/power-management-config")).toBe(false);
    expect(document.body).not.toHaveTextContent("API 模式下参数库修改通过导入批次或审阅流程写入。");
  });

  it("does not save debug admin catalog without debugging:admin permission in API mode", async () => {
    window.history.replaceState(null, "", "/debugging-admin");
    const apiClient = createAppDebuggingAdminApiMock();

    render(
      <App
        authClient={{
          getCurrentAuthContext: vi.fn(async () => ({
            user: {
              id: "u-api-admin-readonly",
              organizationId: "org-chargelab",
              name: "API Admin Readonly",
              email: "api-admin-readonly@chargelab.cn",
              title: "API Platform Owner",
              isActive: true
            },
            organization: { id: "org-chargelab", name: "ChargeLab" },
            roles: [{ projectId: null, roleId: "admin" }],
            permissions: ["admin:access", "debugging:view"]
          }))
        }}
        debuggingAdminClient={createDebuggingAdminClient(apiClient as never)}
        initialAppState={adminState}
        parameterRepository={createAppParameterRepository()}
        runtimeMode="api"
      />
    );

    expect(await screen.findByText("Fast charge current")).toBeInTheDocument();
    expect(screen.getByText("缺少 debugging:admin 权限，目录仅可查看。")).toBeInTheDocument();

    const catalog = screen.getByRole("table", { name: "可调节点目录" });
    expect(within(catalog).getByRole("button", { name: "编辑" })).toBeDisabled();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it("removes reset-to-code-version actions from both config admin pages", () => {
    window.history.replaceState(null, "", "/parameter-admin");

    renderAppForCurrentPath();

    expect(screen.queryByRole("button", { name: "重置为代码版本" })).not.toBeInTheDocument();

    cleanup();
    window.history.replaceState(null, "", "/debugging-admin");
    renderAppForCurrentPath();

    expect(screen.queryByRole("button", { name: "重置为代码版本" })).not.toBeInTheDocument();
  });

  it("keeps browser history navigation synced with rendered pages", () => {
    window.history.replaceState(null, "", "/parameters");

    render(<App initialAppState={userState} />);
    expect(screen.getByRole("region", { name: "项目参数用户工作台" })).toBeInTheDocument();

    window.history.pushState(null, "", "/logs");
    fireEvent.popState(window);

    expect(within(document.querySelector(".topbar") as HTMLElement).getByRole("button", { name: "上传新日志" })).toBeInTheDocument();
  });
});
