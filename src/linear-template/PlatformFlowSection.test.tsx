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

  it("selects the parameter-management tab by default and shows fast_charge_current_limit_ma", () => {
    render(<PlatformFlowSection />);

    const firstTab = screen.getByRole("tab", { name: "参数管理" });
    expect(firstTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
  });

  it("switches preview content when a different tab is clicked", () => {
    render(<PlatformFlowSection />);

    fireEvent.click(screen.getByRole("tab", { name: "日志分析" }));

    expect(screen.getByRole("tab", { name: "日志分析" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("battery_pack_temp=46.8C")).toBeInTheDocument();
  });

  it("shows the debugging preview meta when the debugging tab is selected", () => {
    render(<PlatformFlowSection />);

    fireEvent.click(screen.getByRole("tab", { name: "调试平台" }));

    expect(screen.getByRole("tab", { name: "调试平台" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("ChargeLab_X01")).toBeInTheDocument();
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
