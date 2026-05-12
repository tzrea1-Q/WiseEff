import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParameterManagementHomePage } from "./ParameterManagementHomePage";
import { initialState } from "./mockData";

function readCssBlock(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

afterEach(() => {
  cleanup();
});

describe("ParameterManagementHomePage", () => {
  it("renders the manager-facing operations hub", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    expect(screen.queryByRole("main", { name: "参数管理首页" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "智能参数管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "时间范围" })).not.toBeInTheDocument();
    expect(screen.queryByText("参数变化态势")).not.toBeInTheDocument();
    expect(screen.queryByText("系统按变更频次、风险权重、影响范围、流程堆积与异常偏离识别参数管理优先级。")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "核心指标" })).getByText("参数总量")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "核心指标" })).getByText("30")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "核心指标" })).getByText("管理项目总数")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "核心指标" })).getByText("3")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "核心指标" })).getByText("开发人员总数")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "核心指标" })).getByText(String(initialState.developers.length))).toBeInTheDocument();
    expect(screen.queryByText("共享参数定义")).not.toBeInTheDocument();
    expect(screen.queryByText("关键风险参数")).not.toBeInTheDocument();
    expect(screen.getByTestId("parameter-home-headline")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "参数态势图表" })).toBeInTheDocument();
    expect(screen.getByText("参数更新趋势")).toBeInTheDocument();
    expect(screen.getByText("各项目参数更新情况")).toBeInTheDocument();
    expect(document.querySelector(".update-trend-chart")).toBeInTheDocument();
    expect(document.querySelector(".project-risk-bar-chart")).toBeInTheDocument();
    expect(screen.getByText("热门模块")).toBeInTheDocument();
    expect(screen.queryByText("关键参数变化")).not.toBeInTheDocument();
    expect(screen.queryByText("审核合入情况")).not.toBeInTheDocument();
    expect(screen.queryByText("治理流健康度")).not.toBeInTheDocument();
  });

  it("renders compact homepage content without large entry cards", () => {
    const onNavigate = vi.fn();
    render(<ParameterManagementHomePage state={initialState} onNavigate={onNavigate} />);

    expect(screen.queryByRole("region", { name: "入口卡片" })).not.toBeInTheDocument();
    expect(document.querySelector(".homepage-entry-grid")).not.toBeInTheDocument();
    expect(document.querySelector(".homepage-entry-card")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "进入 参数修改" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "核心指标" })).getByText("参数总量")).toBeInTheDocument();

    const hotspotRegion = screen.getByRole("region", { name: "热门模块" });
    fireEvent.click(within(hotspotRegion).getAllByRole("button", { name: /进入/ })[0]);

    expect(onNavigate).toHaveBeenLastCalledWith(expect.stringMatching(/^\/(parameters|parameter-review)/));
  });

  it("shows hotspot leaderboard with AI detail panel", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    const hotspotRegion = screen.getByRole("region", { name: "热门模块" });
    fireEvent.click(within(hotspotRegion).getByRole("button", { name: /选择热区 #2/ }));

    const panel = within(hotspotRegion).getByRole("region", { name: /AI 评分拆解/ });

    expect(within(hotspotRegion).getByText("排名")).toBeInTheDocument();
    expect(document.querySelectorAll(".hotspot-row")).toHaveLength(5);
    expect(within(hotspotRegion).getByRole("button", { name: /选择热区 #2/ })).toHaveAttribute("aria-current", "true");
    expect(panel).toBeInTheDocument();
    expect(within(panel).getByText("关联证据")).toBeInTheDocument();
    expect(within(panel).getByText("维度得分")).toBeInTheDocument();
    expect(within(panel).queryByText("AI 建议动作")).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /创建高风险专项审阅/ })).toBeInTheDocument();
    expect(within(panel).getByRole("progressbar", { name: "变更频次" })).toBeInTheDocument();
    expect(within(panel).getByRole("progressbar", { name: "风险权重" })).toBeInTheDocument();
    expect(within(panel).queryByText("统计所选窗口内参数与审阅请求的变更密度。")).not.toBeInTheDocument();
  });

  it("removes the hero time window panel from the parameter homepage", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    expect(document.querySelector(".parameter-homepage-hero")).not.toBeInTheDocument();
    expect(document.querySelector(".homepage-window-switcher")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "时间范围" })).not.toBeInTheDocument();
  });

  it("does not render the removed time range context panel copy", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    const timeWindowPanel = document.querySelector(".homepage-window-switcher");

    expect(timeWindowPanel).not.toBeInTheDocument();
    expect(screen.queryByText("AI 分析维度")).not.toBeInTheDocument();
    expect(screen.queryByText("变更频次、风险权重、影响范围、流程堆积、异常偏离")).not.toBeInTheDocument();
  });

  it("keeps analytics visible without a time window control", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    const metrics = screen.getByRole("region", { name: "核心指标" });
    const hotspotRegion = screen.getByRole("region", { name: "热门模块" });

    expect(within(metrics).getByText("修改频次")).toBeInTheDocument();
    expect(within(hotspotRegion).getAllByText(/^\d+(\.\d+)?$/).length).toBeGreaterThan(0);
  });

  it("switches hotspot ranking between project and module dimensions", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    const hotspotRegion = screen.getByRole("region", { name: "热门模块" });
    const dimensionGroup = within(hotspotRegion).getByRole("group", { name: "热榜维度" });
    const moduleToggle = within(dimensionGroup).getByRole("radio", { name: "模块" });
    const projectToggle = within(dimensionGroup).getByRole("radio", { name: "项目" });

    expect(document.querySelector(".parameter-homepage-dimension-switch")).toBeInTheDocument();
    expect(moduleToggle).toHaveClass("parameter-homepage-dimension-option");
    expect(projectToggle).toHaveClass("parameter-homepage-dimension-option");
    expect(moduleToggle).toHaveAttribute("aria-checked", "true");
    expect(projectToggle).toHaveAttribute("aria-checked", "false");
    expect(moduleToggle).toHaveAttribute("data-state", "on");
    expect(projectToggle).toHaveAttribute("data-state", "off");
    expect(within(hotspotRegion).getByText("Charging Policy")).toBeInTheDocument();
    expect(within(hotspotRegion).queryByText("AUR-Prod · Charging Policy")).not.toBeInTheDocument();

    fireEvent.click(projectToggle);

    expect(projectToggle).toHaveAttribute("aria-checked", "true");
    expect(projectToggle).toHaveAttribute("data-state", "on");
    expect(within(hotspotRegion).getByText("AUR-Prod")).toBeInTheDocument();
    expect(within(hotspotRegion).queryByText("Charging Policy")).not.toBeInTheDocument();
  });

  it("uses stable class hooks for responsive homepage layout", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    expect(document.querySelector(".parameter-homepage")).toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-hero")).not.toBeInTheDocument();
    expect(document.querySelector(".homepage-window-switcher")).not.toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-select")).toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-dimension-switch")).toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-dimension-option")).toBeInTheDocument();
    expect(document.querySelector(".homepage-entry-grid")).not.toBeInTheDocument();
    expect(document.querySelector(".homepage-entry-card")).not.toBeInTheDocument();
    expect(document.querySelector(".homepage-main-grid")).not.toBeInTheDocument();
    expect(document.querySelector(".homepage-metric-card")).toBeInTheDocument();
    expect(document.querySelector(".homepage-panel")).toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-headline")).toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-charts")).toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-chart-card")).toBeInTheDocument();
    expect(document.querySelector(".update-trend-chart")).toBeInTheDocument();
    expect(document.querySelector(".project-risk-bar-chart")).toBeInTheDocument();
    expect(document.querySelector(".hotspot-card")).not.toBeInTheDocument();
    expect(document.querySelector(".hotspot-row")).toBeInTheDocument();
    expect(document.querySelector(".hotspot-list")).toBeInTheDocument();
    expect(document.querySelector(".hotspot-panel")).toBeInTheDocument();
    expect(document.querySelector(".key-change-row")).not.toBeInTheDocument();
    expect(document.querySelector(".breakdown-row")).not.toBeInTheDocument();
  });

  it("keeps the metric strip visually compact", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    const css = readFileSync("src/styles.css", "utf8");
    const metricCardCss = readCssBlock(css, ".homepage-metric-card");
    const pageCardCss = readCssBlock(css, ".parameter-homepage-card");
    const metricValueCss = readCssBlock(css, ".parameter-homepage .metric-card strong");

    expect(document.querySelectorAll(".homepage-metric-card")).toHaveLength(4);
    expect(metricCardCss).toContain("gap: 6px;");
    expect(metricCardCss).toContain("min-height: 96px;");
    expect(pageCardCss).toContain("padding: 12px 14px;");
    expect(metricValueCss).toContain("font-size: 22px;");
  });

  it("defines leaderboard hotspot styles and removes legacy hotspot-card rules", () => {
    const css = readFileSync("src/styles.css", "utf8");

    expect(css).toContain("--risk-high: #d23c3c;");
    expect(css).toContain("--risk-medium: #e4953a;");
    expect(css).toContain("--risk-low: #6a8ad6;");
    expect(css).toContain(".parameter-homepage-headline {");
    expect(css).toContain(".parameter-homepage-charts {");
    expect(css).toContain(".update-trend-chart {");
    expect(css).toContain(".project-risk-bar-chart {");
    expect(css).toContain(".hotspot-list {");
    expect(css).toContain(".hotspot-row-select {");
    expect(css).toContain(".hotspot-panel {");
    expect(css).toContain(".parameter-homepage-dimension-switch {");
    expect(css).toContain(".parameter-homepage-dimension-option[data-state=\"on\"]");
    expect(css).toContain(".parameter-homepage-select-label {");
    expect(css).toContain(".action-btn--primary {");
    expect(css).toContain("@media (max-width: 768px)");
    expect(css).not.toContain(".hotspot-card {");
    expect(css).not.toContain(".hotspot-card.selected");
    expect(css).not.toContain(".parameter-homepage-hotspot-head");
    expect(css).not.toContain(".parameter-homepage-hotspot-stats");
  });
});
