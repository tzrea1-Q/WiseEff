import { describe, expect, it } from "vitest";
import {
  buildModuleTree,
  collectSubtreeModuleIds,
  formatModulePathLabel,
  legacyModuleIdFromName,
  parameterModuleId
} from "./moduleTree";

describe("frontend moduleTree", () => {
  const flat = [
    { id: "pm-a", name: "电源", parentId: null, path: "pm-a", depth: 1 },
    { id: "pm-b", name: "电池", parentId: "pm-a", path: "pm-a/pm-b", depth: 2 }
  ];

  it("builds nested children", () => {
    const tree = buildModuleTree(flat);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].name).toBe("电池");
  });

  it("collects subtree module ids", () => {
    expect(Array.from(collectSubtreeModuleIds(flat, ["pm-a"]))).toEqual(["pm-a", "pm-b"]);
  });

  it("formats module path labels and legacy ids", () => {
    expect(formatModulePathLabel(["电源", "电池"], "电池")).toBe("电源 / 电池");
    expect(legacyModuleIdFromName("Charging")).toBe("legacy:Charging");
    expect(parameterModuleId({ module: "Charging" })).toBe("legacy:Charging");
  });
});
