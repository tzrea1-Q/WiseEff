import { describe, expect, it } from "vitest";

import { THREAT_MATRIX } from "./threatMatrix";

describe("S10-DCP threat matrix", () => {
  it("freezes the R3 observations before corpus aggregation", () => {
    expect(THREAT_MATRIX).toHaveLength(8);
    expect(Object.isFrozen(THREAT_MATRIX)).toBe(true);
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "missing-family-registration",
      "duplicate-family-registration",
      "unknown-family-or-comparison-id",
      "checksum-or-canonical-order-drift",
      "sampled-populated-inventory",
      "reused-pre-activation-after-p13",
      "fresh-phase-without-real-postgres-zero-inventory",
      "unexplained-or-unqueryable-nonzero",
    ]);
  });
});
