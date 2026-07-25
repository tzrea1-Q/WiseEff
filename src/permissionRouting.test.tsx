import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/agent/XiaozeProvider", () => ({
  XiaozeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  XiaozeProactiveInsights: () => null
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: vi.fn()
}));
import { readFileSync } from "node:fs";
import { canAccessPage } from "./app/permissions";
import App, { appReducer } from "./App";
import { initialState } from "./mockData";

const guestState = { ...initialState, activeRoleId: "guest" };

function readCssBlock(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("permission-aware routing", () => {
  it("hides admin and operational navigation for Guest", () => {
    window.history.replaceState(null, "", "/parameter-home");

    render(<App initialAppState={guestState} />);

    const navigation = within(screen.getByRole("navigation", { name: /主导航|涓诲鑸?/ }));
    expect(navigation.getByRole("button", { name: /参数修改|鍙傛暟淇敼/ })).toBeInTheDocument();
    expect(navigation.queryByRole("button", { name: /参数审阅|鍙傛暟瀹￠槄/ })).not.toBeInTheDocument();
    expect(navigation.queryByRole("button", { name: /参数调试|鍙傛暟璋冭瘯/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /用户管理|鐢ㄦ埛绠＄悊/ })).not.toBeInTheDocument();
  });

  it("lets Admin see the shared user permissions utility entry", async () => {
    window.history.replaceState(null, "", "/parameter-home");

    render(<App initialAppState={{ ...initialState, activeRoleId: "admin" }} />);

    const settingsEntry = screen.getByRole("button", { name: /^打开 用户管理$/ });
    expect(settingsEntry).toBeInTheDocument();

    fireEvent.click(settingsEntry);

    await waitFor(() => {
      expect(screen.getByText("用户权限管理")).toBeInTheDocument();
    });
  });

  it("filters personal workbench entries by role", () => {
    const renderRole = (activeRoleId: string) => {
      cleanup();
      window.history.replaceState(null, "", "/parameter-home");
      render(<App initialAppState={{ ...initialState, activeRoleId }} />);
    };

    renderRole("guest");

    expect(screen.getByRole("region", { name: "主要功能" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开 处理审阅/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开 管理后台/ })).not.toBeInTheDocument();

    renderRole("hardware-user");

    expect(screen.getByRole("button", { name: /打开 修改参数/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开 管理后台/ })).not.toBeInTheDocument();

    renderRole("hardware-committer");

    expect(screen.getByRole("button", { name: /打开 处理审阅/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开 管理后台/ })).not.toBeInTheDocument();

    renderRole("admin");

    expect(screen.getByRole("button", { name: /打开 管理后台/ })).toBeInTheDocument();
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

    expect(screen.getByRole("heading", { name: "Permission denied" })).toBeInTheDocument();
    expect(screen.getByText(/Current role: Guest/)).toBeInTheDocument();
    expect(screen.getByText(/Required role: Admin/)).toBeInTheDocument();
  });

  it("does not render WiseAgent or Xiaoze on permission denied pages", () => {
    window.history.replaceState(null, "", "/debugging-admin");

    render(<App initialAppState={{ ...initialState, activeRoleId: "user" }} runtimeMode="mock" />);

    expect(screen.getByRole("heading", { name: "Permission denied" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开 WiseAgent" })).not.toBeInTheDocument();
    expect(document.querySelector(".xiaoze-chat-toggle-anchor")).not.toBeInTheDocument();
  });

  it("uses a stable permission denied layout", () => {
    window.history.replaceState(null, "", "/debugging-admin");

    render(<App initialAppState={guestState} />);

    expect(document.querySelector(".permission-denied-page")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to accessible workspace" })).toHaveClass("permission-denied-action");
  });

  it("keeps the permission denied action from rendering as text-only", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const actionStyles = readCssBlock(css, ".permission-denied-page .permission-denied-action");
    const primaryStyles = readCssBlock(css, ".permission-denied-page .permission-denied-action.primary");

    expect(actionStyles).toContain("display: inline-flex;");
    expect(actionStyles).toContain("border: 1px solid");
    expect(actionStyles).toContain("border-radius: 8px;");
    expect(primaryStyles).toContain("background: var(--app-primary);");
    expect(primaryStyles).toContain("color: #fff;");
    expect(primaryStyles).toContain("box-shadow:");
  });
});

describe("permission route matrix", () => {
  it("keeps User out of review and admin pages", () => {
    expect(canAccessPage("user", "parameter-review")).toBe(false);
    expect(canAccessPage("software-user", "parameter-review")).toBe(true);
    expect(canAccessPage("user", "parameter-admin")).toBe(false);
    expect(canAccessPage("user", "log-admin")).toBe(false);
    expect(canAccessPage("user", "debugging-admin")).toBe(false);
    expect(canAccessPage("user", "user-permissions")).toBe(false);
    expect(canAccessPage("user", "logs")).toBe(true);
    expect(canAccessPage("user", "debugging")).toBe(true);
  });

  it("keeps Committer out of admin pages while allowing review", () => {
    expect(canAccessPage("committer", "parameter-review")).toBe(true);
    expect(canAccessPage("committer", "parameter-admin")).toBe(false);
    expect(canAccessPage("committer", "log-admin")).toBe(false);
    expect(canAccessPage("committer", "debugging-admin")).toBe(false);
    expect(canAccessPage("committer", "user-permissions")).toBe(false);
  });
});
