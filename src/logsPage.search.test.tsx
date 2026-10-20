import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { initialState } from "./mockData";
import { LogsPage } from "@/features/log-analysis/LogsPage";

const userState = { ...initialState, activeRoleId: "user", logs: initialState.logs.map((log, index) => index === 0 ? { ...log, status: "Complete" as const } : log) };

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("LogsPage · 原始日志搜索", () => {
  it("空筛选结果隐藏无值列后仍可清空筛选恢复日志", () => {
    render(<LogsPage search="" state={{ ...userState, logs: [{ ...userState.logs[0], rawLines: ["10:00 INFO [ONE] first", "10:01 WARN [TWO] second"] }] }}
      dispatch={() => undefined} onNavigate={() => undefined} />);
    const rawLog = screen.getByRole("region", { name: "原始日志" });
    fireEvent.click(within(rawLog).getByRole("button", { name: "筛选模块" }));
    fireEvent.click(within(rawLog).getByRole("checkbox", { name: "INFO [ONE]" }));
    fireEvent.click(within(rawLog).getByRole("button", { name: "筛选时间" }));
    fireEvent.click(within(rawLog).getByRole("checkbox", { name: "10:01" }));
    expect(within(rawLog).getByText("当前筛选条件下没有日志行。")).toBeInTheDocument();
    expect(within(rawLog).queryByRole("columnheader", { name: /时间|模块/ })).not.toBeInTheDocument();
    fireEvent.click(within(rawLog).getByRole("button", { name: "清空筛选" }));
    expect(within(rawLog).getByTestId("rawlog-line-1")).toBeInTheDocument();
    expect(within(rawLog).getByTestId("rawlog-line-2")).toBeInTheDocument();
    expect(within(rawLog).getByRole("columnheader", { name: /时间/ })).toBeInTheDocument();
  });
  it("无时间与模块值时隐藏列和筛选，并提供自动换行开关", () => {
    render(<LogsPage search="" state={{ ...userState, logs: [{ ...userState.logs[0], rawLines: ["retry 1/3", "长内容".repeat(100)] }] }}
      dispatch={() => undefined} onNavigate={() => undefined} />);
    const rawLog = screen.getByRole("region", { name: "原始日志" });
    expect(within(rawLog).queryByRole("columnheader", { name: /时间|模块/ })).not.toBeInTheDocument();
    expect(within(rawLog).queryByRole("button", { name: /筛选时间|筛选模块/ })).not.toBeInTheDocument();
    expect(within(rawLog).getByRole("columnheader", { name: /内容/ })).toBeInTheDocument();
    const toggle = within(rawLog).getByRole("button", { name: "自动换行" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(within(rawLog).getByRole("grid")).toHaveClass("rawlog-table--wrap");
  });
  it("输入关键词后显示匹配数并标记当前匹配行", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);

    const rawLog = screen.getByRole("region", { name: "原始日志" });
    fireEvent.change(within(rawLog).getByRole("searchbox", { name: "在日志中搜索" }), {
      target: { value: "thermal" }
    });

    expect(within(rawLog).getByRole("status")).toHaveTextContent(/1 \/ \d+ 匹配/);
    expect(screen.getByTestId("rawlog-line-6")).toHaveClass("rawlog-line--match-current");
  });

  it("下一个匹配按钮推进当前匹配行，Esc 清空搜索", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);

    const search = screen.getByRole("searchbox", { name: "在日志中搜索" });
    fireEvent.change(search, { target: { value: "thermal" } });
    fireEvent.click(screen.getByRole("button", { name: "下一个匹配" }));

    expect(screen.getByTestId("rawlog-line-7")).toHaveClass("rawlog-line--match-current");

    fireEvent.keyDown(search, { key: "Escape" });

    expect(search).toHaveValue("");
    expect(screen.getByRole("button", { name: "下一个匹配" })).toBeDisabled();
  });

  it("Ctrl+F 将焦点移到日志搜索框", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);

    const rawLog = screen.getByRole("region", { name: "原始日志" });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });

    expect(within(rawLog).getByRole("searchbox", { name: "在日志中搜索" })).toHaveFocus();
  });

  it("原始日志表头支持按时间、模块和内容筛选，搜索框保持独立", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);

    const rawLog = screen.getByRole("region", { name: "原始日志" });
    const table = within(rawLog).getByRole("grid");
    const checks: Array<[string, string, string]> = [
      ["时间", "筛选时间", "10:24:05"],
      ["模块", "筛选模块", "INFO [THERMAL_MON]"],
      ["内容", "筛选内容", "battery_pack_temp=46.8C over soft_limit=45C"]
    ];

    expect(within(rawLog).getByRole("searchbox", { name: "在日志中搜索" })).toBeInTheDocument();

    for (const [headerName, buttonName, optionName] of checks) {
      const header = within(table).getByRole("columnheader", { name: new RegExp(headerName) });
      fireEvent.click(within(header).getByRole("button", { name: buttonName }));
      expect(within(header).getByRole("checkbox", { name: optionName })).toBeInTheDocument();
      fireEvent.click(within(header).getByRole("button", { name: buttonName }));
    }

    const moduleHeader = within(table).getByRole("columnheader", { name: /模块/ });
    fireEvent.click(within(moduleHeader).getByRole("button", { name: "筛选模块" }));
    fireEvent.click(within(moduleHeader).getByRole("checkbox", { name: "INFO [THERMAL_MON]" }));

    expect(within(table).getByTestId("rawlog-line-6")).toBeInTheDocument();
    expect(within(table).queryByTestId("rawlog-line-1")).not.toBeInTheDocument();
  });
});
