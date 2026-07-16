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
