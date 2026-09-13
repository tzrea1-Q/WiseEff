import { describe, expect, it } from "vitest";

import { catalogPublicationRouteIds } from "./mapping";
import { THREAT_MATRIX } from "./threatMatrix";

describe("CP-07 publication threat matrix", () => {
  it("covers idempotency, fencing, recovery, scope, agent, and policy rows", () => {
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([
      "T04.a",
      "T04.b",
      "T04.c",
      "T04.d",
      "T12.a",
      "T05",
      "T08",
      "T10",
      "T11",
      "T25",
      "AUTH.z",
      "SCOPE.z",
      "AGENT.z",
      "POLICY.z",
    ]);
    expect(Object.isFrozen(THREAT_MATRIX)).toBe(true);
    for (const row of THREAT_MATRIX) {
      expect(row.initialState.length).toBeGreaterThan(0);
      expect(row.action.length).toBeGreaterThan(0);
      expect(row.expected.length).toBeGreaterThan(0);
      expect(row.leftover.length).toBeGreaterThan(0);
    }
    expect(catalogPublicationRouteIds).toHaveLength(4);
  });
});
