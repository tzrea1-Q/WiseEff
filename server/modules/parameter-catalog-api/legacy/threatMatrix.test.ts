import { describe, expect, it } from "vitest";

import { THREAT_MATRIX } from "./threatMatrix";

describe("S8-LEG threat matrix", () => {
  it("freezes the R3 allow-list exact outcomes before production sealing", () => {
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "exact-mapped-lookup",
      "archived-gone-no-payload",
      "blocked-or-ambiguous-conflict",
      "unknown-or-unauthorized-not-found",
      "inference-and-search-refused",
      "reverse-mapping-refused",
      "raw-archive-refused",
      "structural-write-retired",
      "eligible-read-headers",
      "governance-raw-retired",
      "spoof-and-agent-readonly",
      "no-p12-p15-activation",
    ]);
    for (const row of THREAT_MATRIX) {
      expect(row.initialState.length).toBeGreaterThan(0);
      expect(row.action.length).toBeGreaterThan(0);
      expect(row.expected.length).toBeGreaterThan(0);
      expect(row.leftover.length).toBeGreaterThan(0);
    }
    expect(Object.isFrozen(THREAT_MATRIX)).toBe(true);
  });
});
