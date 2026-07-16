import { describe, expect, it } from "vitest";
import { buildProvenanceLabels } from "./buildProvenanceLabels";
import type { EffectiveTopologyEffect, SourceTopologyNode } from "./types";

const SOURCE_NODES: SourceTopologyNode[] = [
  {
    id: "src-sc8562",
    fileVersionId: "fv-overlay",
    fileName: "board-overlay.dts",
    parentOccurrenceId: null,
    name: "sc8562",
    unitAddress: "6E",
    labels: ["sc8562"],
    isOverlayRoot: false,
    nodePath: "/amba/i2c@FDF5E000/sc8562@6E",
    startLine: 42,
    startColumn: 1,
    endLine: 60,
    endColumn: 1,
    contentHash: "hash",
    sourceOrder: 1,
    properties: [
      {
        id: "src-prop-gpio-int",
        propertyName: "gpio_int",
        startLine: 48,
        startColumn: 1,
        endLine: 48,
        endColumn: 30,
        contentHash: "hash-prop",
        sourceOrder: 1
      }
    ]
  }
];

const EFFECTS: EffectiveTopologyEffect[] = [
  {
    id: "eff-1",
    propertyName: "gpio_int",
    effectKind: "override",
    nodeOccurrenceId: "src-sc8562",
    propertyOccurrenceId: "src-prop-gpio-int",
    sourceOrder: 1
  }
];

describe("buildProvenanceLabels", () => {
  it("uses API fileName, locator, line, and effect kind — never hardcodes power.dtso", () => {
    const labels = buildProvenanceLabels({
      effects: EFFECTS,
      sourceNodes: SOURCE_NODES,
      propertyKey: "gpio_int",
      nodeLocator: "/amba/i2c@FDF5E000/sc8562@6E"
    });

    expect(labels).toEqual([
      "board-overlay.dts · /amba/i2c@FDF5E000/sc8562@6E · L48 · override"
    ]);
    expect(labels.join("\n")).not.toMatch(/power\.dtso/);
  });

  it("falls back to fileVersionId when fileName is absent", () => {
    const nodes: SourceTopologyNode[] = [
      {
        ...SOURCE_NODES[0]!,
        fileName: undefined
      }
    ];
    const labels = buildProvenanceLabels({
      effects: EFFECTS,
      sourceNodes: nodes,
      propertyKey: "gpio_int"
    });
    expect(labels[0]).toMatch(/^fileVersion:fv-overlay · /);
  });
});
