import { describe, expect, it } from "vitest";
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

  it("derives personal kpis from current user history in window", async () => {
    const state = createMockRuntimeState();
    const user = state.current.users.find((entry) => entry.id === state.current.currentUserId);
    expect(user).toBeDefined();
    const [parameter] = state.current.parameters;
    state.current.parameters[0] = {
      ...parameter,
      history: [
        {
          version: "v9.9.9",
          value: "42",
          changedAt: new Date().toISOString(),
          changedBy: user!.name
        },
        ...parameter.history
      ]
    };
    const repo = createMockParameterDashboardRepository(() => state.current);
    const summary = await repo.listDashboardSummary({ window: "30d" });
    expect(summary.personalKpis.contributionCount).toBeGreaterThan(0);
    expect(summary.personalTrend.length).toBe(30);
  });

  it("ranks hotspots deterministically", async () => {
    const state = createMockRuntimeState();
    const repo = createMockParameterDashboardRepository(() => state.current);
    const hotspots = await repo.listDashboardHotspots({ window: "30d", dimension: "project" });
    expect(hotspots.length).toBeGreaterThan(0);
    expect(hotspots[0].score).toBeGreaterThanOrEqual(hotspots[hotspots.length - 1].score);
  });

  it("returns parameter hotspots with project-scope behavioral breakdown", async () => {
    const state = createMockRuntimeState();
    const repo = createMockParameterDashboardRepository(() => state.current);
    const hotspots = await repo.listDashboardHotspots({ window: "30d", dimension: "parameter" });
    expect(hotspots.length).toBeGreaterThan(0);
    expect(Object.keys(hotspots[0].scoreBreakdown)).toEqual(["frequency", "scope", "workflow", "collaboration"]);
    expect(hotspots[0].evidence[0]).toMatch(/个项目中修改/);
  });

});
