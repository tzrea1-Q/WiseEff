import { describe, expect, it } from "vitest";

import type {
  EffectiveTopologyNode,
  SourceTopologyNode,
  TopologyView
} from "@/domain/parameter-topology/types";
import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";

import { buildDtsTopologyTree } from "./buildDtsTopologyTree";

const sourceNodes: SourceTopologyNode[] = [
  {
    id: "occ-root",
    fileVersionId: "file-base",
    parentOccurrenceId: null,
    name: "/",
    labels: [],
    isOverlayRoot: false,
    nodePath: "/display-only/root",
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
    parentOccurrenceId: "occ-root",
    name: "amba",
    labels: [],
    isOverlayRoot: false,
    nodePath: "/display-only/amba",
    startLine: 2,
    startColumn: 1,
    endLine: 90,
    endColumn: 1,
    contentHash: "hash-amba",
    sourceOrder: 1,
    properties: []
  },
  {
    id: "occ-i2c",
    fileVersionId: "file-base",
    parentOccurrenceId: "occ-amba",
    name: "i2c",
    unitAddress: "FDF5E000",
    labels: [],
    isOverlayRoot: false,
    nodePath: "/not-an-identity/i2c",
    startLine: 10,
    startColumn: 1,
    endLine: 60,
    endColumn: 1,
    contentHash: "hash-i2c",
    sourceOrder: 2,
    properties: []
  },
  {
    id: "occ-uart",
    fileVersionId: "file-base",
    parentOccurrenceId: "occ-amba",
    name: "uart",
    unitAddress: "FF000000",
    labels: [],
    isOverlayRoot: false,
    nodePath: "/not-an-identity/uart",
    startLine: 61,
    startColumn: 1,
    endLine: 70,
    endColumn: 1,
    contentHash: "hash-uart",
    sourceOrder: 3,
    properties: []
  },
  {
    id: "occ-sc8562",
    fileVersionId: "file-base",
    parentOccurrenceId: "occ-i2c",
    name: "sc8562",
    unitAddress: "6E",
    labels: [],
    isOverlayRoot: false,
    nodePath: "/deliberately/wrong/sc8562",
    startLine: 20,
    startColumn: 1,
    endLine: 40,
    endColumn: 1,
    contentHash: "hash-sc8562",
    sourceOrder: 4,
    properties: []
  }
];

const effectiveNodes: EffectiveTopologyNode[] = [
  {
    id: "effective-root",
    logicalNodeId: "logical-root",
    locator: "/display-only/root",
    name: "/",
    parentLogicalNodeId: null,
    effects: []
  },
  {
    id: "effective-amba",
    logicalNodeId: "logical-amba",
    locator: "/display-only/amba",
    name: "amba",
    parentLogicalNodeId: "logical-root",
    effects: []
  },
  {
    id: "effective-i2c",
    logicalNodeId: "logical-i2c",
    locator: "/not-an-identity/i2c",
    name: "i2c",
    unitAddress: "FDF5E000",
    parentLogicalNodeId: "logical-amba",
    effects: []
  },
  {
    id: "effective-uart",
    logicalNodeId: "logical-uart",
    locator: "/not-an-identity/uart",
    name: "uart",
    unitAddress: "FF000000",
    parentLogicalNodeId: "logical-amba",
    effects: []
  },
  {
    id: "effective-sc8562",
    logicalNodeId: "logical-sc8562",
    locator: "/deliberately/wrong/sc8562",
    name: "sc8562",
    unitAddress: "6E",
    compatible: "sc8562",
    parentLogicalNodeId: "logical-i2c",
    effects: []
  }
];

function row(
  bindingId: string,
  topologyNodeId: string | null,
  governanceState: DtsParameterWorkbenchRow["governanceState"],
  view: TopologyView
): DtsParameterWorkbenchRow {
  return {
    bindingId,
    parameterSpecId: `spec-${bindingId}`,
    parameterSpecVersionId: `spec-version-${bindingId}`,
    logicalNodeId: null,
    propertyKey: bindingId,
    driverModule: null,
    compatible: null,
    instanceName: null,
    moduleId: "module:unassigned",
    moduleName: "未分类",
    modulePath: ["未分类"],
    importance: "medium",
    moduleSortOrder: Number.MAX_SAFE_INTEGER,
    moduleMapped: false,
    unitAddress: null,
    topologyPath: "/display-only/duplicate",
    topologyNodeId,
    sourceOccurrenceId: null,
    sourceFileName: null,
    sourceNodePath: null,
    sourceLine: null,
    rawValue: "<1>",
    effectiveValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "1", value: "1" }]] },
    valueShapeSummary: "cell-list",
    schemaState: "valid",
    policyState: "pass",
    mappingOpen: governanceState !== "valid",
    governanceState,
    effects: [],
    searchText: bindingId,
    view
  };
}

function findNode(
  nodes: ReturnType<typeof buildDtsTopologyTree>,
  id: string
): ReturnType<typeof buildDtsTopologyTree>[number] {
  const pending = [...nodes];
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (current.id === id) return current;
    pending.unshift(...current.children);
  }
  throw new Error(`Missing test node ${id}`);
}

describe("buildDtsTopologyTree", () => {
  it.each([
    {
      view: "source" as const,
      topologyIds: {
        i2c: "occ-i2c",
        sc8562: "occ-sc8562"
      }
    },
    {
      view: "effective" as const,
      topologyIds: {
        i2c: "effective-i2c",
        sc8562: "effective-sc8562"
      }
    }
  ])("builds the $view hierarchy from parent identity and aggregates row counts", ({ view, topologyIds }) => {
    const tree = buildDtsTopologyTree({
      view,
      sourceNodes,
      effectiveNodes,
      rows: [
        row("binding-hold-time", topologyIds.i2c, "blocked", view),
        row("binding-gpio-int", topologyIds.sc8562, "attention", view),
        row("binding-status", topologyIds.sc8562, "valid", view)
      ]
    });

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ id: view === "source" ? "occ-root" : "effective-root", label: "/" });
    const amba = findNode(tree, view === "source" ? "occ-amba" : "effective-amba");
    expect(amba.children.map((child) => child.label)).toEqual([
      "i2c@FDF5E000",
      "uart@FF000000"
    ]);

    const i2c = findNode(tree, topologyIds.i2c);
    expect(i2c).toMatchObject({
      parentId: view === "source" ? "occ-amba" : "effective-amba",
      bindingIds: ["binding-hold-time"],
      bindingCount: 3,
      attentionCount: 2
    });
    const sc8562 = findNode(tree, topologyIds.sc8562);
    expect(sc8562).toMatchObject({
      parentId: topologyIds.i2c,
      label: "sc8562@6E",
      name: "sc8562",
      unitAddress: "6E",
      compatible: view === "effective" ? "sc8562" : null,
      bindingIds: ["binding-gpio-int", "binding-status"],
      bindingCount: 2,
      attentionCount: 1
    });
    expect(amba).toMatchObject({ bindingCount: 3, attentionCount: 2 });
    expect(tree[0]).toMatchObject({ bindingCount: 3, attentionCount: 2 });
  });

  it("keeps a node with a missing parent visible as a root without using its path as identity", () => {
    const orphan = {
      ...sourceNodes[4]!,
      id: "occ-orphan",
      parentOccurrenceId: "occ-missing",
      nodePath: "occ-root"
    };
    const tree = buildDtsTopologyTree({
      view: "source",
      sourceNodes: [...sourceNodes, orphan],
      effectiveNodes,
      rows: [row("binding-orphan", "occ-orphan", "valid", "source")]
    });

    expect(tree.map((node) => node.id)).toEqual(["occ-root", "occ-orphan"]);
    expect(tree[1]).toMatchObject({ parentId: null, bindingIds: ["binding-orphan"] });
    expect(findNode(tree, "occ-root").bindingIds).toEqual([]);
  });

  it("fails closed on duplicate source occurrence ids", () => {
    expect(() =>
      buildDtsTopologyTree({
        view: "source",
        sourceNodes: [...sourceNodes, { ...sourceNodes[4]!, name: "duplicate" }],
        effectiveNodes,
        rows: []
      })
    ).toThrow(/duplicate.*occ-sc8562/i);
  });

  it("fails closed on duplicate effective logical identities", () => {
    expect(() =>
      buildDtsTopologyTree({
        view: "effective",
        sourceNodes,
        effectiveNodes: [
          ...effectiveNodes,
          { ...effectiveNodes[4]!, id: "effective-duplicate" }
        ],
        rows: []
      })
    ).toThrow(/duplicate.*logical-sc8562/i);
  });

  it("fails closed on a parent cycle instead of recursing forever", () => {
    const cyclicNodes = sourceNodes.map((node) => {
      if (node.id === "occ-root") return { ...node, parentOccurrenceId: "occ-sc8562" };
      return node;
    });

    expect(() =>
      buildDtsTopologyTree({
        view: "source",
        sourceNodes: cyclicNodes,
        effectiveNodes,
        rows: []
      })
    ).toThrow(/cycle/i);
  });
});
