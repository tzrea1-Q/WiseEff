import { describe, expect, it } from "vitest";

import {
  inferCellFieldsFromExample,
  shapeStateForNewKind,
  shapeStateFromValue,
  valueFromShapeState,
} from "./valueShapeEditor";

describe("valueShapeEditor round-trip", () => {
  it("does not invent missing cell fields when reading an incomplete shape (SE-23)", () => {
    const state = shapeStateFromValue({ kind: "u32-array" });
    expect(state).toEqual({
      kind: "u32-array",
      bits: null,
      groups: null,
      cellsPerGroup: null,
      bytesLength: null,
    });
    expect(valueFromShapeState(state, "edit")).toEqual({ kind: "u32-array" });
  });

  it("preserves stored cell fields in edit mode", () => {
    const state = shapeStateFromValue({
      kind: "cells",
      bits: 16,
      groups: 2,
      cellsPerGroup: 3,
    });
    expect(valueFromShapeState(state, "edit")).toEqual({
      kind: "cells",
      bits: 16,
      groups: 2,
      cellsPerGroup: 3,
    });
  });

  it("fills create-mode bits but leaves the column width undecided for cell kinds", () => {
    expect(valueFromShapeState(shapeStateForNewKind("phandle-list"), "create")).toEqual({
      kind: "phandle-list",
      bits: 32,
    });
  });

  it("emits a create-mode column width once one is known", () => {
    expect(
      valueFromShapeState({ ...shapeStateForNewKind("cells"), cellsPerGroup: 3 }, "create"),
    ).toEqual({ kind: "cells", bits: 32, cellsPerGroup: 3 });
  });

  it("keeps a stored row count without exposing it for editing", () => {
    const state = shapeStateFromValue({ kind: "cells", bits: 32, groups: 4, cellsPerGroup: 3 });
    expect(state.groups).toBe(4);
    expect(valueFromShapeState(state, "edit")).toEqual({
      kind: "cells",
      bits: 32,
      groups: 4,
      cellsPerGroup: 3,
    });
  });

  it("drops the column width when the operator clears it", () => {
    const state = shapeStateFromValue({ kind: "cells", bits: 32, cellsPerGroup: 3 });
    expect(valueFromShapeState({ ...state, cellsPerGroup: null }, "edit")).toEqual({
      kind: "cells",
      bits: 32,
    });
  });

  it("omits length for incomplete bytes shapes in edit mode", () => {
    const state = shapeStateFromValue({ kind: "bytes" });
    expect(valueFromShapeState(state, "edit")).toEqual({ kind: "bytes" });
  });
});

describe("inferCellFieldsFromExample", () => {
  it("infers gpio_int three-cell layout from DTS example", () => {
    expect(inferCellFieldsFromExample("<&gpio13 29 0>", "gpio_int")).toEqual({
      ok: true,
      bits: 32,
      cellsPerGroup: 3,
    });
  });

  it("reads the column width from a multi-group example without reporting a row count", () => {
    expect(inferCellFieldsFromExample("<1 2>, <3 4>", "combined")).toEqual({
      ok: true,
      bits: 32,
      cellsPerGroup: 2,
    });
  });

  it("gives the same column width however many rows the example has", () => {
    const threeRows = inferCellFieldsFromExample("<16 100 100>, <6 15 100>, <0 5 100>", "ranges");
    const oneRow = inferCellFieldsFromExample("<16 100 100>", "ranges");
    expect(threeRows).toEqual({ ok: true, bits: 32, cellsPerGroup: 3 });
    expect(oneRow).toEqual(threeRows);
  });

  it("infers from a JSON array", () => {
    expect(inferCellFieldsFromExample("[10, 20, 30, 40]")).toEqual({
      ok: true,
      bits: 32,
      cellsPerGroup: 4,
    });
  });

  it("rejects an empty example", () => {
    expect(inferCellFieldsFromExample("   ").ok).toBe(false);
  });

  it("refuses to guess a width when the example groups disagree", () => {
    const result = inferCellFieldsFromExample("<1 2>, <3 4 5>", "ragged");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/列宽不约束/);
  });
});
