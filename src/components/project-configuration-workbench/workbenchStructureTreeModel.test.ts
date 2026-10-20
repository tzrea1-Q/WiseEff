import { describe, expect, it } from "vitest";

import type { DtsStructuralNode } from "@/application/ports/DtsStructuredRepository";
import {
  buildWorkbenchStructureTree,
  selectWorkbenchNavigationNodes,
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
  it("does not expose unregistered children when an empty-path root and I2C parents are managed", () => {
    const managed = ["", "charging_core", "amba/i2c@FDF5D000", "amba/i2c@FDF5E000",
      "amba/i2c@FF24B000", "amba/i2c@FF24C000", "amba/i2c@FF24D000", "amba/i2c@FF24E000",
      "amba/i2c@FF24F000", "amba/i2c@FF251000", "amba/i2c@FF252000", "battery_cccv/cccv_para0",
      "huawei_batt_info/battery_checker@0", "spmi1/scharger_v800", "amba/i2c@FF24C000/hl7603@77",
      "amba/i2c@FF252000/hl7603@77", "amba/i2c@FF252000/mt5788@2B", "spmi/pmic@0/hi6xxx_coul/batt"];
    const ancestors = ["amba", "battery_cccv", "huawei_batt_info", "spmi1", "spmi", "spmi/pmic@0", "spmi/pmic@0/hi6xxx_coul"];
    const unrelated = ["unregistered", "amba/i2c@FF252000/unregistered@1",
      ...Array.from({ length: 5000 }, (_, index) => `amba/unregistered@${index}`)];
    const nodes = [...managed, ...ancestors, ...unrelated].map(node);
    const visible = selectWorkbenchNavigationNodes(nodes, managed);
    expect(visible.map((item) => item.nodePath).sort()).toEqual([...managed, ...ancestors].sort());
    const { byId } = workbenchStructureTreeIndex(buildWorkbenchStructureTree(visible));
    expect(managed).toHaveLength(18);
    expect(byId.size).toBe(24);
    expect(byId.has("")).toBe(false);
    expect(unrelated.some((path) => byId.has(path))).toBe(false);
  });

  it("keeps only registered instances and actual ancestors from a large DTS without changing full nodes", () => {
    const paths = ["", "soc", "soc/bus@1", "soc/bus@1/charger@0", "soc/bus@1/charger@1", "soc/power", "soc/power/battery0",
      "soc/bus@10", "soc/bus@1/charger@0/unrelated-child",
      ...Array.from({ length: 5000 }, (_, index) => `soc/unrelated@${index}`)];
    const nodes = paths.map((path) => ({ ...node(path), properties: [{
      name: "status", valueType: "string-list" as const, rawText: '"disabled"', normalizedValue: "disabled"
    }], status: "disabled" }));
    const managed = ["soc/bus@1/charger@0", "soc/bus@1/charger@1", "soc/power/battery0"];
    const visible = selectWorkbenchNavigationNodes(nodes, managed);
    expect(nodes).toHaveLength(5009);
    expect(visible.map((item) => item.nodePath)).toEqual([
      "soc", "soc/bus@1", ...managed.slice(0, 2), "soc/power", managed[2]
    ]);
    expect(visible.filter((item) => item.properties.length).map((item) => item.nodePath)).toEqual(managed);
    expect(nodes.every((item) => item.properties.length === 1)).toBe(true);
    expect(visible.find((item) => item.nodePath === managed[0])).toBe(nodes[3]);
    expect(selectWorkbenchNavigationNodes(nodes, [])).toEqual([]);
    expect(selectWorkbenchNavigationNodes(nodes, ["missing/child"])).toEqual([]);
    expect(workbenchExpansionPath(workbenchStructureTreeIndex(buildWorkbenchStructureTree(visible)).byId,
      "soc/unrelated@0")).toEqual([]);
  });

  it("handles absolute path segments and keeps a directly matched synthetic root from exposing unrelated nodes", () => {
    const nodes = ["/", "/soc", "/soc/bus@1", "/soc/bus@10", "/soc/bus@1/device"].map(node);
    expect(selectWorkbenchNavigationNodes(nodes, ["/soc/bus@1/device"]).map((item) => item.nodePath))
      .toEqual(["/soc", "/soc/bus@1", "/soc/bus@1/device"]);
    expect(buildWorkbenchStructureTree(selectWorkbenchNavigationNodes(nodes, ["/"]))).toEqual([]);
  });

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
