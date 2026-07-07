import { describe, expect, it } from "vitest";
import { scoreHotspotGroup, WINDOW_PROFILES } from "./scoring";

describe("hotspot scoring", () => {
  it("is deterministic and sums breakdown", () => {
    const input = {
      parameterCount: 4,
      relatedRequestCount: 3,
      definitionCount: 3,
      logSignalCount: 2,
      highRiskCount: 2,
      riskWeightSum: 12,
      driftSum: 96
    };
    const a = scoreHotspotGroup(input, WINDOW_PROFILES["30d"]);
    const b = scoreHotspotGroup(input, WINDOW_PROFILES["30d"]);
    expect(a).toEqual(b);
    const total = a.frequency + a.risk + a.impact + a.workflow + a.drift;
    expect(a.score).toBeCloseTo(Math.round(total * 10) / 10);
  });
});
