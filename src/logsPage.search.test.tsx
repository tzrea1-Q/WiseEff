import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("LogsPage · 原始日志搜索", () => {
  it("输入关键词后显示匹配数并标记当前匹配行", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App />);

    fireEvent.change(screen.getByRole("searchbox", { name: "在日志中搜索" }), { target: { value: "thermal" } });

    expect(screen.getByRole("status", { name: "" })).toHaveTextContent(/1 \/ \d+ 匹配/);
    expect(screen.getByTestId("rawlog-line-6")).toHaveClass("rawlog-line--match-current");
  });

  it("下一个匹配按钮推进当前匹配行，Esc 清空搜索", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App />);

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
    render(<App />);

    const rawLog = screen.getByRole("region", { name: "原始日志" });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });

    expect(within(rawLog).getByRole("searchbox", { name: "在日志中搜索" })).toHaveFocus();
  });
});
