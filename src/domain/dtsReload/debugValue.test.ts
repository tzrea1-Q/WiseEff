import { describe, expect, it } from "vitest";

import { validateDebugValue, type DtsReloadDebugValueTarget } from "./debugValue";

function target(
  resolvedValueShape: DtsReloadDebugValueTarget["resolvedValueShape"],
  constraints: Record<string, unknown> = {}
): DtsReloadDebugValueTarget {
  return { resolvedValueShape, constraints };
}

const u32 = (constraints: Record<string, unknown> = {}) =>
  target({ kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 }, constraints);
const u8 = (constraints: Record<string, unknown> = {}) =>
  target({ kind: "cells", bits: 8, cellsPerGroup: 4, groups: 1 }, constraints);
const u16 = (constraints: Record<string, unknown> = {}) =>
  target({ kind: "cells", bits: 16, cellsPerGroup: 2, groups: 1 }, constraints);
const singleString = () => target({ kind: "string" });
const stringList = () => target({ kind: "string-list" });
const phandleCells = (constraints: Record<string, unknown> = {}) =>
  target({ kind: "phandle-cells", bits: 32, cellsPerGroup: 3, groups: 1 }, constraints);

type Case = {
  name: string;
  raw: string;
  candidate: DtsReloadDebugValueTarget;
  /** `null` = accepted; string/RegExp = expected error message. */
  expected: null | string | RegExp;
};

describe("validateDebugValue", () => {
  describe("u32 cell arrays", () => {
    const cases: Case[] = [
      { name: "accepts a single angle-bracket cell", raw: "<7000>", candidate: u32({ cells: 1 }), expected: null },
      { name: "accepts hex cells", raw: "<0x1B58>", candidate: u32({ cells: 1 }), expected: null },
      { name: "accepts bare integers without brackets", raw: "7000", candidate: u32({ cells: 1 }), expected: null },
      { name: "accepts bare hex", raw: "0x1b58", candidate: u32({ cells: 1 }), expected: null },
      { name: "accepts multiple cells in one group", raw: "<1 2>", candidate: u32({ cells: 2 }), expected: null },
      { name: "counts cells across groups", raw: "<1> <2>", candidate: u32({ cells: 2 }), expected: null },
      { name: "accepts DTS byte-string bracket form as hex cells", raw: "[1B 58]", candidate: u32({ cells: 2 }), expected: null },
      { name: "accepts surrounding whitespace", raw: "  <7000>  ", candidate: u32({ cells: 1 }), expected: null },
      { name: "accepts when no constraints are declared", raw: "<1 2 3>", candidate: u32(), expected: null },
      { name: "rejects empty input", raw: "   ", candidate: u32({ cells: 1 }), expected: "请输入调试值。" },
      { name: "rejects non-numeric text", raw: "abc", candidate: u32({ cells: 1 }), expected: /u32 cell 数组，例如 <7000>/ },
      { name: "rejects an empty group", raw: "<>", candidate: u32({ cells: 1 }), expected: /u32 cell 数组/ },
      { name: "rejects a non-integer token inside a group", raw: "<7000 abc>", candidate: u32(), expected: /u32 cell 数组/ },
      { name: "rejects a cell-count mismatch", raw: "<1 2 3>", candidate: u32({ cells: 1 }), expected: "调试值 cell 数量应为 1，当前为 3。" },
      { name: "rejects values below the declared min", raw: "<-5>", candidate: u32({ min: 0 }), expected: "调试值低于声明的最小值 0。" },
      { name: "rejects values above the declared max", raw: "<99999>", candidate: u32({ max: 20000 }), expected: "调试值超过声明的最大值 20000。" },
      { name: "accepts the declared max boundary", raw: "<20000>", candidate: u32({ max: 20000 }), expected: null },
      { name: "accepts the declared min boundary", raw: "<0>", candidate: u32({ min: 0 }), expected: null },
      { name: "treats a missing shape as 32-bit cells", raw: "<7000>", candidate: target(null, { cells: 1 }), expected: null },
      { name: "treats u32-array catalog kind as 32-bit cells", raw: "<7000>", candidate: target({ kind: "u32-array" }, { cells: 1 }), expected: null }
    ];
    it.each(cases)("$name", ({ raw, candidate, expected }) => {
      const result = validateDebugValue(raw, candidate);
      if (expected === null) {
        expect(result).toBeNull();
      } else if (typeof expected === "string") {
        expect(result).toBe(expected);
      } else {
        expect(result).toMatch(expected);
      }
    });
  });

  describe("/bits/ 8 and /bits/ 16 cell arrays", () => {
    const cases: Case[] = [
      { name: "accepts a /bits/ 8 array", raw: "/bits/ 8 <0x0A 0x14 0x1E 0x28>", candidate: u8({ cells: 4 }), expected: null },
      { name: "accepts the u8 upper boundary 255", raw: "/bits/ 8 <255>", candidate: u8(), expected: null },
      { name: "rejects 256 as overflowing u8", raw: "/bits/ 8 <256>", candidate: u8(), expected: "调试值中的每个数值必须在 0–255 范围内。" },
      { name: "rejects negative u8 values", raw: "/bits/ 8 <-1>", candidate: u8(), expected: "调试值中的每个数值必须在 0–255 范围内。" },
      { name: "rejects a plain cell array without the /bits/ prefix", raw: "<10 20>", candidate: u8(), expected: /\/bits\/ 8 cell 数组，例如 \/bits\/ 8 <17>/ },
      { name: "rejects the wrong /bits/ width prefix", raw: "/bits/ 16 <10>", candidate: u8(), expected: /\/bits\/ 8 cell 数组/ },
      { name: "rejects a u8 cell-count mismatch", raw: "/bits/ 8 <1 2>", candidate: u8({ cells: 4 }), expected: "调试值 cell 数量应为 4，当前为 2。" },
      { name: "rejects non-integer tokens inside a /bits/ group", raw: "/bits/ 8 <1 x>", candidate: u8(), expected: /\/bits\/ 8 cell 数组/ },
      { name: "accepts a /bits/ 16 array", raw: "/bits/ 16 <256 512>", candidate: u16({ cells: 2 }), expected: null },
      { name: "accepts the u16 upper boundary 65535", raw: "/bits/ 16 <65535>", candidate: u16(), expected: null },
      { name: "rejects 65536 as overflowing u16", raw: "/bits/ 16 <65536>", candidate: u16(), expected: "调试值中的每个数值必须在 0–65535 范围内。" },
      { name: "rejects empty input for /bits/ shapes", raw: "", candidate: u8(), expected: "请输入调试值。" }
    ];
    it.each(cases)("$name", ({ raw, candidate, expected }) => {
      const result = validateDebugValue(raw, candidate);
      if (expected === null) {
        expect(result).toBeNull();
      } else if (typeof expected === "string") {
        expect(result).toBe(expected);
      } else {
        expect(result).toMatch(expected);
      }
    });
  });

  describe("single strings", () => {
    const cases: Case[] = [
      { name: "accepts one quoted string", raw: '"bat0_raw_temp"', candidate: singleString(), expected: null },
      { name: "accepts an escaped quote inside the string", raw: '"a\\"b"', candidate: singleString(), expected: null },
      { name: "rejects unquoted text", raw: "okay", candidate: singleString(), expected: /单个字符串，例如 "bat0_raw_temp"/ },
      { name: "rejects two strings for a single-string shape", raw: '"a", "b"', candidate: singleString(), expected: /单个字符串/ },
      { name: "rejects empty input", raw: "", candidate: singleString(), expected: "请输入调试值。" }
    ];
    it.each(cases)("$name", ({ raw, candidate, expected }) => {
      const result = validateDebugValue(raw, candidate);
      if (expected === null) {
        expect(result).toBeNull();
      } else if (typeof expected === "string") {
        expect(result).toBe(expected);
      } else {
        expect(result).toMatch(expected);
      }
    });
  });

  describe("string lists", () => {
    const cases: Case[] = [
      { name: "accepts a single quoted string", raw: '"okay"', candidate: stringList(), expected: null },
      { name: "accepts a comma-separated list", raw: '"sc8562", "sc8562-v2"', candidate: stringList(), expected: null },
      { name: "rejects unquoted text", raw: "sc8562", candidate: stringList(), expected: /字符串列表，例如 "okay"/ },
      { name: "rejects empty input", raw: "  ", candidate: stringList(), expected: "请输入调试值。" }
    ];
    it.each(cases)("$name", ({ raw, candidate, expected }) => {
      const result = validateDebugValue(raw, candidate);
      if (expected === null) {
        expect(result).toBeNull();
      } else if (typeof expected === "string") {
        expect(result).toBe(expected);
      } else {
        expect(result).toMatch(expected);
      }
    });
  });

  describe("GPIO-style phandle cell arrays", () => {
    const cases: Case[] = [
      { name: "accepts a single phandle group", raw: "<&gpio13 29 0>", candidate: phandleCells({ cells: 3 }), expected: null },
      { name: "accepts multiple uniform groups", raw: "<&gpio1 2 3> <&gpio2 4 5>", candidate: phandleCells({ cells: 3 }), expected: null },
      { name: "accepts hex integers after the phandle", raw: "<&gpio13 0x1D 0x0>", candidate: phandleCells({ cells: 3 }), expected: null },
      { name: "routes the mixed catalog kind to the phandle family", raw: "<&gpio13 29 0>", candidate: target({ kind: "mixed" }, { cells: 3 }), expected: null },
      { name: "routes the phandle-list catalog kind to the phandle family", raw: "<&gpio13 29 0>", candidate: target({ kind: "phandle-list" }, { cells: 3 }), expected: null },
      { name: "rejects integer-only groups without a phandle label", raw: "<1 2 3>", candidate: phandleCells(), expected: /GPIO 风格 phandle 数组，例如 <&gpio13 29 0>/ },
      { name: "rejects a phandle without trailing integers", raw: "<&gpio13>", candidate: phandleCells(), expected: /GPIO 风格 phandle 数组/ },
      { name: "rejects non-uniform group widths", raw: "<&a 1 2> <&b 1>", candidate: phandleCells(), expected: /GPIO 风格 phandle 数组/ },
      { name: "rejects a width that misses the declared cell count", raw: "<&gpio13 29>", candidate: phandleCells({ cells: 3 }), expected: "调试值 cell 数量应为 3，当前为 2。" },
      { name: "rejects integers below the declared min", raw: "<&gpio13 -1 0>", candidate: phandleCells({ min: 0 }), expected: "调试值低于声明的最小值 0。" },
      { name: "rejects integers above the declared max", raw: "<&gpio13 29 99>", candidate: phandleCells({ max: 64 }), expected: "调试值超过声明的最大值 64。" },
      { name: "rejects a malformed label token", raw: "<&9gpio 29 0>", candidate: phandleCells(), expected: /GPIO 风格 phandle 数组/ },
      { name: "rejects empty input", raw: "", candidate: phandleCells(), expected: "请输入调试值。" }
    ];
    it.each(cases)("$name", ({ raw, candidate, expected }) => {
      const result = validateDebugValue(raw, candidate);
      if (expected === null) {
        expect(result).toBeNull();
      } else if (typeof expected === "string") {
        expect(result).toBe(expected);
      } else {
        expect(result).toMatch(expected);
      }
    });
  });

  it("ignores non-numeric constraint entries instead of applying them", () => {
    expect(
      validateDebugValue("<7000>", u32({ cells: "not-a-number", min: null, max: undefined }))
    ).toBeNull();
  });
});
