import { describe, expect, it } from "vitest";
import { THREAT_MATRIX } from "./threatMatrix";

describe("S10-PER threat matrix", () => {
  it("freezes the ten R3 observations before production persistence", () => {
    expect(THREAT_MATRIX).toHaveLength(10);
    expect(Object.isFrozen(THREAT_MATRIX)).toBe(true);
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "prepare-success-pins-purpose-and-lineage",
      "prepare-refuses-caller-waiver-or-gate-list",
      "run-missing-applicable-gate-never-waived",
      "assemble-incomplete-attempt-refuses-half-report",
      "approve-wrong-principal-or-purpose-refused",
      "second-approve-append-only-conflict",
      "read-report-missing-or-unapproved-tagged-absence",
      "concurrent-prepare-or-run-same-purpose-conflict",
      "migration-apply-and-rollback-on-fresh-pgvector",
      "sql-omits-legacy-identity-token",
    ]);
  });
});
