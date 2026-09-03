import { describe, expect, it } from "vitest";

import { catalogGovernanceRouteIds } from "./mapping";
import { THREAT_MATRIX } from "./threatMatrix";

describe("S8-GOV threat matrix", () => {
  it("covers tx handle, multiwriter, spoof, partial write, missing ETag, and private S4-REG import", () => {
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "tx-handle",
      "multiwriter",
      "spoof-principal",
      "partial-write",
      "missing-etag-idempotency",
      "private-s4-reg-import",
      "pcat-api-04-registration-placement",
      "pcat-api-05-review-observation",
      "pcat-api-06-proposal",
      "pcat-api-07-not-legacy-lookup",
    ]);
    expect(Object.isFrozen(THREAT_MATRIX)).toBe(true);
    for (const row of THREAT_MATRIX) {
      expect(row.initialState.length).toBeGreaterThan(0);
      expect(row.action.length).toBeGreaterThan(0);
      expect(row.expected.length).toBeGreaterThan(0);
      expect(row.leftover.length).toBeGreaterThan(0);
    }
    expect(catalogGovernanceRouteIds).toHaveLength(19);
  });
});
