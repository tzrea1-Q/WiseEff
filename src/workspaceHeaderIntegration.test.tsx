import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { initialState } from "./mockData";

const userState = { ...initialState, activeRoleId: "user" };
const adminState = { ...initialState, activeRoleId: "admin" };

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("normalized workspace headers", () => {
  it("moves log dashboard page actions into the topbar and removes the duplicate content h1", () => {
    window.history.replaceState(null, "", "/log-dashboard");

    render(<App initialAppState={userState} runtimeMode="mock" />);

    const topbar = document.querySelector(".topbar") as HTMLElement;

    expect(within(topbar).getByRole("button", { name: "查看管理后台" })).toBeInTheDocument();
    expect(within(topbar).getByRole("button", { name: "进入智能分析" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "日志分析看板" })).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-header")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "日志分析核心指标" })).toBeInTheDocument();
  });

  it("moves parameter admin management actions into the topbar and removes the duplicated page title", () => {
    window.history.replaceState(null, "", "/parameter-admin");

    render(<App initialAppState={adminState} runtimeMode="mock" />);

    const topbar = document.querySelector(".topbar") as HTMLElement;
    const topbarActions = within(topbar).getByRole("toolbar", { name: "项目参数管理后台页面操作" });

    expect(within(topbar).getByRole("button", { name: "批量参数导入" })).toBeInTheDocument();
    expect(within(topbarActions).queryByRole("button", { name: "保存到 JSON 文件" })).not.toBeInTheDocument();
    expect(within(topbarActions).queryByRole("button", { name: /导出 JSON/ })).not.toBeInTheDocument();
    expect(within(topbarActions).queryByRole("button", { name: "权限" })).not.toBeInTheDocument();
    expect(within(topbarActions).queryByRole("button", { name: "审计" })).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-header")).not.toBeInTheDocument();
  });

  it("exposes normalized topbar action hooks for legacy buttons and compact status controls", () => {
    window.history.replaceState(null, "", "/parameter-admin");

    render(<App initialAppState={adminState} runtimeMode="mock" />);

    const parameterAdminTopbar = document.querySelector(".topbar") as HTMLElement;
    const legacyPrimary = within(parameterAdminTopbar).getByRole("button", { name: "批量参数导入" });

    expect(legacyPrimary).toHaveClass("button", "primary");
    expect(within(parameterAdminTopbar).queryByRole("button", { name: "审计" })).not.toBeInTheDocument();
    expect(within(parameterAdminTopbar).queryByRole("button", { name: "权限" })).not.toBeInTheDocument();
    expect(parameterAdminTopbar.querySelector(".export-menu")).not.toBeInTheDocument();

    cleanup();
    window.history.replaceState(null, "", "/debugging-admin");

    render(<App initialAppState={adminState} runtimeMode="mock" />);

    const debuggingTopbar = document.querySelector(".topbar") as HTMLElement;
    const compactMetrics = debuggingTopbar.querySelector(".debug-admin-strip--topbar");

    expect(compactMetrics).toBeInTheDocument();
    expect(compactMetrics?.querySelectorAll(".debug-admin-stat")).toHaveLength(0);
  });
});
