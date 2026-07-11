import { describe, expect, it } from "vitest";
import { buildModuleTree } from "@/domain/modules/moduleTree";
import { buildParameterModuleTree } from "@/parameterAdminLibrary";
import { initialState } from "@/mockData";
import type { ModuleTreeNode } from "@/domain/modules/moduleTree";
import {
  buildDefaultExpandedTreeIds,
  buildExpandedTreeIdsForDropdown,
  collectExpandedIdsForFilteredTree,
  filterTreeNodes,
  modulePathLabel
} from "./moduleManagementTreeUtils";

const tree: ModuleTreeNode[] = [
  {
    id: "root",
    name: "Power",
    parentId: null,
    path: "root",
    depth: 1,
    children: [
      {
        id: "child",
        name: "Battery",
        parentId: "root",
        path: "root/child",
        depth: 2,
        children: [
          {
            id: "grandchild",
            name: "Battery Health",
            parentId: "child",
            path: "root/child/grandchild",
            depth: 3,
            children: []
          }
        ]
      }
    ]
  }
];

const flat = [
  { id: "root", name: "Power", parentId: null, path: "root", depth: 1 },
  { id: "child", name: "Battery", parentId: "root", path: "root/child", depth: 2 },
  { id: "grandchild", name: "Battery Health", parentId: "child", path: "root/child/grandchild", depth: 3 }
];

describe("moduleManagementTreeUtils", () => {
  it("expands roots and first-level branches by default", () => {
    expect(buildDefaultExpandedTreeIds(tree)).toEqual(new Set(["root", "child"]));
  });

  it("keeps ancestor branches expanded when filtering", () => {
    const filtered = filterTreeNodes(tree, "health");
    expect(collectExpandedIdsForFilteredTree(filtered)).toEqual(new Set(["root", "child"]));
  });

  it("builds a breadcrumb path for nested modules", () => {
    expect(modulePathLabel(tree[0]!.children[0]!.children[0]!, flat, 2)).toBe("Power / Battery / Battery Health");
  });

  it("expands default branches plus ancestors for dropdown selection", () => {
    expect(buildExpandedTreeIdsForDropdown(tree, flat, "grandchild")).toEqual(new Set(["root", "child"]));
  });

  it("filters the seed module tree without unrelated battery modules", () => {
    const nodes = buildParameterModuleTree([], initialState.configDraft.parameterModules);
    const seedTree = buildModuleTree(nodes);
    const filtered = filterTreeNodes(seedTree, "charging");
    const names: string[] = [];
    const walk = (items: readonly ModuleTreeNode[]) => {
      for (const item of items) {
        names.push(item.name);
        walk(item.children);
      }
    };
    walk(filtered);

    expect(names).toContain("Charging Policy");
    expect(names).not.toContain("Battery Safety");
  });
});
