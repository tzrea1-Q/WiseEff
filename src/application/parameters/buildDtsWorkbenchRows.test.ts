import { describe, expect, it } from "vitest";

import type {
  EffectiveTopologyNode,
  IdentityMappingTask,
  ProjectParameterBinding,
  SourceTopologyNode
} from "@/domain/parameter-topology/types";

import { buildDtsWorkbenchRows } from "./buildDtsWorkbenchRows";

const sourceNodes: SourceTopologyNode[] = [
  {
    id: "occ-amba",
    fileVersionId: "file-base",
    fileName: "board.dts",
    parentOccurrenceId: null,
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
    id: "effective-amba",
    logicalNodeId: "logical-amba",
    locator: "/not-used/amba",
    name: "amba",
    parentLogicalNodeId: null,
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
    compatible: "sc8562",
    parentLogicalNodeId: "logical-i2c",
    effects
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
  policyState: "pass"
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
      view: "effective",
      bindings: [binding],
      sourceNodes,
      effectiveNodes,
      mappingTasks
    });

    expect(row).toMatchObject({
      bindingId: "binding-sc8562-gpio-int",
      parameterSpecId: "spec-sc8562-gpio-int",
      parameterSpecVersionId: "spec-version-sc8562-gpio-int",
      logicalNodeId: "logical-sc8562",
      propertyKey: "gpio_int",
      driverModule: "sc8562",
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
      valueShapeSummary: "phandle-list · bits=32 · groups=1 · cellsPerGroup=3",
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

    const [sourceRow] = buildDtsWorkbenchRows({
      view: "source",
      bindings: [binding],
      sourceNodes,
      effectiveNodes,
      mappingTasks
    });
    expect(sourceRow.topologyNodeId).toBe("occ-sc8562");
    expect(sourceRow.topologyPath).toBe("/amba/i2c@FDF5E000/sc8562@6E");
  });
});
