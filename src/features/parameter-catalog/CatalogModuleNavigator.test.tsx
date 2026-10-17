import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectConsistencyMeasurements } from "../../../e2e/quality/consistency-collector";
import { CatalogModuleNavigator } from "./CatalogModuleNavigator";
import type { CatalogNavigatorNode } from "./catalogModuleScope";

const nodes: CatalogNavigatorNode[] = [{
  id: "power", kind: "module", displayName: "电源", subjectCount: 2,
  children: [{
    id: "subject:battery", kind: "subject", displayName: "很长的电池模块名称",
    subjectId: "battery", subjectCount: 0, meta: "已登记", children: []
  }]
}];

afterEach(() => vi.restoreAllMocks());

describe("Catalog module navigation", () => {
  it("searches names through ancestors without selecting, preserves full module scope and restores expansion on clear", () => {
    const onSelectNode = vi.fn();
    const battery = { ...nodes[0].children[0], displayName: "vendor,Battery" };
    const power = { ...nodes[0], displayName: "Power", children: [battery,
      { ...battery, id: "subject:charger", subjectId: "charger", displayName: "充电" }] };
    render(<CatalogModuleNavigator nodes={[power, { ...power, id: "wifi", displayName: "无线", children: [] }]}
      selectedId={null} onSelectNode={onSelectNode} />);
    const search = screen.getByRole("searchbox", { name: "搜索模块" });
    fireEvent.click(screen.getByRole("button", { name: "展开 Power" }));
    fireEvent.change(search, { target: { value: "  BATTERY " } });
    expect(screen.getByRole("button", { name: /^Power\s*2$/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "选择主体 vendor,Battery" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "选择主体 充电" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^无线/ })).not.toBeInTheDocument();
    expect(onSelectNode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "选择主体 vendor,Battery" }));
    expect(onSelectNode).toHaveBeenCalledWith(battery);
    fireEvent.change(search, { target: { value: "power" } });
    expect(screen.getByRole("button", { name: "选择主体 充电" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "收起 Power" }));
    expect(screen.queryByRole("button", { name: "选择主体 充电" })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByRole("status")).toHaveTextContent("没有匹配的模块或主体。");
    fireEvent.click(screen.getByRole("button", { name: "清空输入" }));
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(screen.getByRole("button", { name: "收起 Power" })).toBeVisible();
    expect(screen.getByRole("button", { name: "选择主体 充电" })).toBeVisible();
    expect(screen.getByRole("button", { name: /^无线/ })).toBeVisible();
    fireEvent.change(search, { target: { value: "power" } });
    expect(screen.getByRole("button", { name: "选择主体 充电" })).toBeVisible();
  });
  it("collapses deeper branches by default and reveals the selected subject path", () => {
    const nested = [{ ...nodes[0], children: [{ ...nodes[0], id: "child-module", displayName: "子模块" }] }];
    const view = render(<CatalogModuleNavigator nodes={nested} selectedId={null} onSelectNode={vi.fn()} />);
    expect(screen.getByRole("button", { name: "展开 电源" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "展开 子模块" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开 电源" }));
    expect(screen.getByRole("button", { name: "展开 子模块" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "选择主体 很长的电池模块名称" })).not.toBeInTheDocument();
    view.rerender(<CatalogModuleNavigator nodes={nested} selectedId="subject:battery" onSelectNode={vi.fn()} />);
    expect(screen.getByRole("button", { name: "选择主体 很长的电池模块名称" })).toBeVisible();
  });
  it("measures all branches under one root while keeping separate navigators independent", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 42, top: 0, right: 142, bottom: 28, width: 100, height: 28,
      x: 42, y: 0, toJSON: () => ({})
    });
    const { container } = render(<main>
      <CatalogModuleNavigator nodes={nodes} selectedId={null} onSelectNode={vi.fn()} defaultExpandDepth={1} />
      <CatalogModuleNavigator nodes={nodes} selectedId={null} onSelectNode={vi.fn()} defaultExpandDepth={1} />
    </main>);
    for (const element of container.querySelectorAll("*")) {
      Object.defineProperty(element, "checkVisibility", { value: () => true });
    }
    const labels = collectConsistencyMeasurements().moduleTreeLabels;
    expect(labels.map((label) => label.depth)).toEqual([1, 2, 1, 2]);
    expect(labels[0].tree).toBe(labels[1].tree);
    expect(labels[2].tree).toBe(labels[3].tree);
    expect(labels[0].tree).not.toBe(labels[2].tree);
  });

  it("uses the shared disclosure, row and indentation geometry without losing subject metadata", () => {
    const onSelectNode = vi.fn();
    render(<CatalogModuleNavigator nodes={nodes} selectedId={null} onSelectNode={onSelectNode} />);
    fireEvent.click(screen.getByRole("button", { name: "展开 电源" }));
    const disclosure = screen.getByRole("button", { name: "收起 电源" });
    expect(disclosure).toHaveClass("dts-topology-navigator__disclosure");
    expect(disclosure.querySelector("svg")).toBeInTheDocument();
    expect(disclosure.parentElement).toHaveClass("dts-topology-navigator__item");
    const subject = screen.getByRole("button", { name: "选择主体 很长的电池模块名称" });
    expect(subject.closest("ul")).toHaveClass("dts-topology-navigator__group");
    expect(within(subject).getByText("已登记")).toBeVisible();
    expect(subject).toHaveAttribute("title", "很长的电池模块名称 · 已登记");
    expect(within(subject).getByText("已登记").parentElement).toBe(within(subject).getByText("很长的电池模块名称").parentElement);
    expect(screen.getByRole("button", { name: /^电源\s*2$/ })).toBeVisible();

    fireEvent.click(disclosure);
    expect(onSelectNode).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "选择主体 很长的电池模块名称" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开 电源" }));
    fireEvent.click(screen.getByRole("button", { name: "选择主体 很长的电池模块名称" }));
    expect(onSelectNode).toHaveBeenCalledWith(nodes[0].children[0]);
  });
});
