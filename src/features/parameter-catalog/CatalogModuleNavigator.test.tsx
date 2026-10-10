import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectConsistencyMeasurements } from "../../../e2e/quality/consistency";
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
  it("measures all branches under one root while keeping separate navigators independent", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 42, top: 0, right: 142, bottom: 28, width: 100, height: 28,
      x: 42, y: 0, toJSON: () => ({})
    });
    const { container } = render(<main>
      <CatalogModuleNavigator nodes={nodes} selectedId={null} onSelectNode={vi.fn()} />
      <CatalogModuleNavigator nodes={nodes} selectedId={null} onSelectNode={vi.fn()} />
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
    const disclosure = screen.getByRole("button", { name: "收起 电源" });
    expect(disclosure).toHaveClass("dts-topology-navigator__disclosure");
    expect(disclosure.querySelector("svg")).toBeInTheDocument();
    expect(disclosure.parentElement).toHaveClass("dts-topology-navigator__item");
    const subject = screen.getByRole("button", { name: "选择主体 很长的电池模块名称" });
    expect(subject.closest("ul")).toHaveClass("dts-topology-navigator__group");
    expect(within(subject).getByText("已登记")).toBeVisible();
    expect(screen.getByRole("button", { name: /^电源\s*2$/ })).toBeVisible();

    fireEvent.click(disclosure);
    expect(onSelectNode).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "选择主体 很长的电池模块名称" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开 电源" }));
    fireEvent.click(screen.getByRole("button", { name: "选择主体 很长的电池模块名称" }));
    expect(onSelectNode).toHaveBeenCalledWith(nodes[0].children[0]);
  });
});
