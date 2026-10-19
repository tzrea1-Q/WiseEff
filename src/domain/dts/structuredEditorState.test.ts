import { describe, expect, it } from "vitest";

import { readStructuredEditorState, sameStructuredEditorState } from "./structuredEditorState";

describe("structuredEditorState", () => {
  it("keeps unfinished tokens and group positions in an independent copy", () => {
    const state = { kind: "cells", bits: 32, groups: [["", "-", "0x"], ["7"]] };
    const parsed = readStructuredEditorState(state);
    expect(parsed).toEqual(state);
    state.groups[0]![0] = "changed";
    expect(parsed?.kind === "cells" && parsed.groups[0]).toEqual(["", "-", "0x"]);
  });

  it.each([
    null,
    { kind: "strings", bits: 32, groups: [[""]] },
    { kind: "cells", bits: 24, groups: [[""]] },
    { kind: "cells", bits: 32, groups: [""] },
    { kind: "cells", bits: 32, groups: [[1]] },
    { kind: "cells", bits: 32, groups: [new Array<string>(1)] },
    { kind: "cells", bits: 32, groups: [] },
    { kind: "cells", bits: 32, groups: [[""]], extra: true },
    { kind: "string-input", format: "dts", text: "first" },
    { kind: "string-input", format: "lines", text: ["first"] },
    { kind: "string-input", format: "lines", text: "first", groups: [] },
    { kind: "numeric-input", text: 12, source: { kind: "cells", bits: 32, groups: [[""]] } },
    { kind: "numeric-input", text: "0x", source: { kind: "cells", bits: 24, groups: [[""]] } },
    { kind: "numeric-input", text: "0x", source: { kind: "string-input", format: "lines", text: "first" } },
    { kind: "numeric-input", text: "0x", source: { kind: "cells", bits: 32, groups: [[""]] }, format: "lines" },
    { kind: "numeric-input", text: "0x", source: { kind: "cells", bits: 32, groups: [[""]] }, format: "table", extra: true },
    { kind: "numeric-input", text: "0x", source: { kind: "cells", bits: 32, groups: [[""]] }, extra: true }
  ])("rejects malformed stored state %#", (state) => {
    expect(readStructuredEditorState(state)).toBeNull();
  });

  it("compares token positions as well as serialized values", () => {
    expect(sameStructuredEditorState(undefined, undefined)).toBe(true);
    expect(sameStructuredEditorState(undefined, { kind: "cells", bits: 32, groups: [[""]] })).toBe(false);
    expect(sameStructuredEditorState(
      { kind: "cells", bits: 32, groups: [["", "1"]] },
      { kind: "cells", bits: 32, groups: [["1", ""]] }
    )).toBe(false);
  });

  it("reads and compares unconfirmed string input without normalizing whitespace", () => {
    const state = { kind: "string-input" as const, format: "lines" as const, text: " first\n\nlast\n" };
    const parsed = readStructuredEditorState(state);
    expect(parsed).toEqual(state);
    expect(sameStructuredEditorState(parsed ?? undefined, { ...state })).toBe(true);
    expect(sameStructuredEditorState(parsed ?? undefined, { ...state, text: "first\nlast" })).toBe(false);
    expect(sameStructuredEditorState(parsed ?? undefined, { kind: "cells", bits: 32, groups: [[""]] })).toBe(false);
  });

  it("clones unconfirmed numeric input and compares its prior groups", () => {
    const state = { kind: "numeric-input" as const, text: "1\t2\n0x", source: {
      kind: "cells" as const, bits: 32 as const, groups: [["", "0"], ["-"]]
    } };
    const parsed = readStructuredEditorState(state);
    expect(parsed).toEqual(state);
    expect(sameStructuredEditorState(parsed ?? undefined, state)).toBe(true);
    state.source.groups[0]![0] = "mutated";
    expect(sameStructuredEditorState(parsed ?? undefined, state)).toBe(false);
    expect(parsed?.kind === "numeric-input" && parsed.source.groups).toEqual([["", "0"], ["-"]]);
  });

  it("preserves table format and treats missing numeric format as DTS", () => {
    const state = { kind: "numeric-input" as const, text: "1\t\t3\n4\t5", source: {
      kind: "cells" as const, bits: 32 as const, groups: [["0"]]
    } };
    const table = readStructuredEditorState({ ...state, format: "table" });
    expect(table).toEqual({ ...state, format: "table" });
    expect(sameStructuredEditorState(state, { ...state, format: "dts" })).toBe(true);
    expect(sameStructuredEditorState(state, table ?? undefined)).toBe(false);
  });
});
