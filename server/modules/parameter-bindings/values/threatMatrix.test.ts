import { describe, expect, it } from "vitest";

import { THREAT_MATRIX } from "./threatMatrix";

describe("S6-VAL threat matrix", () => {
  it("freezes the required ProjectValue history rows before production sealing", () => {
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "append-success",
      "stale-tip-lost-update",
      "in-place-mutation-refused",
      "history-completeness",
      "cas-race",
      "source-ownership",
      "audit-continuity",
      "replay",
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
