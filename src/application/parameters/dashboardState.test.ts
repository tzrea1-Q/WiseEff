import { describe, expect, it } from "vitest";
import { dashboardReducer, initialDashboardState } from "./dashboardState";

describe("dashboardReducer", () => {
  it("marks summary empty when no data", () => {
    const next = dashboardReducer(initialDashboardState, {
      type: "DASHBOARD_SUMMARY_READY",
      data: {
        window: "30d",
        windowLabel: "近 30 天",
        projectId: null,
        kpis: {
          totalParameters: 0,
          managedProjects: 0,
          changeFrequency: 0,
          activeContributors: 0,
          highRiskParameters: 0
        },
        trend: [],
        riskBuckets: [],
        workbenchSignals: {
          reviewQueue: 0,
          myDrafts: 0,
          returnedChanges: 0,
          waitingMerge: 0,
          unappliedImportBatches: 0,
          inactiveAccounts: 0
        }
      }
    });
    expect(next.summary.status).toBe("empty");
  });

  it("captures summary errors without dropping stale data", () => {
    const next = dashboardReducer(
      { ...initialDashboardState, summary: { status: "ready", data: {} as any, error: null } },
      { type: "DASHBOARD_SUMMARY_ERROR", error: "boom" }
    );
    expect(next.summary.status).toBe("error");
    expect(next.summary.error).toBe("boom");
  });
});
