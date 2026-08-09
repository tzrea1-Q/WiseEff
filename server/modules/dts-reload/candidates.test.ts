import { describe, expect, it } from "vitest";

import {
  classifyReloadCandidate,
  isSupportedReloadValueShape,
  isSynthesisedAnchorLocator
} from "./candidates";

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

describe("isSupportedReloadValueShape", () => {
  it("accepts a single u32 cell", () => {
    expect(isSupportedReloadValueShape({ kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 })).toBe(true);
  });

  it("rejects multi-cell and non-u32 shapes", () => {
    expect(isSupportedReloadValueShape({ kind: "cells", bits: 32, cellsPerGroup: 2 })).toBe(false);
    expect(isSupportedReloadValueShape({ kind: "cells", bits: 8, cellsPerGroup: 1 })).toBe(false);
    expect(isSupportedReloadValueShape({ kind: "string-list" })).toBe(false);
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

  it("blocks a synthesised-anchor locator on the parameter itself", () => {
    expect(classifyReloadCandidate({ ...base, nodePath: "/amba" })).toMatchObject({
      debuggable: false,
      blockReason: "synthesised-anchor"
    });
  });

  it("blocks missing path, unsupported shape, and missing baseline", () => {
    expect(classifyReloadCandidate({ ...base, nodePath: null }).blockReason).toBe("no-node-path");
    expect(
      classifyReloadCandidate({ ...base, valueShape: { kind: "string-list" }, valueShapeKind: "string-list" })
        .blockReason
    ).toBe("unsupported-value-shape");
    expect(classifyReloadCandidate({ ...base, baselineValue: null }).blockReason).toBe("no-baseline-value");
  });
});
