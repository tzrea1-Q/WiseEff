import { describe, expect, it } from "vitest";

import type {
  EffectiveTopologyNode,
  IdentityMappingTask,
  ProjectParameterBinding,
  SourceTopologyNode
} from "@/domain/parameter-topology/types";
import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";
import { driverFallbackModuleId, type ParameterModuleRegistry } from "@/domain/parameter-topology/moduleRegistry";

import { buildDtsWorkbenchRows } from "./buildDtsWorkbenchRows";

const sourceNodes: SourceTopologyNode[] = [
  {
    id: "occ-root",
    fileVersionId: "file-base",
    fileName: "board.dts",
    parentOccurrenceId: null,
    name: "/",
    labels: [],
    isOverlayRoot: false,
    nodePath: "/not-used/root",
    startLine: 1,
    startColumn: 1,
    endLine: 100,
    endColumn: 1,
    contentHash: "hash-root",
    sourceOrder: 0,
    properties: []
  },
  {
    id: "occ-amba",
    fileVersionId: "file-base",
    fileName: "board.dts",
    parentOccurrenceId: "occ-root",
    name: "amba",
    labels: [],
    isOverlayRoot: false,
    nodePath: "/not-used/amba",
    startLine: 1,
    startColumn: 1,
    endLine: 80,
    endColumn: 1,
    contentHash: "hash-amba",
    sourceOrder: 1,
    properties: []
  },
  {
    id: "occ-i2c",
    fileVersionId: "file-base",
    fileName: "board.dts",
    parentOccurrenceId: "occ-amba",
    name: "i2c",
    unitAddress: "FDF5E000",
    labels: [],
    isOverlayRoot: false,
    nodePath: "/not-used/i2c",
    startLine: 10,
    startColumn: 1,
    endLine: 70,
    endColumn: 1,
    contentHash: "hash-i2c",
    sourceOrder: 2,
    properties: []
  },
  {
    id: "occ-sc8562-old",
    fileVersionId: "file-base",
    fileName: "board.dts",
    parentOccurrenceId: "occ-i2c",
    name: "sc8562",
    unitAddress: "6E",
    labels: [],
    isOverlayRoot: false,
    nodePath: "/not-used/sc8562-old",
    startLine: 20,
    startColumn: 1,
    endLine: 30,
    endColumn: 1,
    contentHash: "hash-sc8562-old",
    sourceOrder: 3,
    properties: [
      {
        id: "prop-gpio-old",
        propertyName: "gpio_int",
        startLine: 24,
        startColumn: 3,
        endLine: 24,
        endColumn: 28,
        contentHash: "hash-gpio-old",
        sourceOrder: 1
      }
    ]
  },
  {
    id: "occ-sc8562",
    fileVersionId: "file-overlay",
    fileName: "power.dtso",
    parentOccurrenceId: "occ-i2c",
    name: "sc8562",
    unitAddress: "6E",
    labels: [],
    isOverlayRoot: false,
    nodePath: "/not-used/sc8562-latest",
    startLine: 42,
    startColumn: 1,
    endLine: 55,
    endColumn: 1,
    contentHash: "hash-sc8562",
    sourceOrder: 4,
    properties: [
      {
        id: "prop-gpio-latest",
        propertyName: "gpio_int",
        startLine: 48,
        startColumn: 3,
        endLine: 48,
        endColumn: 30,
        contentHash: "hash-gpio-latest",
        sourceOrder: 2
      }
    ]
  }
];

const effects: EffectiveTopologyNode["effects"] = [
  {
    id: "effect-gpio-old",
    propertyName: "gpio_int",
    effectKind: "set",
    nodeOccurrenceId: "occ-sc8562-old",
    propertyOccurrenceId: "prop-gpio-old",
    sourceOrder: 10
  },
  {
    id: "effect-gpio-latest",
    propertyName: "gpio_int",
    effectKind: "override",
    nodeOccurrenceId: "occ-sc8562",
    propertyOccurrenceId: "prop-gpio-latest",
    sourceOrder: 20
  }
];

const effectiveNodes: EffectiveTopologyNode[] = [
  {
    id: "effective-root",
    logicalNodeId: "logical-root",
    locator: "/not-used/root",
    name: "/",
    parentLogicalNodeId: null,
    effects: []
  },
  {
    id: "effective-amba",
    logicalNodeId: "logical-amba",
    locator: "/not-used/amba",
    name: "amba",
    parentLogicalNodeId: "logical-root",
    effects: []
  },
  {
    id: "effective-i2c",
    logicalNodeId: "logical-i2c",
    locator: "/not-used/i2c",
    name: "i2c",
    unitAddress: "FDF5E000",
    parentLogicalNodeId: "logical-amba",
    effects: []
  },
  {
    id: "effective-sc8562",
    logicalNodeId: "logical-sc8562",
    locator: "/not-used/sc8562",
    name: "sc8562",
    unitAddress: "6E",
    compatible: "vendor,sc8562-v2",
    parentLogicalNodeId: "logical-i2c",
    effects: [effects[1], effects[0]]
  }
];

const binding: ProjectParameterBinding = {
  id: "binding-sc8562-gpio-int",
  parameterSpecId: "spec-sc8562-gpio-int",
  parameterSpecVersionId: "spec-version-sc8562-gpio-int",
  propertyKey: "gpio_int",
  driverModule: "sc8562",
  logicalNodeId: "logical-sc8562",
  instanceName: "sc8562@6E",
  locator: "/not-used/binding-locator",
  rawValue: "<&gpio13 29 0>",
  effectiveValue: {
    kind: "cells",
    bits: 32,
    groups: [
      [
        { kind: "phandle", label: "gpio13" },
        { kind: "integer", raw: "29", value: "29" },
        { kind: "integer", raw: "0", value: "0" }
      ]
    ]
  },
  schemaState: "valid",
  policyState: "pass",
  moduleId: driverFallbackModuleId("sc8562")
};

const mappingTasks: IdentityMappingTask[] = [
  {
    id: "mapping-sc8562",
    projectId: "project-aurora",
    configRevisionId: "revision-1",
    previousLogicalNodeId: null,
    candidateLogicalNodeIds: ["logical-sc8562"],
    status: "open",
    createdAt: "2026-07-19T00:00:00.000Z"
  }
];

describe("buildDtsWorkbenchRows", () => {
  it("maps gpio_int into a semantic row using topology parent links and the latest source effect", () => {
    const [row] = buildDtsWorkbenchRows({
      projectId: "project-aurora",
      configRevisionId: "revision-1",
      view: "effective",
      bindings: [binding],
      sourceNodes,
      effectiveNodes,
      mappingTasks
    });

    const semanticRow: DtsParameterWorkbenchRow = row;
    expect(semanticRow).toMatchObject({
      bindingId: "binding-sc8562-gpio-int",
      parameterSpecId: "spec-sc8562-gpio-int",
      parameterSpecVersionId: "spec-version-sc8562-gpio-int",
      logicalNodeId: "logical-sc8562",
      propertyKey: "gpio_int",
      driverModule: "sc8562",
      compatible: "vendor,sc8562-v2",
      instanceName: "sc8562@6E",
      unitAddress: "6E",
      topologyPath: "/amba/i2c@FDF5E000/sc8562@6E",
      topologyNodeId: "effective-sc8562",
      sourceOccurrenceId: "occ-sc8562",
      sourceFileName: "power.dtso",
      sourceNodePath: "/amba/i2c@FDF5E000/sc8562@6E",
      sourceLine: 48,
      rawValue: "<&gpio13 29 0>",
      effectiveValue: binding.effectiveValue,
      valueShapeSummary: "phandle-list · 32 bit · 3 cells",
      schemaState: "valid",
      policyState: "pass",
      mappingOpen: true,
      governanceState: "attention",
      effects,
      view: "effective"
    });
    expect(row.searchText).toContain("gpio_int");
    expect(row.searchText).toContain("sc8562@6e");
    expect(row.searchText).toContain("i2c@fdf5e000");
    expect(row.searchText).toContain("gpio13");
    expect(row.searchText).toContain("power.dtso");
    expect(row.searchText).toContain("vendor,sc8562-v2");
    expect(effectiveNodes[3].effects.map((effect) => effect.id)).toEqual([
      "effect-gpio-latest",
      "effect-gpio-old"
    ]);

    const [sourceRow] = buildDtsWorkbenchRows({
      projectId: "project-aurora",
      configRevisionId: "revision-1",
      view: "source",
      bindings: [binding],
      sourceNodes,
      effectiveNodes,
      mappingTasks
    });
    expect(sourceRow.topologyNodeId).toBe("occ-sc8562");
    expect(sourceRow.topologyPath).toBe("/amba/i2c@FDF5E000/sc8562@6E");
  });

  it("uses the persisted binding.moduleId with registry lookup for name/importance/sortOrder (phase 2 browse source of truth)", () => {
    const registry: ParameterModuleRegistry = {
      modules: [
        { id: "mod-charging", name: "充电策略", parentId: null, sortOrder: 3, importance: "high" },
        { id: "mod-safety", name: "电池安全", parentId: null, sortOrder: 1, importance: "medium" }
      ],
      mappings: [
        // Would resolve to mod-safety via priority-derived lookup — the persisted
        // binding.moduleId (mod-charging) must win; no read-time override.
        { id: "map-instance", moduleId: "mod-safety", matchKind: "instance", matchValue: "sc8562@6E", priority: 0 }
      ]
    };

    const [row] = buildDtsWorkbenchRows({
      projectId: "project-aurora",
      configRevisionId: "revision-1",
      view: "effective",
      bindings: [{ ...binding, moduleId: "mod-charging" }],
      sourceNodes,
      effectiveNodes,
      mappingTasks: [],
      moduleRegistry: registry
    });

    expect(row.moduleId).toBe("mod-charging");
    expect(row.moduleName).toBe("充电策略");
    expect(row.modulePath).toEqual(["充电策略"]);
    expect(row.importance).toBe("high");
    expect(row.moduleSortOrder).toBe(3);
    // No mapping targets mod-charging for this driver/compatible/instance combination.
    expect(row.moduleMapped).toBe(false);
  });

  it("resolves root→leaf modulePath from registry parentId for nested business modules", () => {
    const registry: ParameterModuleRegistry = {
      modules: [
        { id: "mod-power", name: "电源", parentId: null, sortOrder: 0, importance: "medium" },
        { id: "mod-battery", name: "电池", parentId: "mod-power", sortOrder: 1, importance: "medium" },
        { id: "mod-batt", name: "batt", parentId: "mod-battery", sortOrder: 2, importance: "medium" }
      ],
      mappings: []
    };

    const [row] = buildDtsWorkbenchRows({
      projectId: "project-aurora",
      configRevisionId: "revision-1",
      view: "effective",
      bindings: [{ ...binding, moduleId: "mod-batt" }],
      sourceNodes,
      effectiveNodes,
      mappingTasks: [],
      moduleRegistry: registry
    });

    expect(row.moduleId).toBe("mod-batt");
    expect(row.moduleName).toBe("batt");
    expect(row.modulePath).toEqual(["电源", "电池", "batt"]);
    expect(row.searchText).toContain("电源");
    expect(row.searchText).toContain("电池");
  });

  it("falls back modulePath to [moduleName] when the registry has no parent chain", () => {
    const [row] = buildDtsWorkbenchRows({
      projectId: "project-aurora",
      configRevisionId: "revision-1",
      view: "effective",
      bindings: [binding],
      sourceNodes,
      effectiveNodes,
      mappingTasks: []
    });

    expect(row.modulePath).toEqual([row.moduleName]);
  });

  it("returns unavailable paths when a topology parent is missing or cyclic", () => {
    const missingSourceNodes = sourceNodes.map((node) =>
      node.id === "occ-i2c" ? { ...node, parentOccurrenceId: "occ-missing" } : node
    );
    const missingEffectiveNodes = effectiveNodes.map((node) =>
      node.id === "effective-i2c" ? { ...node, parentLogicalNodeId: "logical-missing" } : node
    );
    const [missingEffectiveRow] = buildDtsWorkbenchRows({
      projectId: "project-aurora",
      configRevisionId: "revision-1",
      view: "effective",
      bindings: [binding],
      sourceNodes: missingSourceNodes,
      effectiveNodes: missingEffectiveNodes,
      mappingTasks: []
    });
    const [missingSourceRow] = buildDtsWorkbenchRows({
      projectId: "project-aurora",
      configRevisionId: "revision-1",
      view: "source",
      bindings: [binding],
      sourceNodes: missingSourceNodes,
      effectiveNodes: missingEffectiveNodes,
      mappingTasks: []
    });

    expect(missingEffectiveRow.topologyPath).toBeNull();
    expect(missingSourceRow.topologyPath).toBeNull();
    expect(missingSourceRow.sourceNodePath).toBeNull();

    const cyclicSourceNodes = sourceNodes.map((node) =>
      node.id === "occ-root" ? { ...node, parentOccurrenceId: "occ-i2c" } : node
    );
    const cyclicEffectiveNodes = effectiveNodes.map((node) =>
      node.id === "effective-root" ? { ...node, parentLogicalNodeId: "logical-i2c" } : node
    );
    const [cyclicRow] = buildDtsWorkbenchRows({
      projectId: "project-aurora",
      configRevisionId: "revision-1",
      view: "effective",
      bindings: [binding],
      sourceNodes: cyclicSourceNodes,
      effectiveNodes: cyclicEffectiveNodes,
      mappingTasks: []
    });
    const [cyclicSourceRow] = buildDtsWorkbenchRows({
      projectId: "project-aurora",
      configRevisionId: "revision-1",
      view: "source",
      bindings: [binding],
      sourceNodes: cyclicSourceNodes,
      effectiveNodes,
      mappingTasks: []
    });

    expect(cyclicRow.topologyPath).toBeNull();
    expect(cyclicSourceRow.topologyPath).toBeNull();
  });

  it("ignores open mapping tasks from another project or config revision", () => {
    const scopedElsewhere: IdentityMappingTask[] = [
      { ...mappingTasks[0], id: "foreign-project", projectId: "project-nebula" },
      { ...mappingTasks[0], id: "old-revision", configRevisionId: "revision-old" }
    ];

    const [row] = buildDtsWorkbenchRows({
      projectId: "project-aurora",
      configRevisionId: "revision-1",
      view: "effective",
      bindings: [binding],
      sourceNodes,
      effectiveNodes,
      mappingTasks: scopedElsewhere
    });

    expect(row.mappingOpen).toBe(false);
    expect(row.governanceState).toBe("valid");
  });

  it("provides stable readable summaries for empty, mixed, and multi-group values", () => {
    const variants: ProjectParameterBinding[] = [
      {
        ...binding,
        id: "binding-empty",
        propertyKey: "empty_property",
        effectiveValue: { kind: "empty" },
        rawValue: ""
      },
      {
        ...binding,
        id: "binding-mixed",
        propertyKey: "mixed_property",
        effectiveValue: {
          kind: "mixed",
          segments: [
            { kind: "string", raw: "mode", value: "mode" },
            {
              kind: "cells",
              bits: 32,
              cells: [{ kind: "integer", raw: "1", value: "1" }]
            }
          ]
        },
        rawValue: '"mode", <1>'
      },
      {
        ...binding,
        id: "binding-multi-group",
        propertyKey: "multi_group_property",
        effectiveValue: {
          kind: "cells",
          bits: 16,
          groups: [
            [
              { kind: "integer", raw: "1", value: "1" },
              { kind: "integer", raw: "2", value: "2" }
            ],
            [
              { kind: "integer", raw: "3", value: "3" },
              { kind: "integer", raw: "4", value: "4" }
            ]
          ]
        },
        rawValue: "/bits/ 16 <1 2>, <3 4>"
      },
      {
        ...binding,
        id: "binding-empty-cell-groups",
        propertyKey: "empty_cell_groups_property",
        effectiveValue: { kind: "cells", bits: 32, groups: [] },
        rawValue: "<>"
      }
    ];

    const rows = buildDtsWorkbenchRows({
      projectId: "project-aurora",
      configRevisionId: "revision-1",
      view: "effective",
      bindings: variants,
      sourceNodes,
      effectiveNodes,
      mappingTasks: []
    });

    expect(rows.map((row) => row.valueShapeSummary)).toEqual([
      "empty property",
      "mixed · 2 segments",
      "cell-array · 16 bit · 2 groups · 2 cells per group",
      "cell-array · 32 bit · 0 groups · 0 cells per group"
    ]);
    expect(rows.every((row) => row.valueShapeSummary.length > 0)).toBe(true);
  });

  it("filters structural scaffolding properties from the default workbench surface", () => {
    const rows = buildDtsWorkbenchRows({
      projectId: "project-aurora",
      configRevisionId: "revision-1",
      view: "effective",
      bindings: [
        binding,
        {
          ...binding,
          id: "binding-address-cells",
          propertyKey: "#address-cells",
          logicalNodeId: "logical-i2c"
        }
      ],
      sourceNodes,
      effectiveNodes,
      mappingTasks: []
    });

    expect(rows.map((row) => row.propertyKey)).toEqual(["gpio_int"]);
  });

  it("can include non-surface rows when includeNonSurface is true", () => {
    const rows = buildDtsWorkbenchRows({
      projectId: "project-aurora",
      configRevisionId: "revision-1",
      view: "effective",
      bindings: [
        binding,
        {
          ...binding,
          id: "binding-address-cells",
          propertyKey: "#address-cells",
          logicalNodeId: "logical-i2c"
        }
      ],
      sourceNodes,
      effectiveNodes,
      mappingTasks: [],
      includeNonSurface: true
    });

    expect(rows.map((row) => row.propertyKey)).toEqual(["gpio_int", "#address-cells"]);
  });
});
