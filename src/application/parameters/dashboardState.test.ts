import { describe, expect, it } from "vitest";
import { dashboardReducer, initialDashboardState } from "./dashboardState";

describe("dashboardReducer", () => {
  it("keeps a true zero summary ready", () => {
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
          highRiskParameters: null,
          riskAvailability: "unavailable"
        },
        trend: [],
        personalKpis: {
          contributionCount: 0,
          workflowCount: 0,
          openItemCount: 0,
          pendingTodoCount: 0,
          highRiskTouchCount: null,
          riskAvailability: "unavailable"
        },
        personalTrend: [],
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
    expect(next.summary.status).toBe("ready");
  });

  it("captures summary errors without dropping stale data", () => {
    const next = dashboardReducer(
      { ...initialDashboardState, summary: { status: "ready", data: {} as any, error: null } },
      { type: "DASHBOARD_SUMMARY_ERROR", error: "boom" }
    );
    expect(next.summary.status).toBe("error");
    expect(next.summary.error).toBe("boom");
  });

  it("sets overview scope via DASHBOARD_SET_OVERVIEW_SCOPE", () => {
    const next = dashboardReducer(initialDashboardState, {
      type: "DASHBOARD_SET_OVERVIEW_SCOPE",
      scope: "overall"
    });
    expect(next.overviewScope).toBe("overall");
  });

  it("keeps summary ready when personal activity is truly zero", () => {
    const next = dashboardReducer(
      { ...initialDashboardState, overviewScope: "personal" },
      {
        type: "DASHBOARD_SUMMARY_READY",
        data: {
          window: "30d",
          windowLabel: "近 30 天",
          projectId: null,
          kpis: {
            totalParameters: 51,
            managedProjects: 3,
            changeFrequency: 19,
            activeContributors: 5,
            highRiskParameters: 12
          },
          trend: [{ bucketStart: "2026-07-01T00:00:00Z", label: "7/1", changeCount: 3, workflowEventCount: 1 }],
          personalKpis: {
            contributionCount: 0,
            workflowCount: 0,
            openItemCount: 0,
            pendingTodoCount: 0,
            highRiskTouchCount: 0
          },
          personalTrend: [],
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
      }
    );
    expect(next.summary.status).toBe("ready");
  });

  it("keeps loaded data ready when switching overview scope", () => {
    const loaded = dashboardReducer(
      { ...initialDashboardState, overviewScope: "personal", summary: { status: "ready", data: {} as any, error: null } },
      { type: "DASHBOARD_SET_OVERVIEW_SCOPE", scope: "overall" }
    );
    expect(loaded.overviewScope).toBe("overall");
    expect(loaded.summary.status).toBe("ready");
  });

  it("marks summary ready for overall scope when overall kpis are non-zero", () => {
    const next = dashboardReducer(
      { ...initialDashboardState, overviewScope: "overall" },
      {
        type: "DASHBOARD_SUMMARY_READY",
        data: {
          window: "30d",
          windowLabel: "近 30 天",
          projectId: null,
          kpis: {
            totalParameters: 51,
            managedProjects: 3,
            changeFrequency: 19,
            activeContributors: 5,
            highRiskParameters: 12
          },
          trend: [{ bucketStart: "2026-07-01T00:00:00Z", label: "7/1", changeCount: 3, workflowEventCount: 1 }],
          personalKpis: {
            contributionCount: 0,
            workflowCount: 0,
            openItemCount: 0,
            pendingTodoCount: 0,
            highRiskTouchCount: 0
          },
          personalTrend: [],
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
      }
    );
    expect(next.summary.status).toBe("ready");
  });
});
