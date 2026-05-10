import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParameterManagementHomePage } from "./ParameterManagementHomePage";
import { initialState } from "./mockData";

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
    expect(within(screen.getByRole("region", { name: "核心指标" })).getByText("共享参数定义")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "核心指标" })).getByText("10")).toBeInTheDocument();
    expect(screen.getByText("热门模块")).toBeInTheDocument();
    expect(screen.getByText("关键参数变化")).toBeInTheDocument();
    expect(screen.getByText("审核合入情况")).toBeInTheDocument();
    expect(screen.queryByText("治理流健康度")).not.toBeInTheDocument();
  });

  it("renders entry cards and calls navigation with contextual paths", () => {
    const onNavigate = vi.fn();
    render(<ParameterManagementHomePage state={initialState} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "进入 参数合入审核" }));
    expect(onNavigate).toHaveBeenCalledWith("/parameter-review");

    const entryGrid = screen.getByRole("region", { name: "入口卡片" });
    expect(within(entryGrid).getByRole("button", { name: "进入 参数合入审核" })).toBeInTheDocument();

    const hotspotRegion = screen.getByRole("region", { name: "热门模块" });
    fireEvent.click(within(hotspotRegion).getAllByRole("button", { name: /进入/ })[0]);

    expect(onNavigate).toHaveBeenLastCalledWith(expect.stringMatching(/^\/(parameters|parameter-review)/));
  });

  it("expands hotspot explanations", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    const hotspotRegion = screen.getByRole("region", { name: "热门模块" });
    fireEvent.click(within(hotspotRegion).getAllByRole("button", { name: /查看评分/ })[0]);

    expect(screen.getByText("AI 评分拆解")).toBeInTheDocument();
    expect(screen.getByText("变更频次")).toBeInTheDocument();
    expect(screen.getByText("风险权重")).toBeInTheDocument();
    expect(screen.getByText("影响范围")).toBeInTheDocument();
    expect(screen.getByText("流程堆积")).toBeInTheDocument();
    expect(screen.getByText("异常偏离")).toBeInTheDocument();
    expect(screen.getByText("统计所选窗口内参数与审阅请求的变更密度。")).toBeInTheDocument();
    expect(screen.getByText("按高、中、低风险参数数量换算治理优先级。")).toBeInTheDocument();
    expect(screen.getByText("结合参数定义覆盖面与日志命中信号评估影响面。")).toBeInTheDocument();
    expect(screen.getByText("反映审阅请求和高风险项在流程中的堆积程度。")).toBeInTheDocument();
    expect(screen.getByText("衡量当前值相对推荐值的偏离幅度。")).toBeInTheDocument();
    expect(screen.getByText("关联证据")).toBeInTheDocument();
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
    expect(within(hotspotRegion).getAllByText(/分/).length).toBeGreaterThan(0);
  });

  it("switches hotspot ranking between project and module dimensions", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    const hotspotRegion = screen.getByRole("region", { name: "热门模块" });
    const dimensionGroup = within(hotspotRegion).getByRole("group", { name: "热榜维度" });
    const moduleToggle = within(dimensionGroup).getByRole("radio", { name: "模块" });
    const projectToggle = within(dimensionGroup).getByRole("radio", { name: "项目" });

    expect(moduleToggle).toHaveAttribute("aria-checked", "true");
    expect(projectToggle).toHaveAttribute("aria-checked", "false");
    expect(within(hotspotRegion).getByText("Charging Policy")).toBeInTheDocument();
    expect(within(hotspotRegion).queryByText("AUR-Prod · Charging Policy")).not.toBeInTheDocument();

    fireEvent.click(projectToggle);

    expect(projectToggle).toHaveAttribute("aria-checked", "true");
    expect(within(hotspotRegion).getByText("AUR-Prod")).toBeInTheDocument();
    expect(within(hotspotRegion).queryByText("Charging Policy")).not.toBeInTheDocument();
  });

  it("uses stable class hooks for responsive homepage layout", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    expect(document.querySelector(".parameter-homepage")).toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-hero")).not.toBeInTheDocument();
    expect(document.querySelector(".homepage-window-switcher")).not.toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-select")).toBeInTheDocument();
    expect(document.querySelector(".homepage-entry-grid")).toBeInTheDocument();
    expect(document.querySelector(".homepage-entry-card")).toBeInTheDocument();
    expect(document.querySelector(".homepage-main-grid")).toBeInTheDocument();
    expect(document.querySelector(".homepage-metric-card")).toBeInTheDocument();
    expect(document.querySelector(".homepage-panel")).toBeInTheDocument();
    expect(document.querySelector(".hotspot-card")).toBeInTheDocument();
    expect(document.querySelector(".key-change-row")).toBeInTheDocument();
    expect(document.querySelector(".breakdown-row")).toBeInTheDocument();
  });
});
