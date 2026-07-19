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
    expect(selections.at(-1)).toBe("effective-mt5788");

    fireEvent.keyDown(mt5788, { key: " " });
    expect(selections.at(-1)).toBe("effective-mt5788");
  });
});
