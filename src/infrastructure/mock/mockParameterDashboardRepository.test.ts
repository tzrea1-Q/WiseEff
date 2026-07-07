import { describe, expect, it } from "vitest";
import { scoreHotspotGroup, WINDOW_PROFILES } from "@/domain/parameters/hotspotScoring";
import { createMockRuntimeState } from "./mockState";
import { createMockParameterDashboardRepository } from "./mockParameterDashboardRepository";

describe("mock parameter dashboard repository", () => {
  it("derives summary from mock state without randomness", async () => {
    const state = createMockRuntimeState();
    const repo = createMockParameterDashboardRepository(() => state.current);
    const a = await repo.listDashboardSummary({ window: "30d" });
    const b = await repo.listDashboardSummary({ window: "30d" });
    expect(a).toEqual(b);
    expect(a.kpis.totalParameters).toBe(state.current.parameters.length);
    expect(a.trend.length).toBe(30);
  });

  it("ranks hotspots deterministically", async () => {
    const state = createMockRuntimeState();
    const repo = createMockParameterDashboardRepository(() => state.current);
    const hotspots = await repo.listDashboardHotspots({ window: "30d", dimension: "project" });
    expect(hotspots.length).toBeGreaterThan(0);
    expect(hotspots[0].score).toBeGreaterThanOrEqual(hotspots[hotspots.length - 1].score);
  });

  it("matches shared scorer output for a fixed fixture input", () => {
    const input = {
      parameterCount: 4,
      relatedRequestCount: 3,
      definitionCount: 3,
      logSignalCount: 2,
      highRiskCount: 2,
      riskWeightSum: 12,
      driftSum: 96
    };
    const scored = scoreHotspotGroup(input, WINDOW_PROFILES["30d"]);
    expect(scored.score).toBeCloseTo(
      Math.round((scored.frequency + scored.risk + scored.impact + scored.workflow + scored.drift) * 10) / 10
    );
  });
});
