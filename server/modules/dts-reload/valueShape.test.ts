import { describe, expect, it } from "vitest";

import { parseDtsValue } from "../dts";
import {
  canonicalizeReloadValue,
  compareReloadDebugValue,
  inferCellsPerGroupFromBaseline,
  resolveReloadValueShape,
  validateAuthoredDebugValue
} from "./valueShape";

describe("resolveReloadValueShape", () => {
  it("aliases catalog string onto string", () => {
    expect(resolveReloadValueShape({ kind: "string" }, '"bat0_raw_temp"')).toEqual({ kind: "string" });
  });

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

describe("validateAuthoredDebugValue", () => {
  it("accepts a u32 cell and returns the parsed value for overlay generation", () => {
    const result = validateAuthoredDebugValue("watchdog_time", "<7000>", {
      kind: "cells",
      bits: 32,
      cellsPerGroup: 1,
      groups: 1
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.kind).toBe("cells");
    }
  });

  it("accepts a /bits/ 8 authoring form under a resolved 8-bit cells shape", () => {
    const result = validateAuthoredDebugValue("prevfod1_product_list", "/bits/ 8 <17>", {
      kind: "cells",
      bits: 8,
      cellsPerGroup: 1,
      groups: 1
    });
    expect(result.ok).toBe(true);
  });

  it("reports unparsable input with the parser message", () => {
    const result = validateAuthoredDebugValue("watchdog_time", "<<<broken", {
      kind: "cells",
      bits: 32,
      cellsPerGroup: 1
    });
    expect(result).toMatchObject({ ok: false, issue: { reason: "unparsable" } });
  });

  it("rejects a multi-string value under a single-string shape", () => {
    expect(
      validateAuthoredDebugValue("replace_sensor", '"a", "b"', { kind: "string" })
    ).toMatchObject({ ok: false, issue: { reason: "not-single-string" } });
    expect(
      validateAuthoredDebugValue("replace_sensor", '"bat0_raw_temp"', { kind: "string" }).ok
    ).toBe(true);
  });

  it("rejects non-string input under a string-list shape", () => {
    expect(
      validateAuthoredDebugValue("status", "<1>", { kind: "string-list" })
    ).toMatchObject({ ok: false, issue: { reason: "not-string-list" } });
    expect(validateAuthoredDebugValue("status", '"okay"', { kind: "string-list" }).ok).toBe(true);
  });

  it("rejects a phandle value with the wrong group width", () => {
    expect(
      validateAuthoredDebugValue("gpio_int", "<&gpio13 29>", {
        kind: "phandle-cells",
        bits: 32,
        cellsPerGroup: 3
      })
    ).toMatchObject({
      ok: false,
      issue: {
        reason: "cells-per-group-mismatch",
        expectedCellsPerGroup: 3,
        actualCellsPerGroup: [2]
      }
    });
  });

  it("rejects a bare integer value under a phandle-cells shape", () => {
    expect(
      validateAuthoredDebugValue("gpio_int", "<13 29 0>", {
        kind: "phandle-cells",
        bits: 32,
        cellsPerGroup: 3
      })
    ).toMatchObject({ ok: false, issue: { reason: "not-phandle-cell-array" } });
  });

  it("rejects wrong cell dimensions against the declared shape", () => {
    expect(
      validateAuthoredDebugValue("combined_para", "<1 2>", {
        kind: "cells",
        bits: 32,
        cellsPerGroup: 3,
        groups: 1
      })
    ).toMatchObject({
      ok: false,
      issue: { reason: "cells-per-group-mismatch", expectedCellsPerGroup: 3 }
    });
    expect(
      validateAuthoredDebugValue("combined_para", "<1 2 3>, <4 5 6>", {
        kind: "cells",
        bits: 32,
        cellsPerGroup: 3,
        groups: 1
      })
    ).toMatchObject({
      ok: false,
      issue: { reason: "group-count-mismatch", expectedGroups: 1, actualGroups: 2 }
    });
  });

  it("rejects dtc square-bracket spelling as an authoring form", () => {
    expect(
      validateAuthoredDebugValue("prevfod1_product_list", "[22]", {
        kind: "cells",
        bits: 8,
        cellsPerGroup: 1,
        groups: 1
      })
    ).toMatchObject({ ok: false, issue: { reason: "not-integer-cell-array", expectedBits: 8 } });
  });

  it("pins the parser guarantee: per-width integer overflow is refused at parse time", () => {
    // The DTS value parser owns unsigned-range enforcement (no silent dtc truncation can
    // reach a run). These pins keep that guarantee load-bearing for the reload surface.
    const cases: Array<{ raw: string; shape: Parameters<typeof validateAuthoredDebugValue>[2]; message: string }> = [
      {
        raw: "/bits/ 8 <300>",
        shape: { kind: "cells", bits: 8, cellsPerGroup: 1, groups: 1 },
        message: 'Integer literal "300" overflows a 8-bit cell'
      },
      {
        raw: "/bits/ 16 <70000>",
        shape: { kind: "cells", bits: 16, cellsPerGroup: 1 },
        message: 'Integer literal "70000" overflows a 16-bit cell'
      },
      {
        raw: "<0x100000000>",
        shape: { kind: "cells", bits: 32, cellsPerGroup: 1 },
        message: 'Integer literal "0x100000000" overflows a 32-bit cell'
      },
      {
        raw: "<&gpio13 4294967296 0>",
        shape: { kind: "phandle-cells", bits: 32, cellsPerGroup: 3 },
        message: 'Integer literal "4294967296" overflows a 32-bit cell'
      }
    ];
    for (const entry of cases) {
      const result = validateAuthoredDebugValue("p", entry.raw, entry.shape);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issue.reason).toBe("unparsable");
        if (result.issue.reason === "unparsable") {
          expect(result.issue.message).toContain(entry.message);
        }
      }
    }
  });

  it("accepts boundary values at the top of the unsigned range and dtc-style signed minima", () => {
    expect(
      validateAuthoredDebugValue("watchdog_time", "<0xFFFFFFFF>", {
        kind: "cells",
        bits: 32,
        cellsPerGroup: 1
      }).ok
    ).toBe(true);
    expect(
      validateAuthoredDebugValue("prevfod1_product_list", "/bits/ 8 <255>", {
        kind: "cells",
        bits: 8,
        cellsPerGroup: 1
      }).ok
    ).toBe(true);
    // dtc accepts signed minima that wrap (e.g. <-1> as 0xFFFFFFFF); the parser preserves that.
    expect(
      validateAuthoredDebugValue("watchdog_time", "<-1>", {
        kind: "cells",
        bits: 32,
        cellsPerGroup: 1
      }).ok
    ).toBe(true);
  });
});

describe("compareReloadDebugValue", () => {
  it("matches a u32 cell debug value against a bare sysfs decimal read-back", () => {
    expect(
      compareReloadDebugValue({
        propertyKey: "watchdog_time",
        debugValue: "<7000>",
        readValue: "7000\n",
        valueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 }
      })
    ).toBe("matched");
  });

  it("matches hex cell syntax against the same numeric read-back", () => {
    expect(
      compareReloadDebugValue({
        propertyKey: "watchdog_time",
        debugValue: "<0x1B58>",
        readValue: "7000",
        valueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 }
      })
    ).toBe("matched");
  });

  it("reports contradicted for a numeric mismatch without comparing raw text", () => {
    expect(
      compareReloadDebugValue({
        propertyKey: "watchdog_time",
        debugValue: "<7000>",
        readValue: "6000",
        valueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 }
      })
    ).toBe("contradicted");
  });

  it("matches multi-cell arrays by numeric values", () => {
    expect(
      compareReloadDebugValue({
        propertyKey: "combined_para",
        debugValue: "<1 2 3>",
        readValue: "1 2 3",
        valueShape: { kind: "cells", bits: 32, cellsPerGroup: 3, groups: 1 }
      })
    ).toBe("matched");
  });

  it("matches string-list debug values against a quoted or bare driver surface", () => {
    expect(
      compareReloadDebugValue({
        propertyKey: "status",
        debugValue: '"okay"',
        readValue: "okay",
        valueShape: { kind: "string-list" }
      })
    ).toBe("matched");
    expect(
      compareReloadDebugValue({
        propertyKey: "status",
        debugValue: '"okay"',
        readValue: "disabled",
        valueShape: { kind: "string-list" }
      })
    ).toBe("contradicted");
  });

  it("matches single-string debug values against a quoted or bare driver surface", () => {
    expect(
      compareReloadDebugValue({
        propertyKey: "replace_sensor",
        debugValue: '"bat0_raw_temp"',
        readValue: "bat0_raw_temp",
        valueShape: { kind: "string" }
      })
    ).toBe("matched");
    expect(
      compareReloadDebugValue({
        propertyKey: "replace_sensor",
        debugValue: '"bat0_raw_temp"',
        readValue: "bat1_raw_temp",
        valueShape: { kind: "string" }
      })
    ).toBe("contradicted");
  });

  it("reports incomparable when the read-back cannot be coerced into the declared shape", () => {
    expect(
      compareReloadDebugValue({
        propertyKey: "watchdog_time",
        debugValue: "<7000>",
        readValue: "not-a-number",
        valueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 }
      })
    ).toBe("incomparable");
  });

  it("reports incomparable when the expected debug value cannot be parsed", () => {
    expect(
      compareReloadDebugValue({
        propertyKey: "watchdog_time",
        debugValue: "<<<broken",
        readValue: "7000",
        valueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 }
      })
    ).toBe("incomparable");
  });

  it("matches GPIO-style phandle cell arrays by label and integer cells", () => {
    expect(
      compareReloadDebugValue({
        propertyKey: "gpio_int",
        debugValue: "<&gpio13 29 0>",
        readValue: "<&gpio13 0x1d 0>",
        valueShape: { kind: "mixed" }
      })
    ).toBe("matched");
    expect(
      compareReloadDebugValue({
        propertyKey: "gpio_int",
        debugValue: "<&gpio13 29 0>",
        readValue: "<&gpio13 30 0>",
        valueShape: { kind: "phandle-cells", bits: 32, cellsPerGroup: 3 }
      })
    ).toBe("contradicted");
  });

  it("treats bare integer read-back as incomparable for phandle-cells", () => {
    expect(
      compareReloadDebugValue({
        propertyKey: "gpio_int",
        debugValue: "<&gpio13 29 0>",
        readValue: "29 0",
        valueShape: { kind: "mixed" }
      })
    ).toBe("incomparable");
  });

  it("matches /bits/ 8 debug values against square-bracket or bare byte read-back", () => {
    expect(
      compareReloadDebugValue({
        propertyKey: "prevfod1_product_list",
        debugValue: "/bits/ 8 <34>",
        readValue: "[22]",
        valueShape: { kind: "bytes" }
      })
    ).toBe("matched");
    expect(
      compareReloadDebugValue({
        propertyKey: "prevfod1_product_list",
        debugValue: "/bits/ 8 <34>",
        readValue: "17",
        valueShape: { kind: "bytes" }
      })
    ).toBe("contradicted");
  });
});

describe("canonicalizeReloadValue", () => {
  function parsed(propertyKey: string, raw: string) {
    return parseDtsValue(propertyKey, raw).value;
  }

  it("renders 32-bit cells as decimal groups regardless of authored spelling", () => {
    expect(canonicalizeReloadValue(parsed("watchdog_time", "<0x1770>"), "")).toBe("<6000>");
    expect(canonicalizeReloadValue(parsed("combined_para", "<1 2 3>, <4 5 6>"), "")).toBe(
      "<1 2 3> <4 5 6>"
    );
  });

  it("flattens sub-32-bit cell arrays and square-bracket bytes onto one decimal sequence", () => {
    expect(canonicalizeReloadValue(parsed("prevfod1_product_list", "/bits/ 8 <0x22>"), "")).toBe("34");
    expect(canonicalizeReloadValue(parsed("prevfod1_product_list", "[22]"), "")).toBe("34");
    expect(canonicalizeReloadValue(parsed("threshold", "/bits/ 16 <17 18>"), "")).toBe("17 18");
  });

  it("resolves phandle labels through the injected resolver and keeps unresolved labels", () => {
    const value = parsed("gpio_int", "<&gpio13 29 0>");
    expect(canonicalizeReloadValue(value, "", (label) => (label === "gpio13" ? "7" : null))).toBe(
      "<7 29 0>"
    );
    expect(canonicalizeReloadValue(value, "")).toBe("<&gpio13 29 0>");
  });

  it("renders string values as JSON-quoted lists", () => {
    expect(canonicalizeReloadValue(parsed("status", '"okay"'), "")).toBe('"okay"');
    expect(canonicalizeReloadValue(parsed("names", '"a", "b"'), "")).toBe('"a", "b"');
  });

  it("falls back to the trimmed fallback text when the value is missing", () => {
    expect(canonicalizeReloadValue(undefined, "  raw text  ")).toBe("raw text");
  });
});
