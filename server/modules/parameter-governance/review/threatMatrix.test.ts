import { describe, expect, it } from "vitest";

import { THREAT_MATRIX } from "./threatMatrix";

describe("S4-REV threat matrix", () => {
  it("freezes authorization, grouping, stale-pin, redaction, and ETag rows before production sealing", () => {
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "authorized-group-once",
      "unauthorized-scope",
      "stale-captured-pin",
      "raw-evidence-redaction",
      "etag-stability",
      "no-forbidden-writes",
      "query-replay",
    ]);
    for (const row of THREAT_MATRIX) {
      expect(row.initialState.length).toBeGreaterThan(0);
      expect(row.action.length).toBeGreaterThan(0);
      expect(row.expected.length).toBeGreaterThan(0);
      expect(row.leftover.length).toBeGreaterThan(0);
    }
  });
});
