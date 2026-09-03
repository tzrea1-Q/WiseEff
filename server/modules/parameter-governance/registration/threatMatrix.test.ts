import { describe, expect, it } from "vitest";

import { THREAT_MATRIX } from "./threatMatrix";

describe("S4-REG threat matrix", () => {
  it("freezes the required Registration/Placement rows before production sealing", () => {
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "register-success",
      "catalog-isolation",
      "double-placement",
      "stale-pin",
      "retired-membership",
      "shared-vs-exclusive",
      "lost-response-replay",
      "auto-restore-forbidden",
      "writer-rollback",
      "fingerprint-conflict",
    ]);
    for (const row of THREAT_MATRIX) {
      expect(row.initialState.length).toBeGreaterThan(0);
      expect(row.action.length).toBeGreaterThan(0);
      expect(row.expected.length).toBeGreaterThan(0);
      expect(row.leftover.length).toBeGreaterThan(0);
    }
  });
});
