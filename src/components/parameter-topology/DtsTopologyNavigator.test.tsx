import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { DtsWorkbenchTreeNode } from "@/application/parameters/buildDtsTopologyTree";

import { DtsTopologyNavigator } from "./DtsTopologyNavigator";

const tree: DtsWorkbenchTreeNode[] = [
  {
    id: "effective-root",
    parentId: null,
    label: "/",
    name: "/",
    unitAddress: null,
    compatible: null,
    bindingIds: [],
    bindingCount: 3,
    attentionCount: 1,
    children: [
      {
        id: "effective-amba",
        parentId: "effective-root",
        label: "amba",
        name: "amba",
        unitAddress: null,
        compatible: "arm,amba-bus",
        bindingIds: [],
        bindingCount: 3,
        attentionCount: 1,
        children: [
          {
            id: "effective-i2c",
            parentId: "effective-amba",
            label: "i2c@FDF5E000",
            name: "i2c",
            unitAddress: "FDF5E000",
            compatible: null,
            bindingIds: ["binding-hold-time"],
            bindingCount: 3,
            attentionCount: 1,
            children: [
              {
                id: "effective-sc8562",
                parentId: "effective-i2c",
                label: "sc8562@6E",
                name: "sc8562",
                unitAddress: "6E",
                compatible: "sc8562",
                bindingIds: ["binding-gpio-int"],
                bindingCount: 1,
                attentionCount: 1,
                children: []
              },
              {
                id: "effective-mt5788",
                parentId: "effective-i2c",
                label: "mt5788@2B",
                name: "mt5788",
                unitAddress: "2B",
                compatible: "mt,mt5788",
                bindingIds: ["binding-rx-fod", "binding-time-para"],
                bindingCount: 2,
                attentionCount: 0,
                children: []
              }
            ]
          }
        ]
      }
    ]
  }
];

describe("DtsTopologyNavigator", () => {
  it("renders an accessible effective tree and expands the selected node path", () => {
    render(
      <DtsTopologyNavigator
        view="effective"
        nodes={tree}
        selectedNodeId="effective-sc8562"
        onSelectNode={vi.fn()}
      />
    );

    const navigator = screen.getByRole("tree", { name: "生效 DTS 拓扑" });
    const root = within(navigator).getByRole("treeitem", { name: /^\// });
    const amba = within(navigator).getByRole("treeitem", { name: /amba/ });
    const i2c = within(navigator).getByRole("treeitem", { name: /i2c@FDF5E000/ });
    const sc8562 = within(navigator).getByRole("treeitem", { name: /sc8562@6E/ });

    expect(root).toHaveAttribute("aria-expanded", "true");
    expect(amba).toHaveAttribute("aria-expanded", "true");
    expect(i2c).toHaveAttribute("aria-expanded", "true");
    expect(sc8562).toHaveAttribute("aria-selected", "true");
    expect(sc8562).toHaveAttribute("tabindex", "0");
    expect(within(navigator).getAllByText("1 个待处理").length).toBeGreaterThan(0);
    const attention = within(sc8562).getByText("1 个待处理");
    expect(attention.parentElement).toHaveClass("dts-topology-navigator__meta");
  });

  it("uses root-only default expansion when there is no selection", () => {
    render(
      <DtsTopologyNavigator
        view="source"
        nodes={tree}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
      />
    );

    const navigator = screen.getByRole("tree", { name: "源 DTS 拓扑" });
    expect(within(navigator).getByRole("treeitem", { name: /amba/ })).toBeVisible();
    expect(within(navigator).queryByRole("treeitem", { name: /i2c@FDF5E000/ })).not.toBeInTheDocument();
  });

  it("supports click, Enter, Space, ArrowRight and ArrowLeft with roving focus", () => {
    const selections: string[] = [];
    function Harness() {
      const [selectedNodeId, setSelectedNodeId] = useState<string | null>("effective-sc8562");
      return (
        <DtsTopologyNavigator
          view="effective"
          nodes={tree}
          selectedNodeId={selectedNodeId}
          onSelectNode={(nodeId) => {
            selections.push(nodeId);
            setSelectedNodeId(nodeId);
          }}
        />
      );
    }

    render(<Harness />);
    const navigator = screen.getByRole("tree", { name: "生效 DTS 拓扑" });
    const sc8562 = within(navigator).getByRole("treeitem", { name: /sc8562@6E/ });
    const i2c = within(navigator).getByRole("treeitem", { name: /i2c@FDF5E000/ });

    sc8562.focus();
    fireEvent.keyDown(sc8562, { key: "ArrowLeft" });
    expect(i2c).toHaveFocus();

    fireEvent.keyDown(i2c, { key: "ArrowLeft" });
    expect(i2c).toHaveAttribute("aria-expanded", "false");
    expect(within(navigator).queryByRole("treeitem", { name: /sc8562@6E/ })).not.toBeInTheDocument();

    fireEvent.keyDown(i2c, { key: "ArrowRight" });
    expect(i2c).toHaveAttribute("aria-expanded", "true");
    const reopenedSc8562 = within(navigator).getByRole("treeitem", { name: /sc8562@6E/ });
    fireEvent.keyDown(i2c, { key: "ArrowRight" });
    expect(reopenedSc8562).toHaveFocus();

    fireEvent.keyDown(reopenedSc8562, { key: "Enter" });
    expect(selections.at(-1)).toBe("effective-sc8562");

    const mt5788 = within(navigator).getByRole("treeitem", { name: /mt5788@2B/ });
    fireEvent.click(mt5788);
    expect(mt5788).toHaveAttribute("aria-selected", "true");
    expect(mt5788).toHaveFocus();
    expect(mt5788).toHaveAttribute("tabindex", "0");
    expect(selections.at(-1)).toBe("effective-mt5788");

    fireEvent.keyDown(mt5788, { key: " " });
    expect(selections.at(-1)).toBe("effective-mt5788");
  });

  it("traverses every visible item with ArrowUp, ArrowDown, Home and End independently of selection", () => {
    render(
      <DtsTopologyNavigator
        view="effective"
        nodes={tree}
        selectedNodeId="effective-sc8562"
        onSelectNode={vi.fn()}
      />
    );

    const navigator = screen.getByRole("tree", { name: "生效 DTS 拓扑" });
    const root = within(navigator).getByRole("treeitem", { name: /^\// });
    const i2c = within(navigator).getByRole("treeitem", { name: /i2c@FDF5E000/ });
    const sc8562 = within(navigator).getByRole("treeitem", { name: /sc8562@6E/ });
    const mt5788 = within(navigator).getByRole("treeitem", { name: /mt5788@2B/ });

    sc8562.focus();
    fireEvent.keyDown(sc8562, { key: "ArrowDown" });
    expect(mt5788).toHaveFocus();
    expect(mt5788).toHaveAttribute("tabindex", "0");
    expect(sc8562).toHaveAttribute("tabindex", "-1");
    expect(sc8562).toHaveAttribute("aria-selected", "true");
    expect(mt5788).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(mt5788, { key: "ArrowUp" });
    expect(sc8562).toHaveFocus();
    expect(sc8562).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(sc8562, { key: "Home" });
    expect(root).toHaveFocus();
    expect(root).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(root, { key: "End" });
    expect(mt5788).toHaveFocus();
    expect(mt5788).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(mt5788, { key: "ArrowLeft" });
    expect(i2c).toHaveFocus();
    expect(i2c).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(i2c, { key: "ArrowLeft" });
    expect(i2c).toHaveFocus();
    expect(i2c).toHaveAttribute("aria-expanded", "false");
    expect(i2c).toHaveAttribute("tabindex", "0");
    expect(within(navigator).queryByRole("treeitem", { name: /mt5788@2B/ })).not.toBeInTheDocument();
    expect(
      within(navigator)
        .getAllByRole("treeitem", { hidden: true })
        .filter((item) => item.tabIndex === 0)
    ).toHaveLength(1);
  });

  it("preserves the focused active item when controlled selection changes", () => {
    const { rerender } = render(
      <DtsTopologyNavigator
        view="effective"
        nodes={tree}
        selectedNodeId="effective-sc8562"
        onSelectNode={vi.fn()}
      />
    );

    const sc8562 = screen.getByRole("treeitem", { name: /sc8562@6E/ });
    sc8562.focus();
    rerender(
      <DtsTopologyNavigator
        view="effective"
        nodes={tree}
        selectedNodeId="effective-mt5788"
        onSelectNode={vi.fn()}
      />
    );

    const mt5788 = screen.getByRole("treeitem", { name: /mt5788@2B/ });
    expect(sc8562).toHaveFocus();
    expect(sc8562).toHaveAttribute("tabindex", "0");
    expect(sc8562).toHaveAttribute("aria-selected", "false");
    expect(mt5788).toHaveAttribute("tabindex", "-1");
    expect(mt5788).toHaveAttribute("aria-selected", "true");
  });

  it("syncs the active item to an externally selected hidden descendant when the tree is not focused", () => {
    const { rerender } = render(
      <DtsTopologyNavigator
        view="effective"
        nodes={tree}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
      />
    );

    expect(screen.getByRole("treeitem", { name: /^\// })).toHaveAttribute("tabindex", "0");
    expect(screen.queryByRole("treeitem", { name: /mt5788@2B/ })).not.toBeInTheDocument();
    rerender(
      <DtsTopologyNavigator
        view="effective"
        nodes={tree}
        selectedNodeId="effective-mt5788"
        onSelectNode={vi.fn()}
      />
    );

    const mt5788 = screen.getByRole("treeitem", { name: /mt5788@2B/ });
    expect(mt5788).toHaveAttribute("aria-selected", "true");
    expect(mt5788).toHaveAttribute("tabindex", "0");
  });

  it("announces an empty state without rendering an invalid empty tree", () => {
    render(
      <DtsTopologyNavigator
        view="effective"
        nodes={[]}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
      />
    );

    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "生效 DTS 拓扑" })).toHaveTextContent(
      "暂无 DTS 拓扑节点"
    );
    expect(screen.queryByRole("treeitem")).not.toBeInTheDocument();
  });
});
