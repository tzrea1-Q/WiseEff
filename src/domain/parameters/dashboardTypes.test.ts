import { describe, expect, it } from "vitest";
import type { DashboardSummary, DashboardHotspot } from "./dashboardTypes";

describe("dashboard types", () => {
  it("summary carries all sections", () => {
    const summary: DashboardSummary = {
      window: "30d",
      windowLabel: "近 30 天",
      projectId: null,
      kpis: { totalParameters: 0, managedProjects: 0, changeFrequency: 0, activeContributors: 0, highRiskParameters: 0 },
      trend: [],
      personalKpis: {
        contributionCount: 0,
        workflowCount: 0,
        openItemCount: 0,
        pendingTodoCount: 0,
        highRiskTouchCount: 0
      },
      personalTrend: [],
      riskBuckets: [],
      workbenchSignals: { reviewQueue: 0, myDrafts: 0, returnedChanges: 0, waitingMerge: 0, unappliedImportBatches: 0, inactiveAccounts: 0 }
    };
    expect(summary.window).toBe("30d");
  });

  it("hotspot carries legacy score breakdown", () => {
    const hotspot: DashboardHotspot = {
      id: "module:charging",
      kind: "module",
      title: "Charging Policy",
      projectCode: "3 个项目",
      module: "Charging Policy",
      statusLabel: "需要关注",
      statusLevel: "watch",
      score: 100,
      scoreBreakdown: { frequency: 20, risk: 20, impact: 20, workflow: 20, drift: 20 },
      evidence: [],
      trendDelta: 0,
      trendDirection: "flat",
      suggestedPath: "/parameters?module=Charging%20Policy"
    };
    expect(hotspot.scoreBreakdown.frequency).toBe(20);
  });

  it("project hotspot carries behavioral score breakdown", () => {
    const hotspot: DashboardHotspot = {
      id: "project:aurora",
      kind: "project",
      title: "AUR-Prod",
      projectCode: "AUR-Prod",
      module: "项目参数",
      statusLabel: "需要关注",
      statusLevel: "watch",
      score: 100,
      scoreBreakdown: { frequency: 20, scope: 20, workflow: 20, collaboration: 20 },
      evidence: [],
      trendDelta: 0,
      trendDirection: "flat",
      suggestedPath: "/parameters?project=aurora"
    };
    expect("scope" in hotspot.scoreBreakdown).toBe(true);
  });
});
