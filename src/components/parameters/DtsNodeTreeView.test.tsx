import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DtsStructuralNode } from "@/application/ports/DtsStructuredRepository";
import { DtsNodeTreeView } from "./DtsNodeTreeView";

function node(overrides: Partial<DtsStructuralNode> & { nodePath: string }): DtsStructuralNode {
  return {
    name: overrides.nodePath.split("/").pop() ?? overrides.nodePath,
    labels: [],
    properties: [],
    phandleRefs: [],
    ...overrides
  };
}

const NODES: DtsStructuralNode[] = [
  node({ nodePath: "amba" }),
  node({ nodePath: "amba/i2c@XXXX0000" }),
  node({ nodePath: "amba/i2c@XXXX0000/chip@6E" }),
  node({ nodePath: "demo_bool" }),
  node({ nodePath: "demo_regulator" })
];

afterEach(() => {
  cleanup();
});

describe("DtsNodeTreeView", () => {
  it("renders a searchable, clickable list of nodePaths and reports selection", () => {
    const onSelectNode = vi.fn();

    render(
      <DtsNodeTreeView nodes={NODES} selectedNodePath="demo_bool" onSelectNode={onSelectNode} />
    );

    const tree = screen.getByRole("tree", { name: "DTS 节点树" });
    expect(within(tree).getByRole("treeitem", { name: "amba" })).toBeInTheDocument();
    expect(within(tree).getByRole("treeitem", { name: "amba/i2c@XXXX0000/chip@6E" })).toBeInTheDocument();
    expect(within(tree).getByRole("treeitem", { name: "demo_bool" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    fireEvent.change(screen.getByLabelText("筛选节点路径"), { target: { value: "chip@6E" } });
    expect(screen.queryByRole("treeitem", { name: "demo_bool" })).not.toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "amba/i2c@XXXX0000/chip@6E" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("treeitem", { name: "amba/i2c@XXXX0000/chip@6E" }));
    expect(onSelectNode).toHaveBeenCalledWith("amba/i2c@XXXX0000/chip@6E");
  });
});
