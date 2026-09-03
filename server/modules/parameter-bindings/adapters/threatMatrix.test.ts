import { describe, expect, it } from "vitest";

import { THREAT_MATRIX } from "./threatMatrix";

describe("S6-WFA threat matrix", () => {
  it("freezes the required protected-reference adapter rows before production sealing", () => {
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "success-read",
      "success-writeback",
      "parameter-spec-id-fallback-refused",
      "missing-binding-or-current-value",
      "revision-disagreement",
      "cas-source-conflict",
      "catalog-isolation",
    ]);
    for (const row of THREAT_MATRIX) {
      expect(row.initialState.length).toBeGreaterThan(0);
      expect(row.action.length).toBeGreaterThan(0);
      expect(row.expected.length).toBeGreaterThan(0);
      expect(row.leftover.length).toBeGreaterThan(0);
    }
  });
});
