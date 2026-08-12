import { describe, expect, it } from "vitest";

import {
  describeReloadValueShapeAuthoring,
  isIntegerCellFamilyKind,
  isPhandleCellFamilyKind,
  isSupportedCellBits,
  isSupportedReloadValueShape
} from "./valueShape";

describe("shape family predicates", () => {
  it("classifies integer-cell and phandle-cell catalog kinds", () => {
    expect(isIntegerCellFamilyKind("cells")).toBe(true);
    expect(isIntegerCellFamilyKind("u32-array")).toBe(true);
    expect(isIntegerCellFamilyKind("bytes")).toBe(true);
    expect(isIntegerCellFamilyKind("mixed")).toBe(false);

    expect(isPhandleCellFamilyKind("mixed")).toBe(true);
    expect(isPhandleCellFamilyKind("phandle-list")).toBe(true);
    expect(isPhandleCellFamilyKind("phandle-cells")).toBe(true);
    expect(isPhandleCellFamilyKind("cells")).toBe(false);
    expect(isPhandleCellFamilyKind(null)).toBe(false);
  });

  it("supports exactly the 8/16/32 cell widths", () => {
    expect(isSupportedCellBits(8)).toBe(true);
    expect(isSupportedCellBits(16)).toBe(true);
    expect(isSupportedCellBits(32)).toBe(true);
    expect(isSupportedCellBits(64)).toBe(false);
    expect(isSupportedCellBits(undefined)).toBe(false);
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

  it("accepts catalog single strings", () => {
    expect(isSupportedReloadValueShape({ kind: "string" })).toBe(true);
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

describe("describeReloadValueShapeAuthoring", () => {
  it("states the single-string and string-list examples once for both runtimes", () => {
    expect(describeReloadValueShapeAuthoring({ kind: "string" })).toEqual({
      placeholder: '"bat0_raw_temp"',
      example: '"bat0_raw_temp"'
    });
    expect(describeReloadValueShapeAuthoring({ kind: "string-list" })).toEqual({
      placeholder: '"okay"',
      example: '"okay" or "a", "b"'
    });
  });

  it("states the GPIO phandle example for every phandle-family kind", () => {
    for (const kind of ["phandle-cells", "mixed", "phandle-list"]) {
      expect(describeReloadValueShapeAuthoring({ kind })).toEqual({
        placeholder: "<&gpio13 29 0>",
        example: "<&gpio13 29 0>"
      });
    }
  });

  it("states /bits/ examples for sub-32-bit widths and the u32 example otherwise", () => {
    expect(describeReloadValueShapeAuthoring({ kind: "cells", bits: 8, cellsPerGroup: 1 })).toEqual({
      placeholder: "/bits/ 8 <17>",
      example: "/bits/ 8 <17>"
    });
    expect(describeReloadValueShapeAuthoring({ kind: "cells", bits: 16, cellsPerGroup: 2 })).toEqual({
      placeholder: "/bits/ 16 <17>",
      example: "/bits/ 16 <17>"
    });
    expect(describeReloadValueShapeAuthoring({ kind: "cells", bits: 32, cellsPerGroup: 1 })).toEqual({
      placeholder: "<7000>",
      example: "<6000>, <0x1770>, or <1 2 3>"
    });
    expect(describeReloadValueShapeAuthoring(null)).toEqual({
      placeholder: "<7000>",
      example: "<6000>, <0x1770>, or <1 2 3>"
    });
  });
});
