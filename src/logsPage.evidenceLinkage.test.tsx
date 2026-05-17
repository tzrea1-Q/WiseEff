import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { initialState } from "./mockData";

const userState = { ...initialState, activeRoleId: "user" };

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("LogsPage · 证据与原始日志联动", () => {
  it("点击证据卡会聚焦对应原始日志行", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);

    fireEvent.click(screen.getByRole("button", { name: "证据 01 日志解析" }));

    expect(screen.getByTestId("rawlog-line-20")).toHaveClass("rawlog-line--anchor-focus");
  });

  it("点击带证据的原始日志行会聚焦证据卡", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);

    const rawLog = screen.getByRole("region", { name: "原始日志" });
    fireEvent.click(within(rawLog).getByRole("button", { name: "跳转到第 25 行对应证据" }));

    expect(screen.getByRole("button", { name: "证据 02 模式匹配" })).toHaveClass("evidence-card--focused");
  });

  it("悬停证据卡时高亮对应原始日志行", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "证据 03 根因推断" }));

    expect(screen.getByTestId("rawlog-line-30")).toHaveClass("rawlog-line--anchor-hover");
  });
});
