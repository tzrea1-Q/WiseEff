import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { initialState } from "./mockData";

const adminState = { ...initialState, activeRoleId: "admin" };

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("normalized workspace headers", () => {
  it("keeps log overview actions in its local toolbar without a duplicate page title", () => {
    window.history.replaceState(null, "", "/log-admin");

    render(<App initialAppState={adminState} runtimeMode="mock" />);

    const topbar = document.querySelector(".topbar") as HTMLElement;

    expect(within(topbar).queryByRole("button", { name: "前往智能分析" })).not.toBeInTheDocument();
    expect(within(topbar).queryByRole("button", { name: "刷新" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "前往智能分析" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "日志分析管理后台" })).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-header")).not.toBeInTheDocument();
    expect(screen.getByTestId("log-admin-overview")).toHaveAccessibleName("日志概览");
  });

  it("keeps parameter admin bulk import in the topbar without a duplicate page title", () => {
    window.history.replaceState(null, "", "/parameter-admin");

    render(<App initialAppState={adminState} runtimeMode="mock" />);

    const topbar = document.querySelector(".topbar") as HTMLElement;

    expect(topbar.querySelector(".topbar-title")).toHaveTextContent("参数管理后台");
    expect(topbar.querySelector(".topbar-subtitle")).toHaveTextContent("参数定义管理");
    expect(within(topbar).getByRole("button", { name: "打开批量参数导入" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "批量参数导入" })).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-header")).not.toBeInTheDocument();
  });

  it("keeps the node summary in the directory without duplicating topbar metrics", () => {
    window.history.replaceState(null, "", "/debugging-admin/nodes");

    render(<App initialAppState={adminState} runtimeMode="mock" />);

    const debuggingTopbar = document.querySelector(".topbar") as HTMLElement;
    expect(debuggingTopbar.querySelector(".debug-admin-strip--topbar")).not.toBeInTheDocument();
    const summary = screen.getByLabelText("节点目录概览");
    expect(summary).toHaveTextContent("节点总数");
    expect(summary).toHaveTextContent("已启用");
    expect(summary).not.toHaveTextContent("最近保存");
  });

  it("keeps parameter-debug admin scope without node-catalog topbar strip", () => {
    window.history.replaceState(null, "", "/debugging-admin");

    render(<App initialAppState={adminState} runtimeMode="mock" />);

    const debuggingTopbar = document.querySelector(".topbar") as HTMLElement;
    expect(debuggingTopbar.querySelector(".debug-admin-strip--topbar")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "调试后台范围" })).toBeInTheDocument();
  });
});
