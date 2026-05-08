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
    expect(screen.getByRole("heading", { name: "智能参数管理" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "时间范围" })).toHaveValue("30d");
    expect(screen.getByText("参数变化态势")).toBeInTheDocument();
    expect(screen.getByText("系统按变更频次、风险权重、影响范围、流程堆积与异常偏离识别参数管理优先级。")).toBeInTheDocument();
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

  it("switches time windows and expands hotspot explanations", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    fireEvent.change(screen.getByRole("combobox", { name: "时间范围" }), { target: { value: "7d" } });
    expect(screen.getByText("参数变化态势")).toBeInTheDocument();
    expect(screen.queryByText("近 7 天参数变化态势")).not.toBeInTheDocument();

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

  it("offers explicit 7, 30, and 180 day time windows", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    const timeWindowSelect = screen.getByRole("combobox", { name: "时间范围" });

    expect(within(timeWindowSelect).getByRole("option", { name: "7天" })).toHaveValue("7d");
    expect(within(timeWindowSelect).getByRole("option", { name: "30天" })).toHaveValue("30d");
    expect(within(timeWindowSelect).getByRole("option", { name: "180天" })).toHaveValue("180d");
    expect(screen.queryByRole("button", { name: "近 30 天" })).not.toBeInTheDocument();

    fireEvent.change(timeWindowSelect, { target: { value: "180d" } });

    expect(timeWindowSelect).toHaveValue("180d");
    expect(screen.getByText("参数变化态势")).toBeInTheDocument();
    expect(screen.queryByText("近 180 天参数变化态势")).not.toBeInTheDocument();
  });

  it("keeps the time range control in a light context panel without repeating the active range", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    const timeWindowPanel = document.querySelector(".homepage-window-switcher");

    expect(timeWindowPanel).toBeInTheDocument();
    expect(within(timeWindowPanel as HTMLElement).getByRole("combobox", { name: "时间范围" })).toHaveValue("30d");
    expect(timeWindowPanel).not.toHaveTextContent("看板口径");
    expect(timeWindowPanel).not.toHaveTextContent("近 30 天参数变化态势");
    expect(timeWindowPanel).toHaveTextContent("AI 分析维度");
    expect(timeWindowPanel).toHaveTextContent("变更频次、风险权重、影响范围、流程堆积、异常偏离");
    expect(timeWindowPanel).not.toHaveClass("parameter-homepage-status");
  });

  it("updates visible analytics when switching time windows", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    const metrics = screen.getByRole("region", { name: "核心指标" });
    const hotspotRegion = screen.getByRole("region", { name: "热门模块" });
    const initialChangeEvents = within(metrics).getByText("修改频次").parentElement?.querySelector("strong")?.textContent;
    const initialTopHotspotScore = within(hotspotRegion).getAllByText(/分/)[0].textContent;

    fireEvent.change(screen.getByRole("combobox", { name: "时间范围" }), { target: { value: "7d" } });

    const sevenDayChangeEvents = within(metrics).getByText("修改频次").parentElement?.querySelector("strong")?.textContent;
    const sevenDayTopHotspotScore = within(hotspotRegion).getAllByText(/分/)[0].textContent;

    expect(sevenDayChangeEvents).not.toBe(initialChangeEvents);
    expect(sevenDayTopHotspotScore).not.toBe(initialTopHotspotScore);
  });

  it("switches hotspot ranking between project and module dimensions", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    const hotspotRegion = screen.getByRole("region", { name: "热门模块" });
    const dimensionSelect = within(hotspotRegion).getByRole("combobox", { name: "热榜维度" });

    expect(dimensionSelect).toHaveValue("module");
    expect(within(dimensionSelect).getByRole("option", { name: "模块" })).toHaveValue("module");
    expect(within(dimensionSelect).getByRole("option", { name: "项目" })).toHaveValue("project");
    expect(within(hotspotRegion).getByText("Charging Policy")).toBeInTheDocument();
    expect(within(hotspotRegion).queryByText("AUR-Prod · Charging Policy")).not.toBeInTheDocument();

    fireEvent.change(dimensionSelect, { target: { value: "project" } });

    expect(dimensionSelect).toHaveValue("project");
    expect(within(hotspotRegion).getByText("AUR-Prod")).toBeInTheDocument();
    expect(within(hotspotRegion).queryByText("Charging Policy")).not.toBeInTheDocument();
  });

  it("uses stable class hooks for responsive homepage layout", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    expect(document.querySelector(".parameter-homepage")).toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-hero")).toBeInTheDocument();
    expect(document.querySelector(".homepage-window-switcher")).toBeInTheDocument();
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
