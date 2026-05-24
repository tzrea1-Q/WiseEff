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

function readCssBlockAfter(css: string, marker: string, selector: string) {
  const markerStart = css.indexOf(marker);
  expect(markerStart).toBeGreaterThanOrEqual(0);
  const start = css.indexOf(`${selector} {`, markerStart);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

afterEach(() => {
  cleanup();
});

describe("ParameterManagementHomePage", () => {
  it("renders a personal workbench hero with next actions and scenario entries", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} onNewProject={vi.fn()} />);

    expect(screen.getByRole("region", { name: "个人工作台" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "我的下一步" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "我想做" })).toBeInTheDocument();
    expect(screen.getByText("管理视角")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开 管理后台/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开 新建项目/ })).toBeInTheDocument();
    expect(screen.queryByText("我要治理")).not.toBeInTheDocument();
  });

  it("keeps the old dashboard as recommendation evidence", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} onNewProject={vi.fn()} />);

    expect(screen.getByRole("region", { name: "推荐依据" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "核心指标" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "参数态势图表" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "风险热区证据" })).toBeInTheDocument();
    expect(document.querySelector(".personal-workbench-hero")).toBeInTheDocument();
    expect(document.querySelector(".next-action-card")).toBeInTheDocument();
    expect(document.querySelector(".scenario-entry")).toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-headline")).not.toBeInTheDocument();
  });

  it("renders user-focused scenario entries for a normal user", () => {
    render(<ParameterManagementHomePage state={{ ...initialState, activeRoleId: "hardware-user" }} onNavigate={vi.fn()} onNewProject={vi.fn()} />);

    expect(screen.getByRole("button", { name: /打开 修改参数/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开 我的提交/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开 管理后台/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开 处理审阅/ })).not.toBeInTheDocument();
  });

  it("renders committer review entries without admin actions", () => {
    render(<ParameterManagementHomePage state={{ ...initialState, activeRoleId: "hardware-committer" }} onNavigate={vi.fn()} onNewProject={vi.fn()} />);

    expect(screen.getByRole("button", { name: /打开 处理审阅/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开 高风险专项/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开 管理后台/ })).not.toBeInTheDocument();
  });

  it("navigates from next actions and scenario entries with context", () => {
    const onNavigate = vi.fn();

    render(<ParameterManagementHomePage state={{ ...initialState, activeRoleId: "hardware-committer" }} onNavigate={onNavigate} onNewProject={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /处理待审阅参数变更/ }));
    expect(onNavigate).toHaveBeenLastCalledWith("/parameter-review");

    fireEvent.click(screen.getByRole("button", { name: /打开 高风险专项/ }));
    expect(onNavigate).toHaveBeenLastCalledWith("/parameter-review");
  });

  it("opens the project initialization wizard from the Admin scenario entry", () => {
    const onNewProject = vi.fn();

    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} onNewProject={onNewProject} />);

    fireEvent.click(screen.getByRole("button", { name: /打开 新建项目/ }));
    expect(onNewProject).toHaveBeenCalledTimes(1);
  });

  it("renders the manager-facing operations hub", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    expect(screen.queryByRole("main", { name: "参数管理首页" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "智能参数管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "时间范围" })).not.toBeInTheDocument();
    expect(screen.queryByText("参数变化态势")).not.toBeInTheDocument();
    expect(screen.queryByText("系统按变更频次、风险权重、影响范围、流程堆积与异常偏离识别参数管理优先级。")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "核心指标" })).getByText("参数总量")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "核心指标" })).getByText(String(initialState.parameters.length))).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "核心指标" })).getByText("管理项目总数")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "核心指标" })).getByText("3")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "核心指标" })).getByText("开发人员总数")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "核心指标" })).getByText(String(initialState.developers.length))).toBeInTheDocument();
    expect(screen.queryByText("共享参数定义")).not.toBeInTheDocument();
    expect(screen.queryByText("关键风险参数")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "推荐依据" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "参数态势图表" })).toBeInTheDocument();
    expect(screen.getByText("参数更新趋势")).toBeInTheDocument();
    expect(screen.getByText("各项目参数更新情况")).toBeInTheDocument();
    expect(document.querySelector(".update-trend-chart")).toBeInTheDocument();
    expect(document.querySelector(".project-risk-bar-chart")).toBeInTheDocument();
    expect(screen.getByText("风险热区证据")).toBeInTheDocument();
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

    const hotspotRegion = screen.getByRole("region", { name: "风险热区证据" });
    fireEvent.click(within(hotspotRegion).getAllByRole("button", { name: /进入/ })[0]);

    expect(onNavigate).toHaveBeenLastCalledWith(expect.stringMatching(/^\/(parameters|parameter-review)/));
  });

  it("does not advertise the retired standalone comparison entry on the homepage", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    expect(screen.queryByRole("navigation", { name: "参数管理快捷入口" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "对比分析" })).not.toBeInTheDocument();
    expect(screen.queryByText("对比分析")).not.toBeInTheDocument();
  });

  it("shows hotspot leaderboard with AI detail panel", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    const hotspotRegion = screen.getByRole("region", { name: "风险热区证据" });
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
    const hotspotRegion = screen.getByRole("region", { name: "风险热区证据" });

    expect(within(metrics).getByText("修改频次")).toBeInTheDocument();
    expect(within(hotspotRegion).getAllByText(/^\d+(\.\d+)?$/).length).toBeGreaterThan(0);
  });

  it("defaults to the overall hotspot leaderboard and exposes four ranking tabs", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    const hotspotRegion = screen.getByRole("region", { name: "风险热区证据" });
    const dimensionGroup = within(hotspotRegion).getByRole("group", { name: "热榜维度" });
    const overallToggle = within(dimensionGroup).getByRole("radio", { name: "总榜" });

    expect(overallToggle).toHaveAttribute("aria-checked", "true");
    expect(within(dimensionGroup).getByRole("radio", { name: "模块榜" })).toBeInTheDocument();
    expect(within(dimensionGroup).getByRole("radio", { name: "项目榜" })).toBeInTheDocument();
    expect(within(dimensionGroup).getByRole("radio", { name: "参数榜" })).toBeInTheDocument();
    expect(within(hotspotRegion).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(within(hotspotRegion).getByText("AUR-Prod")).toBeInTheDocument();
    expect(within(hotspotRegion).getByText("Charging Policy")).toBeInTheDocument();
  });

  it("switches hotspot ranking between project, module, and parameter dimensions", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    const hotspotRegion = screen.getByRole("region", { name: "风险热区证据" });
    const dimensionGroup = within(hotspotRegion).getByRole("group", { name: "热榜维度" });
    const moduleToggle = within(dimensionGroup).getByRole("radio", { name: "模块榜" });
    const projectToggle = within(dimensionGroup).getByRole("radio", { name: "项目榜" });
    const parameterToggle = within(dimensionGroup).getByRole("radio", { name: "参数榜" });

    expect(document.querySelector(".parameter-homepage-dimension-switch")).toBeInTheDocument();
    expect(moduleToggle).toHaveClass("parameter-homepage-dimension-option");
    expect(projectToggle).toHaveClass("parameter-homepage-dimension-option");
    expect(moduleToggle).toHaveAttribute("aria-checked", "false");
    expect(projectToggle).toHaveAttribute("aria-checked", "false");
    expect(moduleToggle).toHaveAttribute("data-state", "off");
    expect(projectToggle).toHaveAttribute("data-state", "off");

    fireEvent.click(moduleToggle);

    expect(moduleToggle).toHaveAttribute("aria-checked", "true");
    expect(moduleToggle).toHaveAttribute("data-state", "on");
    expect(within(hotspotRegion).getByText("Charging Policy")).toBeInTheDocument();
    expect(within(hotspotRegion).queryByText("AUR-Prod · Charging Policy")).not.toBeInTheDocument();

    fireEvent.click(projectToggle);

    expect(projectToggle).toHaveAttribute("aria-checked", "true");
    expect(projectToggle).toHaveAttribute("data-state", "on");
    expect(within(hotspotRegion).getByText("AUR-Prod")).toBeInTheDocument();
    expect(within(hotspotRegion).queryByText("Charging Policy")).not.toBeInTheDocument();

    fireEvent.click(parameterToggle);

    expect(parameterToggle).toHaveAttribute("aria-checked", "true");
    expect(parameterToggle).toHaveAttribute("data-state", "on");
    expect(within(hotspotRegion).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(within(hotspotRegion).getAllByText(/AUR-Prod · Charging Policy/).length).toBeGreaterThan(0);
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
    expect(document.querySelector(".personal-workbench-hero")).toBeInTheDocument();
    expect(document.querySelector(".dashboard-evidence-section")).toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-headline")).not.toBeInTheDocument();
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
    const metricValueCss = readCssBlock(css, ".parameter-homepage .homepage-metric-card [data-slot=\"card-title\"]");
    const metricValues = document.querySelectorAll(".homepage-metric-card [data-slot=\"card-title\"]");

    expect(document.querySelectorAll(".homepage-metric-card")).toHaveLength(4);
    expect(metricValues).toHaveLength(4);
    expect(metricValues[0]).toHaveTextContent(String(initialState.parameters.length));
    expect(metricCardCss).toContain("gap: 6px;");
    expect(metricCardCss).toContain("min-height: 96px;");
    expect(pageCardCss).toContain("padding: 12px 14px;");
    expect(metricValueCss).toContain("font-size: 22px;");
  });

  it("keeps hotspot rows readable in accordion and mobile layouts", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const accordionRowCss = readCssBlockAfter(css, "@media (max-width: 1099px)", ".hotspot-row");
    const accordionSelectCss = readCssBlockAfter(css, "@media (max-width: 1099px)", ".hotspot-row-select");
    const accordionTitleCss = readCssBlockAfter(css, "@media (max-width: 1099px)", ".hotspot-title");
    const mobileSelectCss = readCssBlockAfter(css, "@media (max-width: 768px)", ".hotspot-row-select");
    const mobileScoreCss = readCssBlockAfter(css, "@media (max-width: 768px)", ".hotspot-col-score");

    expect(accordionRowCss).toContain("overflow: visible;");
    expect(accordionSelectCss).toContain("grid-template-areas:");
    expect(accordionSelectCss).toContain("minmax(0, 1fr)");
    expect(accordionSelectCss).not.toContain("100px 140px 76px");
    expect(accordionTitleCss).toContain("white-space: normal;");
    expect(accordionTitleCss).toContain("overflow-wrap: anywhere;");
    expect(mobileSelectCss).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(mobileSelectCss).toContain("grid-template-areas:");
    expect(mobileScoreCss).toContain("width: 100%;");
  });

  it("defines leaderboard hotspot styles and removes legacy hotspot-card rules", () => {
    const css = readFileSync("src/styles.css", "utf8");

    expect(css).toContain("--risk-high: #d23c3c;");
    expect(css).toContain("--risk-medium: #e4953a;");
    expect(css).toContain("--risk-low: #6a8ad6;");
    expect(css).toContain(".personal-workbench-hero {");
    expect(css).toContain(".next-action-card {");
    expect(css).toContain(".scenario-entry {");
    expect(css).toContain(".dashboard-evidence-section {");
    expect(css).toContain(".parameter-homepage-charts {");
    expect(css).toContain(".update-trend-chart {");
    expect(css).toContain(".project-risk-bar-chart {");
    expect(css).toContain(".hotspot-list {");
    expect(css).toContain(".hotspot-row-select {");
    expect(css).toContain(".hotspot-panel {");
    expect(css).toContain(".parameter-homepage-dimension-switch {");
    expect(readCssBlock(css, ".parameter-homepage-dimension-switch")).toContain("flex-wrap: wrap;");
    expect(readCssBlock(css, ".parameter-homepage-select")).toContain("flex-wrap: wrap;");
    expect(css).toContain(".parameter-homepage-dimension-option[data-state=\"on\"]");
    expect(css).toContain(".parameter-homepage-select-label {");
    expect(css).toContain(".action-btn--primary {");
    expect(css).toContain("@media (max-width: 1040px)");
    expect(css).toContain("@media (max-width: 768px)");
    expect(css).not.toContain(".parameter-homepage-headline {");
    expect(css).not.toContain(".parameter-homepage-quick-nav");
    expect(css).not.toContain(".hotspot-card {");
    expect(css).not.toContain(".hotspot-card.selected");
    expect(css).not.toContain(".parameter-homepage-hotspot-head");
    expect(css).not.toContain(".parameter-homepage-hotspot-stats");
  });
});
