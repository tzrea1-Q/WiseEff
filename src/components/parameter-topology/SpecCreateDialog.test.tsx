import { describe, expect, it } from "vitest";

import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import { subjectsFromModules } from "./SpecCreateDialog";

describe("subjectsFromModules", () => {
  it("keeps only driver-group and node-type modules with attribution subjects", () => {
    const modules: ParameterModule[] = [
      {
        id: "m-business",
        name: "业务",
        parentId: null,
        sortOrder: 0,
        description: "",
        scope: "",
        importance: "medium",
        kind: "business",
        origin: "curated",
        sourceKey: null,
        effectiveImportance: "medium",
        parameterCount: 0,
        attributionSubjectId: null,
      },
      {
        id: "m-driver",
        name: "SC8562",
        parentId: "m-business",
        sortOrder: 1,
        description: "",
        scope: "",
        importance: "medium",
        kind: "driver-group",
        origin: "curated",
        sourceKey: "compatible:sc8562",
        effectiveImportance: "medium",
        parameterCount: 2,
        attributionSubjectId: "asub:driver:sc8562",
      },
      {
        id: "m-node",
        name: "charger",
        parentId: "m-driver",
        sortOrder: 2,
        description: "",
        scope: "",
        importance: "medium",
        kind: "node-type",
        origin: "curated",
        sourceKey: "nodetype:charger",
        effectiveImportance: "medium",
        parameterCount: 1,
        attributionSubjectId: "asub:nodetype:charger",
      },
    ];

    expect(subjectsFromModules(modules)).toEqual([
      {
        attributionSubjectId: "asub:driver:sc8562",
        label: "SC8562 (驱动登记)",
        kind: "driver-group",
        compatibleHint: "sc8562",
      },
      {
        attributionSubjectId: "asub:nodetype:charger",
        label: "charger (节点类型)",
        kind: "node-type",
        compatibleHint: null,
      },
    ]);
  });
});
