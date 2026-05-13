import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlatformFlowSection } from "./PlatformFlowSection";

afterEach(cleanup);

describe("PlatformFlowSection", () => {
  it("renders the section heading and the three tab buttons", () => {
    render(<PlatformFlowSection />);

    expect(screen.getByRole("heading", { name: "一条可审阅工作流，三种场景接入" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["参数管理", "调试平台", "日志分析"]);
  });

  it("selects the parameter-management tab by default and shows the generic parameter catalog preview", () => {
    render(<PlatformFlowSection />);

    const firstTab = screen.getByRole("tab", { name: "参数管理" });
    expect(firstTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("参数目录")).toBeInTheDocument();
  });

  it("switches preview content when a different tab is clicked", () => {
    render(<PlatformFlowSection />);

    fireEvent.click(screen.getByRole("tab", { name: "日志分析" }));

    expect(screen.getByRole("tab", { name: "日志分析" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("证据链路")).toBeInTheDocument();
  });

  it("shows the debugging preview meta when the debugging tab is selected", () => {
    render(<PlatformFlowSection />);

    fireEvent.click(screen.getByRole("tab", { name: "调试平台" }));

    expect(screen.getByRole("tab", { name: "调试平台" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("调试场景")).toBeInTheDocument();
  });

  it("keeps workflow feature copy generic instead of naming projects, devices, logs, or analysis objects", () => {
    const { container } = render(<PlatformFlowSection />);

    expect(container).toHaveTextContent("全量参数与全项目覆盖。");
    expect(container).toHaveTextContent("覆盖全部业务参数与项目范围，统一检索、对比和审阅入口。");
    expect(container).not.toHaveTextContent("共享参数目录。");
    expect(container).toHaveTextContent("Agent 参数建议。");
    expect(container).toHaveTextContent("Agent 基于上下文生成候选参数，人负责确认、审阅和下发。");
    expect(container).not.toHaveTextContent("实时调参。");
    expect(container).not.toHaveTextContent("关键参数在下发前保留确认。");
    expect(container).not.toHaveTextContent(/Aurora|Nebula|Atlas|ChargeLab_X01|charging_thermal_trace|battery_pack_temp|关键温度/);

    fireEvent.click(screen.getByRole("tab", { name: "调试平台" }));
    expect(container).toHaveTextContent("从参数变更或日志证据直接进入对应调试场景");
    expect(container).not.toHaveTextContent(/Aurora|Nebula|Atlas|ChargeLab_X01|charging_thermal_trace|battery_pack_temp|关键温度/);

    fireEvent.click(screen.getByRole("tab", { name: "日志分析" }));
    expect(container).toHaveTextContent("围绕异常事件和关键证据组织可审阅链路");
    expect(container).not.toHaveTextContent(/Aurora|Nebula|Atlas|ChargeLab_X01|charging_thermal_trace|battery_pack_temp|关键温度/);
  });

  it("moves the selection with ArrowRight and ArrowLeft", () => {
    render(<PlatformFlowSection />);

    const firstTab = screen.getByRole("tab", { name: "参数管理" });
    firstTab.focus();
    fireEvent.keyDown(firstTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "调试平台" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(screen.getByRole("tab", { name: "调试平台" }), { key: "ArrowLeft" });
    expect(firstTab).toHaveAttribute("aria-selected", "true");
  });

  it("moves from the focused tab instead of the previously selected tab", () => {
    render(<PlatformFlowSection />);

    fireEvent.click(screen.getByRole("tab", { name: "日志分析" }));
    const firstTab = screen.getByRole("tab", { name: "参数管理" });

    firstTab.focus();
    fireEvent.keyDown(firstTab, { key: "ArrowRight" });

    expect(screen.getByRole("tab", { name: "调试平台" })).toHaveAttribute("aria-selected", "true");
  });
});
