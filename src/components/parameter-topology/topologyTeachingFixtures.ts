/**
 * Teaching fixtures for Storybook / unit tests only.
 * Never import these as production/API-mode runtime defaults.
 */
import type {
  EffectiveTopologyNode,
  ProjectParameterBinding,
  SourceTopologyNode
} from "@/domain/parameter-topology/types";
import { driverFallbackModuleId } from "@/domain/parameter-topology/moduleRegistry";

export const TOPOLOGY_TEACHING_SOURCE_NODES: SourceTopologyNode[] = [
  {
    id: "src-amba",
    fileVersionId: "fv-base",
    fileName: "board.dts",
    parentOccurrenceId: null,
    name: "amba",
    labels: ["amba"],
    isOverlayRoot: false,
    nodePath: "/amba",
    startLine: 10,
    startColumn: 1,
    endLine: 200,
    endColumn: 1,
    contentHash: "hash-amba",
    sourceOrder: 1,
    properties: []
  },
  {
    id: "src-amba-overlay",
    fileVersionId: "fv-overlay",
    fileName: "power.dtso",
    parentOccurrenceId: null,
    name: "amba",
    labels: [],
    refTarget: "amba",
    isOverlayRoot: true,
    nodePath: "/&amba",
    startLine: 4,
    startColumn: 1,
    endLine: 80,
    endColumn: 1,
    contentHash: "hash-amba-overlay",
    sourceOrder: 2,
    properties: []
  },
  {
    id: "src-i2c",
    fileVersionId: "fv-base",
    fileName: "board.dts",
    parentOccurrenceId: "src-amba",
    name: "i2c",
    unitAddress: "FDF5E000",
    labels: [],
    isOverlayRoot: false,
    nodePath: "/amba/i2c@FDF5E000",
    startLine: 42,
    startColumn: 1,
    endLine: 120,
    endColumn: 1,
    contentHash: "hash-i2c",
    sourceOrder: 3,
    properties: []
  },
  {
    id: "src-sc8562",
    fileVersionId: "fv-overlay",
    fileName: "power.dtso",
    parentOccurrenceId: "src-i2c",
    name: "sc8562",
    unitAddress: "6E",
    labels: ["sc8562"],
    isOverlayRoot: false,
    nodePath: "/amba/i2c@FDF5E000/sc8562@6E",
    startLine: 42,
    startColumn: 1,
    endLine: 60,
    endColumn: 1,
    contentHash: "hash-sc8562",
    sourceOrder: 4,
    properties: [
      {
        id: "src-prop-gpio-int",
        propertyName: "gpio_int",
        startLine: 48,
        startColumn: 1,
        endLine: 48,
        endColumn: 30,
        contentHash: "hash-gpio-int",
        sourceOrder: 1
      }
    ]
  },
  {
    id: "src-unresolved",
    fileVersionId: "fv-overlay",
    fileName: "power.dtso",
    parentOccurrenceId: null,
    name: "missing",
    labels: [],
    refTarget: "ghost_label",
    isOverlayRoot: true,
    nodePath: "/&ghost_label",
    startLine: 2,
    startColumn: 1,
    endLine: 3,
    endColumn: 1,
    contentHash: "hash-ghost",
    sourceOrder: 5,
    properties: []
  }
];

export const TOPOLOGY_TEACHING_EFFECTIVE_NODES: EffectiveTopologyNode[] = [
  {
    id: "eff-amba",
    logicalNodeId: "logical-amba",
    locator: "/amba",
    name: "amba",
    parentLogicalNodeId: null,
    effects: []
  },
  {
    id: "eff-i2c",
    logicalNodeId: "logical-i2c",
    locator: "/amba/i2c@FDF5E000",
    name: "i2c",
    unitAddress: "FDF5E000",
    parentLogicalNodeId: "logical-amba",
    effects: []
  },
  {
    id: "eff-sc8562",
    logicalNodeId: "logical-sc8562",
    locator: "/amba/i2c@FDF5E000/sc8562@6E",
    name: "sc8562",
    unitAddress: "6E",
    compatible: "vendor,sc8562",
    parentLogicalNodeId: "logical-i2c",
    effects: [
      {
        id: "eff-gpio-int",
        propertyName: "gpio_int",
        effectKind: "set",
        nodeOccurrenceId: "src-sc8562",
        propertyOccurrenceId: "src-prop-gpio-int",
        sourceOrder: 1
      }
    ]
  },
  {
    id: "eff-mt5788",
    logicalNodeId: "logical-mt5788",
    locator: "/amba/i2c@FDF5E000/mt5788@55",
    name: "mt5788",
    unitAddress: "55",
    compatible: "mediatek,mt5788",
    parentLogicalNodeId: "logical-i2c",
    effects: [
      {
        id: "eff-mt-gpio-int",
        propertyName: "gpio_int",
        effectKind: "set",
        nodeOccurrenceId: null,
        propertyOccurrenceId: null,
        sourceOrder: 1
      }
    ]
  }
];

export const TOPOLOGY_TEACHING_BINDINGS: ProjectParameterBinding[] = [
  {
    id: "binding-sc8562-gpio-int",
    parameterSpecId: "spec-sc8562-gpio-int",
    parameterSpecVersionId: "specver-sc8562-gpio-int-3",
    propertyKey: "gpio_int",
    driverModule: "sc8562",
    logicalNodeId: "logical-sc8562",
    instanceName: "sc8562@6E",
    locator: "/amba/i2c@FDF5E000/sc8562@6E",
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
    rawValue: "<&gpio13 29 0>",
    schemaState: "valid",
    policyState: "pass",
    moduleId: driverFallbackModuleId("sc8562")
  },
  {
    id: "binding-mt5788-gpio-int",
    parameterSpecId: "spec-mt5788-gpio-int",
    parameterSpecVersionId: "specver-mt5788-gpio-int-1",
    propertyKey: "gpio_int",
    driverModule: "mt5788",
    logicalNodeId: "logical-mt5788",
    instanceName: "mt5788@55",
    locator: "/amba/i2c@FDF5E000/mt5788@55",
    effectiveValue: {
      kind: "cells",
      bits: 32,
      groups: [
        [
          { kind: "phandle", label: "gpio6" },
          { kind: "integer", raw: "15", value: "15" },
          { kind: "integer", raw: "0", value: "0" }
        ]
      ]
    },
    rawValue: "<&gpio6 15 0>",
    schemaState: "valid",
    policyState: "pass",
    moduleId: driverFallbackModuleId("mt5788")
  },
  {
    id: "binding-sc8562-status",
    parameterSpecId: "spec-sc8562-status",
    parameterSpecVersionId: "specver-sc8562-status-1",
    propertyKey: "status",
    driverModule: "sc8562",
    logicalNodeId: "logical-sc8562",
    instanceName: "sc8562@6E",
    locator: "/amba/i2c@FDF5E000/sc8562@6E",
    effectiveValue: { kind: "strings", values: ["okay"] },
    rawValue: '"okay"',
    schemaState: "valid",
    policyState: "not_applicable",
    moduleId: driverFallbackModuleId("sc8562")
  }
];
