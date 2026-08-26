import { describe, expect, it } from "vitest";

import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import { buildParameterModuleFilterNodes, buildPathModuleFilterNodes } from "./buildModuleFilterNodes";

function moduleNode(id: string, name: string, parentId: string | null, sortOrder: number): ParameterModule {
  return {
    id,
    name,
    parentId,
    sortOrder,
    description: "",
    scope: "",
    importance: "medium",
    kind: "business",
    origin: "curated",
    sourceKey: null,
    effectiveImportance: "medium",
    parameterCount: 0,
    definitionCount: 0
  };
}

describe("buildParameterModuleFilterNodes", () => {
  it("includes connected registry ancestors and counts only rows in scope", () => {
    const nodes = buildParameterModuleFilterNodes(
      [
        { moduleId: "node-type", moduleName: "节点类型" },
        { moduleId: "node-type", moduleName: "节点类型" }
      ],
      [
        moduleNode("business", "业务", null, 1),
        moduleNode("driver", "驱动组", "business", 2),
        moduleNode("node-type", "节点类型", "driver", 3),
        moduleNode("unused", "未使用", null, 2)
      ]
    );

    expect(nodes.map((node) => [node.id, node.parentId, node.count])).toEqual([
      ["business", null, 2],
      ["driver", "business", 2],
      ["node-type", "driver", 2]
    ]);
  });

  it("keeps a stable synthetic root when a row has no registry entry", () => {
    expect(
      buildParameterModuleFilterNodes([{ moduleId: "legacy:charger", moduleName: "未分类 · charger" }])
    ).toEqual([
      expect.objectContaining({
        id: "legacy:charger",
        label: "未分类 · charger",
        parentId: null,
        count: 1
      })
    ]);
  });

  it("builds hierarchy and subtree counts directly from root-to-leaf paths", () => {
    const nodes = buildPathModuleFilterNodes([
      { moduleName: "direct_charge_current", modulePath: ["Power", "Charging", "Direct Charging", "direct_charge_current"] },
      { moduleName: "direct_charge_limit", modulePath: ["Power", "Charging", "Direct Charging", "direct_charge_limit"] }
    ]);

    expect(nodes.map((node) => [node.label, node.parentId, node.count])).toEqual([
      ["Power", null, 2],
      ["Charging", "path:Power", 2],
      ["Direct Charging", "path:Power/Charging", 2],
      ["direct_charge_current", "path:Power/Charging/Direct%20Charging", 1],
      ["direct_charge_limit", "path:Power/Charging/Direct%20Charging", 1]
    ]);
  });
});
