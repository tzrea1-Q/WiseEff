import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParameterManagementHomePage } from "./ParameterManagementHomePage";
import { initialState } from "./mockData";

afterEach(() => {
  cleanup();
});

describe("ParameterManagementHomePage", () => {
  it("renders the analytics dashboard top-level layout", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    expect(screen.queryByRole("heading", { name: "智能参数管理" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "时间范围" })).toBeInTheDocument();
    expect(screen.getByTestId("parameter-home-headline")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "核心指标" })).toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-charts")).toBeInTheDocument();
    expect(document.querySelector(".update-trend-chart")).toBeInTheDocument();
    expect(screen.getByText("各项目参数更新情况")).toBeInTheDocument();
    expect(document.querySelector(".project-risk-bar-chart")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "入口卡片" })).toBeInTheDocument();
    expect(screen.getByText("热门模块")).toBeInTheDocument();
  });

  it("does not render the removed key-change and review sections", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    expect(screen.queryByText("关键参数变化")).not.toBeInTheDocument();
    expect(screen.queryByText("审核合入情况")).not.toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-insights")).not.toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-change-list")).not.toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-flow")).not.toBeInTheDocument();
  });

  it("shows the four metric cards including developer roster", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);
    const metrics = screen.getByRole("region", { name: "核心指标" });

    expect(within(metrics).getByText("参数总量")).toBeInTheDocument();
    expect(within(metrics).getByText("管理项目总数")).toBeInTheDocument();
    expect(within(metrics).getByText("修改频次")).toBeInTheDocument();
    expect(within(metrics).getByText("开发人员总数")).toBeInTheDocument();
    expect(within(metrics).getByText(String(initialState.parameters.length))).toBeInTheDocument();
    expect(within(metrics).getByText(String(initialState.configDraft.projects.length))).toBeInTheDocument();
    expect(within(metrics).getByText(String(initialState.developers.length))).toBeInTheDocument();
    expect(within(metrics).queryByText("共享参数定义")).not.toBeInTheDocument();
    expect(within(metrics).queryByText("关键风险参数")).not.toBeInTheDocument();
  });

  it("renders the AI headline and reflects the current time window", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} timeWindow="7d" />);
    const headline = screen.getByTestId("parameter-home-headline");

    expect(headline.textContent).toMatch(/近 7 天/);
  });

  it("entry cards remain and navigate as before", () => {
    const onNavigate = vi.fn();
    render(<ParameterManagementHomePage state={initialState} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "进入 参数合入审核" }));
    expect(onNavigate).toHaveBeenCalledWith("/parameter-review");

    const entryGrid = screen.getByRole("region", { name: "入口卡片" });
    expect(within(entryGrid).getByRole("button", { name: "进入 参数合入审核" })).toBeInTheDocument();
  });

  it("keeps hotspot dimension switcher behaviour", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);
    const hotspotRegion = screen.getByRole("region", { name: "热门模块" });
    const dimensionSelect = within(hotspotRegion).getByRole("combobox", { name: "热榜维度" });

    expect(dimensionSelect).toHaveValue("module");
    fireEvent.change(dimensionSelect, { target: { value: "project" } });
    expect(dimensionSelect).toHaveValue("project");
    expect(within(hotspotRegion).getByText("AUR-Prod")).toBeInTheDocument();
  });

  it("clicking a risk chart row navigates to the parameters route with a project query", () => {
    const onNavigate = vi.fn();
    render(<ParameterManagementHomePage state={initialState} onNavigate={onNavigate} />);

    const firstRow = document.querySelector('[data-testid="project-risk-row"]') as HTMLButtonElement;
    expect(firstRow).toBeTruthy();
    fireEvent.click(firstRow);

    const [calledPath] = onNavigate.mock.calls.at(-1) ?? [];
    expect(calledPath).toMatch(/^\/parameters\?project=/);
  });

  it("reports time window changes via the provided callback", () => {
    const onTimeWindowChange = vi.fn();
    render(
      <ParameterManagementHomePage
        state={initialState}
        onNavigate={vi.fn()}
        timeWindow="30d"
        onTimeWindowChange={onTimeWindowChange}
      />
    );
    fireEvent.change(screen.getByRole("combobox", { name: "时间范围" }), {
      target: { value: "180d" }
    });
    expect(onTimeWindowChange).toHaveBeenCalledWith("180d");
  });

  it("exposes stable class hooks for dashboard layout", () => {
    render(<ParameterManagementHomePage state={initialState} onNavigate={vi.fn()} />);

    expect(document.querySelector(".parameter-homepage")).toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-time-window")).toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-headline")).toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-metrics")).toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-charts")).toBeInTheDocument();
    expect(screen.queryByText("分项目风险分布")).not.toBeInTheDocument();
    expect(document.querySelector(".homepage-entry-grid")).toBeInTheDocument();
    expect(document.querySelector(".parameter-homepage-hotspots")).toBeInTheDocument();
  });
});
