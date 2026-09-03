import { describe, expect, it } from "vitest";

import { assertAllowedPhase } from "./checkpoints";
import {
  PRE_ACTIVATION_PHASES,
  THREAT_MATRIX,
  UNAVAILABLE_PHASES,
} from "./interface";

describe("S7-ORC checkpoints", () => {
  it("freezes seven threat-matrix rows covering plan/execute/inspect/recover", () => {
    expect(THREAT_MATRIX).toHaveLength(7);
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "planned-p0-p10-checkpoints",
      "duplicate-plan-execute-resume",
      "unknown-or-adhoc-phase",
      "rollback-dump-equality",
      "crash-mid-phase-resume",
      "populated-catalog-required",
      "frozen-producer-types-no-release-writer",
    ]);
    expect(PRE_ACTIVATION_PHASES).toEqual([
      "P0",
      "P1",
      "P2",
      "P3",
      "P4",
      "P5",
      "P6",
      "P7",
      "P8",
      "P9",
      "P10",
    ]);
  });

  it("T3 refuses unknown phases and activation P11-P16", () => {
    expect(assertAllowedPhase("P9").ok).toBe(true);
    const unknown = assertAllowedPhase("P99");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe("PCAT-ORC-UNKNOWN-PHASE");
    for (const phase of UNAVAILABLE_PHASES) {
      const refused = assertAllowedPhase(phase);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe("PCAT-ORC-ACTIVATION-UNAVAILABLE");
    }
  });
});
