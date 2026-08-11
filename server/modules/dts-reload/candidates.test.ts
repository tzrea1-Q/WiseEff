import { describe, expect, it } from "vitest";

import {
  classifyReloadCandidate,
  inferCellsPerGroupFromBaseline,
  isSupportedReloadValueShape,
  isSynthesisedAnchorLocator,
  normalizeReloadCandidates,
  resolveReloadValueShape
} from "./candidates";
import type { ReloadCandidateDto } from "./types";

describe("isSynthesisedAnchorLocator", () => {
  it("refuses a single-segment label-shaped locator", () => {
    expect(isSynthesisedAnchorLocator("/amba")).toBe(true);
    expect(isSynthesisedAnchorLocator("/charger")).toBe(true);
  });

  it("allows a descendant hanging under a synthesised parent", () => {
    expect(isSynthesisedAnchorLocator("/amba/i2c@FDF5E000/sc8562@6E")).toBe(false);
  });

  it("allows a real unit-addressed root node", () => {
    expect(isSynthesisedAnchorLocator("/soc@0")).toBe(false);
  });

  it("treats null or empty as not synthesised (handled by no-node-path)", () => {
    expect(isSynthesisedAnchorLocator(null)).toBe(false);
    expect(isSynthesisedAnchorLocator("")).toBe(false);
  });
});

describe("resolveReloadValueShape", () => {
  it("aliases complete u32-array onto cells", () => {
    expect(resolveReloadValueShape({ kind: "u32-array", bits: 32, cellsPerGroup: 3 }, null)).toEqual({
      kind: "cells",
      bits: 32,
      cellsPerGroup: 3
    });
  });

  it("defaults bits=32 for u32-array and infers cellsPerGroup from a regular baseline", () => {
    // DTS angle-brackets form one group; newlines are visual only — nine cells → width 9.
    expect(
      resolveReloadValueShape(
        { kind: "u32-array" },
        "<\n\t\t\t16 100 100\n\t\t\t6 15 100\n\t\t\t0 5 100>"
      )
    ).toEqual({
      kind: "cells",
      bits: 32,
      cellsPerGroup: 9
    });
    expect(resolveReloadValueShape({ kind: "u32-array" }, "<1 2 3>, <4 5 6>")).toEqual({
      kind: "cells",
      bits: 32,
      cellsPerGroup: 3
    });
  });

  it("returns an incomplete cells shape when baseline width cannot be inferred", () => {
    expect(resolveReloadValueShape({ kind: "u32-array" }, "<1 2>, <3 4 5>")).toEqual({
      kind: "cells",
      bits: 32
    });
    expect(resolveReloadValueShape({ kind: "u32-array" }, null)).toEqual({
      kind: "cells",
      bits: 32
    });
  });
});

describe("inferCellsPerGroupFromBaseline", () => {
  it("returns null for irregular or empty baselines", () => {
    expect(inferCellsPerGroupFromBaseline(null)).toBeNull();
    expect(inferCellsPerGroupFromBaseline("<1 2>, <3 4 5>")).toBeNull();
    expect(inferCellsPerGroupFromBaseline('"okay"')).toBeNull();
  });
});

describe("isSupportedReloadValueShape", () => {
  it("accepts a single u32 cell", () => {
    expect(isSupportedReloadValueShape({ kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 })).toBe(true);
  });

  it("accepts multi-cell u32 arrays", () => {
    expect(isSupportedReloadValueShape({ kind: "cells", bits: 32, cellsPerGroup: 2, groups: 1 })).toBe(true);
    expect(isSupportedReloadValueShape({ kind: "cells", bits: 32, cellsPerGroup: 4, groups: 2 })).toBe(true);
  });

  it("accepts complete u32-array catalog shapes", () => {
    expect(isSupportedReloadValueShape({ kind: "u32-array", bits: 32, cellsPerGroup: 1 })).toBe(true);
    expect(isSupportedReloadValueShape({ kind: "u32-array", cellsPerGroup: 3 })).toBe(true);
  });

  it("accepts string lists", () => {
    expect(isSupportedReloadValueShape({ kind: "string-list" })).toBe(true);
  });

  it("rejects non-u32 cells, phandle lists, and incomplete cell shapes", () => {
    expect(isSupportedReloadValueShape({ kind: "cells", bits: 8, cellsPerGroup: 1 })).toBe(false);
    expect(isSupportedReloadValueShape({ kind: "cells", bits: 32 })).toBe(false);
    expect(isSupportedReloadValueShape({ kind: "phandle-list", bits: 32, cellsPerGroup: 1 })).toBe(false);
    expect(isSupportedReloadValueShape({ kind: "u32-array" })).toBe(false);
    expect(isSupportedReloadValueShape(null)).toBe(false);
  });
});

describe("classifyReloadCandidate", () => {
  const base = {
    bindingId: "b1",
    projectId: "p1",
    propertyKey: "watchdog_time",
    displayName: "Watchdog",
    module: "charger",
    baselineValue: "<6000>",
    valueShape: { kind: "cells" as const, bits: 32, cellsPerGroup: 1, groups: 1 },
    valueShapeKind: "cells",
    unit: "ms",
    constraints: { min: 0, max: 10000, cells: 1 },
    nodePath: "/amba/i2c@1/dev@6E"
  };

  it("marks a supported absolute-path binding as debuggable", () => {
    expect(classifyReloadCandidate(base).debuggable).toBe(true);
  });

  it("carries parameter meaning onto the candidate DTO", () => {
    expect(
      classifyReloadCandidate({
        ...base,
        description: "  Watchdog timeout  "
      }).description
    ).toBe("Watchdog timeout");
    expect(classifyReloadCandidate({ ...base, description: "   " }).description).toBeNull();
  });

  it("blocks a synthesised-anchor locator on the parameter itself", () => {
    expect(classifyReloadCandidate({ ...base, nodePath: "/amba" })).toMatchObject({
      debuggable: false,
      blockReason: "synthesised-anchor"
    });
  });

  it("blocks missing path, unsupported shape, and missing baseline", () => {
    expect(classifyReloadCandidate({ ...base, nodePath: null }).blockReason).toBe("no-node-path");
    expect(
      classifyReloadCandidate({
        ...base,
        valueShape: { kind: "phandle-list", bits: 32, cellsPerGroup: 1 },
        valueShapeKind: "phandle-list"
      }).blockReason
    ).toBe("unsupported-value-shape");
    expect(classifyReloadCandidate({ ...base, baselineValue: null }).blockReason).toBe("no-baseline-value");
  });

  it("marks string-list and multi-cell u32 bindings as debuggable", () => {
    expect(
      classifyReloadCandidate({
        ...base,
        valueShape: { kind: "string-list" },
        valueShapeKind: "string-list",
        baselineValue: '"okay"'
      }).debuggable
    ).toBe(true);
    expect(
      classifyReloadCandidate({
        ...base,
        valueShape: { kind: "cells", bits: 32, cellsPerGroup: 3, groups: 1 },
        valueShapeKind: "cells",
        baselineValue: "<1 2 3>"
      }).debuggable
    ).toBe(true);
  });

  it("marks incomplete u32-array shapes debuggable when baseline width is regular", () => {
    expect(
      classifyReloadCandidate({
        ...base,
        propertyKey: "active_perf_limit",
        displayName: "active_perf_limit",
        valueShape: { kind: "u32-array" },
        valueShapeKind: "u32-array",
        baselineValue: "<\n\t\t\t16 100 100\n\t\t\t6 15 100\n\t\t\t0 5 100>",
        nodePath: "/hisi_vbat_drop_protect_v2/middle_cpu",
        constraints: {}
      }).debuggable
    ).toBe(true);
  });

  it("still blocks incomplete u32-array when baseline width is irregular", () => {
    expect(
      classifyReloadCandidate({
        ...base,
        valueShape: { kind: "u32-array" },
        valueShapeKind: "u32-array",
        baselineValue: "<1 2>, <3 4 5>",
        constraints: {}
      }).blockReason
    ).toBe("unsupported-value-shape");
  });
});

describe("normalizeReloadCandidates", () => {
  function item(overrides: Partial<ReloadCandidateDto>): ReloadCandidateDto {
    return {
      bindingId: "b1",
      projectId: "p1",
      propertyKey: "active_perf_limit",
      displayName: "active_perf_limit",
      module: "middle_cpu",
      moduleId: null,
      nodePath: "/hisi_vbat_drop_protect_v2/middle_cpu",
      compatible: null,
      baselineValue: "<1 2 3>",
      description: null,
      valueShapeKind: "u32-array",
      unit: null,
      constraints: {},
      debuggable: false,
      blockReason: "unsupported-value-shape",
      sensitiveMatch: null,
      lastReload: null,
      ...overrides
    };
  }

  it("keeps one winner per propertyKey+nodePath and prefers debuggable", () => {
    const items = normalizeReloadCandidates([
      item({ bindingId: "blocked-a", debuggable: false, blockReason: "no-node-path", nodePath: null }),
      item({ bindingId: "blocked-b", debuggable: false, blockReason: "unsupported-value-shape" }),
      item({ bindingId: "ok", debuggable: true, blockReason: undefined })
    ]);
    expect(items).toHaveLength(2);
    expect(items.find((row) => row.nodePath === null)?.bindingId).toBe("blocked-a");
    expect(items.find((row) => row.nodePath)?.bindingId).toBe("ok");
  });

  it("keeps distinct absolute paths for the same property", () => {
    const items = normalizeReloadCandidates([
      item({ bindingId: "a", nodePath: "/path-a", debuggable: true, blockReason: undefined }),
      item({ bindingId: "b", nodePath: "/path-b", debuggable: true, blockReason: undefined })
    ]);
    expect(items.map((row) => row.bindingId)).toEqual(["a", "b"]);
  });
});
