import { describe, expect, it } from "vitest";
import type { DtsCompareBaselineResult, DtsStructuralChange } from "@/application/ports/DtsStructuredRepository";
import {
  aggregateLocalStructuredEdits,
  aggregateStructuredChangeSet,
  sourceNodePathForChange,
  type ParameterSourceLookup
} from "./structuredChangeSet";

function compareResult(
  members: DtsCompareBaselineResult["members"],
  baselineId = "bl-1"
): DtsCompareBaselineResult {
  return { baselineId, members };
}

function lookup(id: string, fileName: string, nodePath: string): ParameterSourceLookup {
  return { id, sourceFileName: fileName, sourceNodePath: nodePath };
}

describe("sourceNodePathForChange", () => {
  it("joins nodePath and prop for property-level changes", () => {
    const change: DtsStructuralChange = {
      kind: "prop_changed",
      nodePath: "demo_integer",
      prop: "single_value",
      before: "<42>",
      after: "<43>"
    };
    expect(sourceNodePathForChange(change)).toBe("demo_integer/single_value");
  });

  it("returns nodePath alone for node-level changes", () => {
    expect(sourceNodePathForChange({ kind: "node_added", nodePath: "demo_bool/sub_module" })).toBe(
      "demo_bool/sub_module"
    );
  });
});

describe("aggregateStructuredChangeSet", () => {
  it("aggregates multi-file property changes into one logical unit with CR submit items", () => {
    const result = aggregateStructuredChangeSet(
      compareResult([
        {
          fileId: "f-board",
          fileName: "board.dts",
          status: "version_changed",
          structuralDiff: [
            {
              kind: "prop_changed",
              nodePath: "demo_integer",
              prop: "single_value",
              before: "<42>",
              after: "<150>"
            }
          ]
        },
        {
          fileId: "f-thermal",
          fileName: "thermal.dts",
          status: "version_changed",
          structuralDiff: [
            {
              kind: "prop_added",
              nodePath: "thermal_zone",
              prop: "polling_delay",
              after: "<1000>"
            },
            {
              kind: "prop_removed",
              nodePath: "thermal_zone",
              prop: "legacy_limit",
              before: "<50>"
            }
          ]
        }
      ]),
      [
        lookup("param-int", "board.dts", "demo_integer/single_value"),
        lookup("param-poll", "thermal.dts", "thermal_zone/polling_delay"),
        lookup("param-legacy", "thermal.dts", "thermal_zone/legacy_limit")
      ]
    );

    expect(result.baselineId).toBe("bl-1");
    expect(result.items).toEqual([
      {
        parameterId: "param-int",
        targetValue: "<150>",
        reason: expect.stringContaining("demo_integer/single_value")
      },
      {
        parameterId: "param-poll",
        targetValue: "<1000>",
        reason: expect.stringContaining("thermal_zone/polling_delay")
      },
      {
        parameterId: "param-legacy",
        targetValue: "",
        reason: expect.stringContaining("legacy_limit")
      }
    ]);
    expect(result.unmapped).toEqual([]);
    expect(result.changes).toHaveLength(3);
  });

  it("puts node_added/removed into unmapped and does not invent fake CR items", () => {
    const result = aggregateStructuredChangeSet(
      compareResult([
        {
          fileId: "f-1",
          fileName: "board.dts",
          status: "version_changed",
          structuralDiff: [
            { kind: "node_added", nodePath: "demo_bool/sub_module" },
            { kind: "node_removed", nodePath: "orphaned" },
            {
              kind: "prop_changed",
              nodePath: "demo_integer",
              prop: "single_value",
              before: "<1>",
              after: "<2>"
            }
          ]
        }
      ]),
      [lookup("param-int", "board.dts", "demo_integer/single_value")]
    );

    expect(result.items).toEqual([
      {
        parameterId: "param-int",
        targetValue: "<2>",
        reason: expect.stringContaining("demo_integer/single_value")
      }
    ]);
    expect(result.unmapped).toEqual([
      expect.objectContaining({
        fileId: "f-1",
        fileName: "board.dts",
        change: { kind: "node_added", nodePath: "demo_bool/sub_module" }
      }),
      expect.objectContaining({
        change: { kind: "node_removed", nodePath: "orphaned" }
      })
    ]);
  });

  it("puts prop changes without a source binding into unmapped", () => {
    const result = aggregateStructuredChangeSet(
      compareResult([
        {
          fileId: "f-1",
          fileName: "board.dts",
          status: "version_changed",
          structuralDiff: [
            {
              kind: "prop_changed",
              nodePath: "unknown",
              prop: "value",
              before: "<1>",
              after: "<2>"
            }
          ]
        }
      ]),
      [lookup("param-int", "board.dts", "demo_integer/single_value")]
    );

    expect(result.items).toEqual([]);
    expect(result.unmapped).toHaveLength(1);
    expect(result.unmapped[0]?.change).toMatchObject({ kind: "prop_changed", prop: "value" });
  });

  it("yields an empty change set when structuralDiff is empty (equivalent reorder / normalized equality)", () => {
    const result = aggregateStructuredChangeSet(
      compareResult([
        {
          fileId: "f-1",
          fileName: "board.dts",
          status: "version_changed",
          structuralDiff: []
        },
        {
          fileId: "f-2",
          fileName: "thermal.dts",
          status: "unchanged"
        }
      ]),
      [lookup("param-int", "board.dts", "demo_integer/single_value")]
    );

    expect(result.items).toEqual([]);
    expect(result.unmapped).toEqual([]);
    expect(result.changes).toEqual([]);
  });
});

describe("aggregateLocalStructuredEdits", () => {
  it("builds Port submit edits from local drafts using rawText and maps without unmapped when lookups match", () => {
    const result = aggregateLocalStructuredEdits({
      fileId: "file-board",
      fileName: "board.dts",
      drafts: [
        {
          nodePath: "amba/i2c@XXXX0000",
          propertyName: "mixed_case_reg",
          beforeRawText: "/bits/ 8 <0xab 0xcd>",
          rawText: "/bits/ 8 <0xAB 0xCD>",
          normalizedValue: "/bits/ 8 <0xab 0xcd>"
        }
      ],
      parameters: [lookup("ppv-hex", "board.dts", "amba/i2c@XXXX0000/mixed_case_reg")]
    });

    expect(result.edits).toEqual([
      {
        fileId: "file-board",
        nodePath: "amba/i2c@XXXX0000",
        propertyName: "mixed_case_reg",
        rawText: "/bits/ 8 <0xAB 0xCD>",
        reason: expect.stringContaining("amba/i2c@XXXX0000/mixed_case_reg")
      }
    ]);
    expect(result.changeSet.items).toEqual([
      {
        parameterId: "ppv-hex",
        targetValue: "/bits/ 8 <0xAB 0xCD>",
        reason: expect.any(String)
      }
    ]);
    expect(result.changeSet.unmapped).toEqual([]);
  });

  it("skips unchanged drafts and does not invent unmapped for pending creates without lookup", () => {
    const result = aggregateLocalStructuredEdits({
      fileId: "file-board",
      fileName: "board.dts",
      drafts: [
        {
          nodePath: "demo_integer",
          propertyName: "single_value",
          beforeRawText: "<42>",
          rawText: "<42>",
          normalizedValue: "<42>"
        },
        {
          nodePath: "demo_integer",
          propertyName: "spare",
          beforeRawText: "<1>",
          rawText: "<2>",
          normalizedValue: "<2>"
        }
      ],
      parameters: []
    });

    expect(result.edits).toHaveLength(1);
    expect(result.edits[0]?.rawText).toBe("<2>");
    // Pending create: still submitable via Port (backend ensure); provisional mapped by synthetic id.
    expect(result.changeSet.items).toHaveLength(1);
    expect(result.changeSet.items[0]?.parameterId).toMatch(/^pending:/);
    expect(result.changeSet.unmapped).toEqual([]);
  });
});
