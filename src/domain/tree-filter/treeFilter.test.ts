import { describe, expect, it } from "vitest";

import {
  buildTreeFilterTree,
  canonicalizeTreeFilterSelection,
  collectTreeFilterSelectedDescendantIds,
  filterTreeFilterTree,
  getTreeFilterSelectionState,
  hideSingleTreeFilterRoot,
  toggleTreeFilterSelection,
  type TreeFilterNode
} from "./treeFilter";

const nodes: TreeFilterNode[] = [
  { id: "power", label: "电源", parentId: null, path: "电源", sortOrder: 1 },
  { id: "battery", label: "电池", parentId: "power", path: "电源 / 电池", sortOrder: 1 },
  { id: "health", label: "健康", parentId: "battery", path: "电源 / 电池 / 健康", sortOrder: 1 },
  { id: "charging", label: "充电", parentId: "power", path: "电源 / 充电", sortOrder: 2 },
  { id: "orphan", label: "孤立", parentId: "missing", path: "孤立" }
];

describe("tree filter model", () => {
  it("builds a stable hierarchy and promotes orphan nodes to roots", () => {
    const tree = buildTreeFilterTree(nodes);
    expect(tree.map((node) => node.id)).toEqual(["power", "orphan"]);
    expect(tree[0]?.children.map((node) => node.id)).toEqual(["battery", "charging"]);
    expect(tree[0]?.children[0]?.children.map((node) => node.id)).toEqual(["health"]);
  });

  it("promotes cyclic nodes to guarded roots instead of recursing forever", () => {
    const tree = buildTreeFilterTree([
      { id: "cycle-a", label: "循环 A", parentId: "cycle-b" },
      { id: "cycle-b", label: "循环 B", parentId: "cycle-a" },
      { id: "child", label: "子节点", parentId: "cycle-a" }
    ]);

    expect(new Set(tree.map((node) => node.id))).toEqual(new Set(["child", "cycle-a", "cycle-b"]));
    expect(tree.every((node) => node.children.length === 0)).toBe(true);
  });

  it("retains matching ancestors and supports path search", () => {
    const tree = filterTreeFilterTree(buildTreeFilterTree(nodes), "电池");
    expect(tree.map((node) => node.id)).toEqual(["power"]);
    expect(tree[0]?.children.map((node) => node.id)).toEqual(["battery"]);
    expect(tree[0]?.children[0]?.children.map((node) => node.id)).toEqual(["health"]);
  });

  it("hides one structural root without changing child selection identity", () => {
    const tree = buildTreeFilterTree(nodes);
    const visibleTree = hideSingleTreeFilterRoot(tree);

    expect(visibleTree.map((node) => node.id)).toEqual(["power", "orphan"]);

    const singleRootTree = buildTreeFilterTree(nodes.filter((node) => node.id !== "orphan"));
    const flattenedRoot = hideSingleTreeFilterRoot(singleRootTree);
    expect(flattenedRoot.map((node) => node.id)).toEqual(["battery", "charging"]);
    expect(flattenedRoot[0]?.parentId).toBeNull();
    expect(flattenedRoot[0]?.children.map((node) => node.id)).toEqual(["health"]);
  });

  it("canonicalizes selected values to logical roots", () => {
    expect(canonicalizeTreeFilterSelection(nodes, ["health", "battery", "charging"])).toEqual([
      "battery",
      "charging"
    ]);
    expect(collectTreeFilterSelectedDescendantIds(nodes, ["battery"])).toEqual(
      new Set(["battery", "health"])
    );
  });

  it("supports parent/child toggles with checked and mixed states", () => {
    const selected = toggleTreeFilterSelection(nodes, [], "battery");
    expect(selected).toEqual(["battery"]);
    expect(getTreeFilterSelectionState(nodes, buildTreeFilterTree(nodes)[0]!, selected)).toBe("mixed");
    expect(getTreeFilterSelectionState(nodes, buildTreeFilterTree(nodes)[0]!.children[0]!, selected)).toBe("checked");

    const unselectedChild = toggleTreeFilterSelection(nodes, selected, "health");
    expect(unselectedChild).toEqual([]);
    const parentSelected = toggleTreeFilterSelection(nodes, [], "power");
    const unselectedBranch = toggleTreeFilterSelection(nodes, parentSelected, "battery");
    expect(unselectedBranch).toEqual(["charging"]);
    expect(getTreeFilterSelectionState(nodes, buildTreeFilterTree(nodes)[0]!, unselectedBranch)).toBe("mixed");
  });
});
