import { describe, expect, it } from "vitest";

import {
  classifyReloadCandidate,
  inferCellsPerGroupFromBaseline,
  isSupportedReloadValueShape,
  normalizeReloadCandidates,
  resolveReloadValueShape
} from "./candidates";
import type { ReloadCandidateDto } from "./types";

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

  it("resolves mixed / phandle-list GPIO baselines onto phandle-cells", () => {
    expect(resolveReloadValueShape({ kind: "mixed" }, "<&gpio13 29 0>")).toEqual({
      kind: "phandle-cells",
      bits: 32,
      cellsPerGroup: 3
    });
    expect(
      resolveReloadValueShape({ kind: "phandle-list", cellsPerGroup: 3 }, "<&gpio6 15 0>")
    ).toEqual({
      kind: "phandle-cells",
      bits: 32,
      cellsPerGroup: 3
    });
  });

  it("does not invent width for a bare phandle-only list such as interrupt-parent", () => {
    expect(resolveReloadValueShape({ kind: "phandle-list" }, "<&gic>")).toEqual({
      kind: "phandle-cells",
      bits: 32
    });
  });

  it("resolves catalog bytes with /bits/ 8 baselines onto 8-bit cells", () => {
    expect(resolveReloadValueShape({ kind: "bytes" }, "/bits/ 8 <17>")).toEqual({
      kind: "cells",
      bits: 8,
      cellsPerGroup: 1,
      groups: 1
    });
    expect(resolveReloadValueShape({ kind: "bytes" }, "/bits/ 8 <0x5 0x5 0x5>")).toEqual({
      kind: "cells",
      bits: 8,
      cellsPerGroup: 3,
      groups: 1
    });
  });
});

describe("inferCellsPerGroupFromBaseline", () => {
  it("returns null for irregular, empty, or non-u32 baselines", () => {
    expect(inferCellsPerGroupFromBaseline(null)).toBeNull();
    expect(inferCellsPerGroupFromBaseline("<1 2>, <3 4 5>")).toBeNull();
    expect(inferCellsPerGroupFromBaseline('"okay"')).toBeNull();
    expect(inferCellsPerGroupFromBaseline("<&gpio13 29 0>")).toBeNull();
    expect(inferCellsPerGroupFromBaseline("/bits/ 8 <17>")).toBeNull();
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

  it("accepts complete GPIO-style phandle-cells", () => {
    expect(isSupportedReloadValueShape({ kind: "phandle-cells", bits: 32, cellsPerGroup: 3 })).toBe(true);
  });

  it("accepts 8-bit and 16-bit integer cell arrays", () => {
    expect(isSupportedReloadValueShape({ kind: "cells", bits: 8, cellsPerGroup: 1, groups: 1 })).toBe(true);
    expect(isSupportedReloadValueShape({ kind: "cells", bits: 8, cellsPerGroup: 3 })).toBe(true);
    expect(isSupportedReloadValueShape({ kind: "cells", bits: 16, cellsPerGroup: 2 })).toBe(true);
  });

  it("rejects unsupported bits, unresolved phandle families, and incomplete cell shapes", () => {
    expect(isSupportedReloadValueShape({ kind: "cells", bits: 64, cellsPerGroup: 1 })).toBe(false);
    expect(isSupportedReloadValueShape({ kind: "cells", bits: 32 })).toBe(false);
    expect(isSupportedReloadValueShape({ kind: "phandle-list", bits: 32, cellsPerGroup: 1 })).toBe(false);
    expect(isSupportedReloadValueShape({ kind: "phandle-cells", bits: 32 })).toBe(false);
    expect(isSupportedReloadValueShape({ kind: "phandle-cells", bits: 32, cellsPerGroup: 1 })).toBe(false);
    expect(isSupportedReloadValueShape({ kind: "bytes" })).toBe(false);
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

  it("treats a single-segment /label path the same as any other absolute path", () => {
    const candidate = classifyReloadCandidate({ ...base, nodePath: "/amba" });
    expect(candidate.debuggable).toBe(true);
    expect(candidate.blockReason).toBeUndefined();
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
    expect(
      classifyReloadCandidate({
        ...base,
        propertyKey: "interrupt-parent",
        valueShape: { kind: "phandle-list" },
        valueShapeKind: "phandle-list",
        baselineValue: "<&gic>",
        constraints: {}
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

  it("marks GPIO-style mixed gpio_int bindings as debuggable", () => {
    expect(
      classifyReloadCandidate({
        ...base,
        propertyKey: "gpio_int",
        displayName: "gpio_int",
        valueShape: { kind: "mixed" },
        valueShapeKind: "mixed",
        baselineValue: "<&gpio13 29 0>",
        constraints: { cells: 3 }
      }).debuggable
    ).toBe(true);
  });

  it("marks catalog bytes bindings authored as /bits/ 8 as debuggable", () => {
    expect(
      classifyReloadCandidate({
        ...base,
        propertyKey: "prevfod1_product_list",
        displayName: "prevfod1_product_list",
        valueShape: { kind: "bytes" },
        valueShapeKind: "bytes",
        baselineValue: "/bits/ 8 <17>",
        nodePath: "/amba/i2c@FF24E000/mt5788@2B",
        constraints: {}
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
