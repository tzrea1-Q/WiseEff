import { describe, expect, it } from "vitest";

import { THREAT_MATRIX } from "./threatMatrix";

describe("S5-PRP threat matrix", () => {
  it("freezes the required DefinitionProposal rows before production sealing", () => {
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "submit-success",
      "withdraw-proposer-only",
      "distinct-reviewer-accept",
      "stale-base",
      "catalog-isolation",
      "intent-only-publication",
      "lost-response-replay",
    ]);
    for (const row of THREAT_MATRIX) {
      expect(row.initialState.length).toBeGreaterThan(0);
      expect(row.action.length).toBeGreaterThan(0);
      expect(row.expected.length).toBeGreaterThan(0);
      expect(row.leftover.length).toBeGreaterThan(0);
    }
  });
});
