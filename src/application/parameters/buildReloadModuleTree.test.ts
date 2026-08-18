import { describe, expect, it } from "vitest";

import type { DtsReloadCandidate } from "@/domain/dtsReload/types";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";

import { buildReloadModuleTree, collectSubtreeBindingIds } from "./buildReloadModuleTree";

function candidate(overrides: Partial<DtsReloadCandidate> = {}): DtsReloadCandidate {
  return {
    bindingId: "binding-1",
    projectId: "project-1",
    propertyKey: "watchdog_time",
    displayName: "Watchdog",
    module: "充电策略",
    moduleId: "mod-charge",
    nodePath: "/amba/i2c@1/sc8562@6E",
    compatible: "sc8562",
    baselineValue: "<6000>",
    description: null,
    valueShapeKind: "cells",
    resolvedValueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 },
    unit: "ms",
    constraints: {},
    debuggable: true,
    ...overrides
  };
}

function module(overrides: Partial<ParameterModule>): ParameterModule {
  return {
    id: "mod",
    name: "模块",
    parentId: null,
    sortOrder: 0,
    description: "",
    scope: "org",
    importance: "medium",
    kind: "business",
    origin: "curated",
    sourceKey: null,
    effectiveImportance: "medium",
    parameterCount: 0,
    definitionCount: 0,
    attributionSubjectId: null,
    ...overrides
  };
}

describe("buildReloadModuleTree", () => {
  it("builds module → device hierarchy so the navigator is expandable", () => {
    const tree = buildReloadModuleTree({
      candidates: [
        candidate(),
        candidate({
          bindingId: "binding-2",
          propertyKey: "gpio_int",
          nodePath: "/amba/i2c@1/mt5788@2B",
          compatible: "mt5788"
        })
      ]
    });

    expect(tree).toHaveLength(1);
    expect(tree[0]?.label).toBe("充电策略");
    expect(tree[0]?.children).toHaveLength(2);
    expect(tree[0]?.bindingCount).toBe(2);
    expect(collectSubtreeBindingIds(tree[0]!)).toEqual(new Set(["binding-1", "binding-2"]));
  });

  it("nests modules by registry parentId like the parameter workbench", () => {
    const tree = buildReloadModuleTree({
      candidates: [candidate({ moduleId: "mod-leaf", module: "leaf" })],
      modules: [
        module({ id: "mod-root", name: "电源", kind: "business", sortOrder: 1 }),
        module({
          id: "mod-leaf",
          name: "充电策略",
          parentId: "mod-root",
          kind: "node-type",
          sortOrder: 2
        })
      ]
    });

    expect(tree.map((node) => node.label)).toEqual(["充电策略"]);
    // Singleton business root is promoted; leaf remains expandable via device child.
    expect(tree[0]?.children.length).toBeGreaterThan(0);
    expect(tree[0]?.children.some((child) => child.label.includes("sc8562"))).toBe(true);
  });
});
