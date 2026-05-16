import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("LogDashboardPage", () => {
  it("renders a senior UX dashboard with four decision-oriented modules", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00+08:00"));
    window.history.replaceState(null, "", "/log-dashboard");

    const { container } = render(<App />);

    const topbar = container.querySelector(".topbar") as HTMLElement;
    expect(screen.queryByRole("heading", { level: 1, name: "日志分析看板" })).not.toBeInTheDocument();
    expect(container.querySelector(".workspace-header")).not.toBeInTheDocument();
    expect(within(topbar).getByRole("button", { name: "进入智能分析" })).toBeInTheDocument();
    expect(container.querySelector(".log-dashboard-topic-grid")).toBeInTheDocument();
    expect(container.querySelectorAll(".log-dashboard-topic-card")).toHaveLength(4);
    expect(screen.getByRole("article", { name: "今日分析" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "平均置信度" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "失败文件" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "吞吐峰值" })).toBeInTheDocument();
    expect(screen.getByText("处理节奏")).toBeInTheDocument();
    expect(screen.getByText("完成质量")).toBeInTheDocument();
    expect(screen.getByText("失败影响")).toBeInTheDocument();
    expect(screen.getByText("大文件压力")).toBeInTheDocument();
    expect(screen.getAllByText("关键判断")).toHaveLength(4);
    expect(container.querySelectorAll(".topic-decision-panel")).toHaveLength(4);
    expect(container.querySelectorAll(".topic-evidence-grid")).toHaveLength(4);
    expect(container.querySelectorAll(".topic-followup-panel")).toHaveLength(0);
    expect(container.querySelectorAll(".topic-line-chart__value")).toHaveLength(7);
    expect(container.querySelectorAll(".topic-line-chart__time")).toHaveLength(7);
    expect(screen.queryByText("00:00")).not.toBeInTheDocument();
    expect(screen.queryByText("现在")).not.toBeInTheDocument();
    const trendLabels = Array.from(container.querySelectorAll(".topic-line-chart__time")).map((node) => node.textContent ?? "");
    expect(trendLabels).toHaveLength(7);
    expect(trendLabels.every((label) => /^\d+月\d+日$/.test(label))).toBe(true);
    expect(screen.getByText("趋势洞察")).toBeInTheDocument();
    expect(screen.getByText("质量分布")).toBeInTheDocument();
    expect(screen.getByText("建议动作")).toBeInTheDocument();
    expect(screen.getByText("容量排行")).toBeInTheDocument();
    expect(screen.getByText("复核队列")).toBeInTheDocument();
    expect(screen.getByText("容量结构")).toBeInTheDocument();
    expect(screen.getByText("状态构成")).toBeInTheDocument();
    expect(screen.queryByText("处置焦点")).not.toBeInTheDocument();
    expect(screen.queryByText("复核策略")).not.toBeInTheDocument();
    expect(screen.queryByText("容量解读")).not.toBeInTheDocument();
    expect(screen.queryByText("1 份仍在分析链路中")).not.toBeInTheDocument();
    expect(screen.queryByText("优先抽查需复核样本")).not.toBeInTheDocument();
    expect(screen.queryByText("单份大日志主导今日吞吐")).not.toBeInTheDocument();
    expect(screen.getByText("处理队列稳定")).toBeInTheDocument();
    expect(screen.getByText("需要人工介入")).toBeInTheDocument();
    expect(screen.queryByText("charging_thermal_trace_20260504.log")).not.toBeInTheDocument();
  });

  it("can navigate from dashboard to log admin and log analysis", async () => {
    window.history.replaceState(null, "", "/log-dashboard");
    const user = await import("@testing-library/user-event").then((mod) => mod.default.setup());

    render(<App />);

    await user.click(screen.getByRole("button", { name: "查看管理后台" }));
    expect(window.location.pathname).toBe("/log-admin");
  });

  it("can navigate from dashboard to log analysis", async () => {
    window.history.replaceState(null, "", "/log-dashboard");
    const user = await import("@testing-library/user-event").then((mod) => mod.default.setup());

    render(<App />);

    await user.click(screen.getByRole("button", { name: "进入智能分析" }));
    expect(window.location.pathname).toBe("/logs");
  });

  it("is reachable from the sidebar navigation", async () => {
    window.history.replaceState(null, "", "/logs");
    const user = await import("@testing-library/user-event").then((mod) => mod.default.setup());

    render(<App />);

    const logNavigation = screen.getAllByText("日志分析")[0].closest(".nav-group");
    expect(logNavigation).not.toBeNull();
    const logDashboardButton = within(logNavigation as HTMLElement).getByRole("button", { name: "看板" });

    await user.click(logDashboardButton);

    expect(window.location.pathname).toBe("/log-dashboard");
  });
});
