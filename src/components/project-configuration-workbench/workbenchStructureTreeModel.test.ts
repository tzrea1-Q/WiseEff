import { describe, expect, it } from "vitest";

import type { DtsStructuralNode } from "@/application/ports/DtsStructuredRepository";
import {
  buildWorkbenchStructureTree,
  workbenchExpansionPath,
  workbenchIdsToExpandUpToDepth,
  workbenchStructureTreeIndex
} from "./workbenchStructureTreeModel";

function node(nodePath: string): DtsStructuralNode {
  return {
    nodePath,
    name: nodePath.split("/").at(-1) ?? nodePath,
    labels: [],
    properties: [],
    phandleRefs: [],
    source: {
      startOffset: 0,
      endOffset: 1,
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 2
    }
  };
}

describe("workbenchStructureTreeModel", () => {
  it("builds a nested tree from flat node paths", () => {
    const roots = buildWorkbenchStructureTree([
      node("amba"),
      node("amba/i2c@1"),
      node("amba/i2c@1/device@2"),
      node("board")
    ]);
    expect(roots.map((item) => item.id)).toEqual(["amba", "board"]);
    expect(roots[0]?.children.map((item) => item.id)).toEqual(["amba/i2c@1"]);
    expect(roots[0]?.children[0]?.children.map((item) => item.id)).toEqual(["amba/i2c@1/device@2"]);
    expect(roots[0]?.children[0]?.label).toBe("i2c@1");
  });

  it("attaches orphan deep paths to the nearest existing ancestor", () => {
    const roots = buildWorkbenchStructureTree([node("amba"), node("amba/bus/child")]);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.children.map((item) => item.id)).toEqual(["amba/bus/child"]);
    expect(roots[0]?.children[0]?.parentId).toBe("amba");
  });

  it("expands to a default depth and selection ancestry", () => {
    const roots = buildWorkbenchStructureTree([
      node("a"),
      node("a/b"),
      node("a/b/c"),
      node("a/b/c/d")
    ]);
    const { byId } = workbenchStructureTreeIndex(roots);
    expect([...workbenchIdsToExpandUpToDepth(roots, 2)].sort()).toEqual(["a"]);
    expect(workbenchExpansionPath(byId, "a/b/c/d").sort()).toEqual(["a", "a/b", "a/b/c"]);
  });

  it("promotes children when the only root is an empty path", () => {
    const roots = buildWorkbenchStructureTree([node(""), node("amba"), node("amba/i2c")]);
    expect(roots.map((item) => item.id)).toEqual(["amba"]);
    expect(roots[0]?.children.map((item) => item.id)).toEqual(["amba/i2c"]);
  });
});
