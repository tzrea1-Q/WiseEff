import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { initialState } from "./mockData";

const userState = { ...initialState, activeRoleId: "user" };

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("LogsPage · 原始日志搜索", () => {
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
