import { describe, expect, it } from "vitest";

import { inferDraftValueShapeFromOccurrence } from "./valueShapeInference";

describe("inferDraftValueShapeFromOccurrence", () => {
  it("infers boolean/presence from empty raw text", () => {
    expect(
      inferDraftValueShapeFromOccurrence({
        propertyKey: "feature-enabled",
        astJson: { kind: "boolean", present: true },
        rawText: "",
      }),
    ).toEqual({ kind: "bool" });
  });

  it("infers string from a single quoted value", () => {
    expect(
      inferDraftValueShapeFromOccurrence({
        propertyKey: "label",
        astJson: { kind: "strings", values: ["alpha"], items: [{ value: "alpha", raw: '"alpha"' }] },
        rawText: '"alpha"',
      }),
    ).toEqual({ kind: "string" });
  });

  it("infers string-list from multiple quoted values", () => {
    expect(
      inferDraftValueShapeFromOccurrence({
        propertyKey: "compatible",
        astJson: {
          kind: "strings",
          values: ["a", "b"],
          items: [
            { value: "a", raw: '"a"' },
            { value: "b", raw: '"b"' },
          ],
        },
        rawText: '"a", "b"',
      }),
    ).toEqual({ kind: "string-list" });
  });

  it("infers cells with bits and group counts", () => {
    expect(
      inferDraftValueShapeFromOccurrence({
        propertyKey: "gpio_int",
        astJson: {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "1", value: "1" }]],
        },
        rawText: "<1>",
      }),
    ).toEqual({ kind: "cells", bits: 32, groups: 1, cellsPerGroup: 1 });
  });

  it("preserves gpio phandle-array bits, groups, and three cells per group", () => {
    expect(
      inferDraftValueShapeFromOccurrence({
        propertyKey: "gpio_int",
        astJson: {
          kind: "cells",
          bits: 32,
          groups: [[
            { kind: "phandle", label: "gpio13" },
            { kind: "integer", raw: "29", value: "29" },
            { kind: "integer", raw: "0", value: "0" },
          ]],
        },
        rawText: "<&gpio13 29 0>",
      }),
    ).toEqual({ kind: "phandle-list", bits: 32, groups: 1, cellsPerGroup: 3 });
  });

  it("preserves multi-group cell-array structure", () => {
    expect(
      inferDraftValueShapeFromOccurrence({
        propertyKey: "ranges",
        astJson: {
          kind: "cells",
          bits: 8,
          groups: [
            [{ kind: "integer", raw: "1", value: "1" }],
            [{ kind: "integer", raw: "2", value: "2" }],
          ],
        },
        rawText: "/bits/ 8 <1>, <2>",
      }),
    ).toEqual({ kind: "cells", bits: 8, groups: 2, cellsPerGroup: 1 });
  });

  it("marks unequal cell groups unknown instead of guessing one group width", () => {
    expect(
      inferDraftValueShapeFromOccurrence({
        propertyKey: "broken-groups",
        astJson: {
          kind: "cells",
          bits: 32,
          groups: [
            [{ kind: "integer", raw: "1", value: "1" }],
            [
              { kind: "integer", raw: "2", value: "2" },
              { kind: "integer", raw: "3", value: "3" },
            ],
          ],
        },
        rawText: "<1>, <2 3>",
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("infers bytes from bracket literals", () => {
    expect(
      inferDraftValueShapeFromOccurrence({
        propertyKey: "data",
        astJson: { kind: "bytes", values: [1, 2, 3] },
        rawText: "[01 02 03]",
      }),
    ).toEqual({ kind: "bytes", length: 3 });
  });

  it("infers mixed from heterogeneous segments", () => {
    expect(
      inferDraftValueShapeFromOccurrence({
        propertyKey: "combo",
        astJson: {
          kind: "mixed",
          segments: [
            { kind: "string", raw: '"x"', value: "x" },
            { kind: "cells", bits: 32, cells: [{ kind: "integer", raw: "1", value: "1" }] },
          ],
        },
        rawText: '"x",<1>',
      }),
    ).toEqual({ kind: "mixed" });
  });

  it("returns unknown when AST cannot be parsed", () => {
    expect(
      inferDraftValueShapeFromOccurrence({
        propertyKey: "broken",
        astJson: null,
        rawText: "not-dts",
      }),
    ).toEqual({ kind: "unknown" });
  });
});
