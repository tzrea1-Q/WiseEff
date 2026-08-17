import { describe, expect, it } from "vitest";

import { classifyReloadCandidate, normalizeReloadCandidates } from "./candidates";
import type { ReloadCandidateDto } from "./types";

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
      }).debuggable
    ).toBe(true);
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
        propertyKey: "replace_sensor",
        displayName: "replace_sensor",
        valueShape: { kind: "string" },
        valueShapeKind: "string",
        baselineValue: '"bat0_raw_temp"'
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

  it("marks boolean, empty, bare phandle, and true mixed bindings as debuggable", () => {
    expect(
      classifyReloadCandidate({
        ...base,
        propertyKey: "keep-power",
        valueShape: { kind: "boolean" },
        valueShapeKind: "boolean",
        baselineValue: "",
        constraints: {}
      }).debuggable
    ).toBe(true);
    expect(
      classifyReloadCandidate({
        ...base,
        propertyKey: "ranges",
        valueShape: { kind: "empty" },
        valueShapeKind: "empty",
        baselineValue: "",
        constraints: {}
      }).debuggable
    ).toBe(true);
    expect(
      classifyReloadCandidate({
        ...base,
        propertyKey: "aux-map",
        valueShape: { kind: "mixed" },
        valueShapeKind: "mixed",
        baselineValue: '"aux", <1 0>',
        constraints: {}
      }).debuggable
    ).toBe(true);
  });

  it("still blocks mixed catalog rows whose baseline is integer cells", () => {
    expect(
      classifyReloadCandidate({
        ...base,
        propertyKey: "aux-map",
        valueShape: { kind: "mixed" },
        valueShapeKind: "mixed",
        baselineValue: "<1 2 3>",
        constraints: {}
      }).blockReason
    ).toBe("unsupported-value-shape");
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
