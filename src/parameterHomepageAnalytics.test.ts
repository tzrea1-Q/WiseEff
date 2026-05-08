import { describe, expect, it } from "vitest";
import { deriveParameterHomepageAnalytics } from "./parameterHomepageAnalytics";
import { initialState, type RequestStatus } from "./mockData";

describe("parameter homepage analytics", () => {
  it("derives manager dashboard metrics from the prototype state", () => {
    const analytics = deriveParameterHomepageAnalytics(initialState, "30d");

    expect(analytics.timeWindowLabel).toBe("近 30 天");
    expect(analytics.summary.totalParameters).toBe(30);
    expect(analytics.summary.parameterDefinitions).toBe(10);
    expect(analytics.summary.debugParameters).toBe(8);
    expect(analytics.summary.highRiskParameters).toBe(12);
    expect(analytics.summary.changeEvents).toBeGreaterThanOrEqual(initialState.changeRequests.length);
    expect(analytics.flowHealth.reviewQueue).toBe(initialState.changeRequests.length);
    expect(analytics.entryCards.map((entry) => entry.path)).toEqual([
      "/parameters",
      "/parameter-comparison",
      "/parameter-review",
      "/parameter-admin"
    ]);
    expect(analytics.entryCards.find((entry) => entry.path === "/parameter-review")?.title).toBe("参数合入审核");
  });

  it("ranks AI hotspots with explainable score dimensions", () => {
    const analytics = deriveParameterHomepageAnalytics(initialState, "30d");

    expect(analytics.hotspots.length).toBeGreaterThanOrEqual(3);
    analytics.hotspots.slice(1).forEach((hotspot, index) => {
      expect(analytics.hotspots[index].score).toBeGreaterThanOrEqual(hotspot.score);
    });
    analytics.hotspots.forEach((hotspot) => {
      expect(hotspot.score).toBe(
        hotspot.scoreBreakdown.frequency +
          hotspot.scoreBreakdown.risk +
          hotspot.scoreBreakdown.impact +
          hotspot.scoreBreakdown.workflow +
          hotspot.scoreBreakdown.drift
      );
    });
    expect(analytics.hotspots[0].scoreBreakdown).toEqual(
      expect.objectContaining({
        frequency: expect.any(Number),
        risk: expect.any(Number),
        impact: expect.any(Number),
        workflow: expect.any(Number),
        drift: expect.any(Number)
      })
    );
    expect(analytics.aiSummary.body).toBe("系统按变更频次、风险权重、影响范围、流程堆积与异常偏离识别参数管理优先级。");
    expect(analytics.aiSummary.body).not.toContain(analytics.timeWindowLabel);
    expect(analytics.hotspots[0].explanation).toContain("近 30 天");
    expect(analytics.hotspots[0].suggestedPath).toMatch(/^\/(parameters|parameter-comparison|parameter-review|parameter-admin)/);
  });

  it("returns key parameter changes sorted by drift and risk", () => {
    const analytics = deriveParameterHomepageAnalytics(initialState, "30d");

    expect(analytics.keyChanges).toHaveLength(4);
    expect(analytics.keyChanges[0]).toEqual(
      expect.objectContaining({
        parameterName: expect.any(String),
        projectCode: expect.any(String),
        currentValue: expect.any(String),
        recommendedValue: expect.any(String),
        risk: expect.stringMatching(/High|Medium|Low/),
        suggestedPath: expect.stringContaining("/parameters")
      })
    );
    analytics.keyChanges.slice(1).forEach((change, index) => {
      const previous = analytics.keyChanges[index];
      const previousRisk = riskPriority[previous.risk];
      const currentRisk = riskPriority[change.risk];

      expect(previousRisk).toBeGreaterThanOrEqual(currentRisk);
      if (previousRisk === currentRisk) {
        expect(readDrift(previous.driftLabel)).toBeGreaterThanOrEqual(readDrift(change.driftLabel));
      }
    });
  });

  it("counts explicit workflow status buckets regardless of request order", () => {
    const [baseRequest] = initialState.changeRequests;
    const reorderedState = {
      ...initialState,
      changeRequests: [
        { ...baseRequest, id: "PRQ-merged", status: requestStatuses.merged },
        { ...baseRequest, id: "PRQ-auto", status: requestStatuses.autoChecked },
        { ...baseRequest, id: "PRQ-rejected", status: requestStatuses.rejected },
        { ...baseRequest, id: "PRQ-review", status: requestStatuses.reviewPending },
        { ...baseRequest, id: "PRQ-waiting", status: requestStatuses.waitingMerge },
        { ...baseRequest, id: "PRQ-review-2", status: requestStatuses.reviewPending }
      ]
    };

    const analytics = deriveParameterHomepageAnalytics(reorderedState, "30d");

    expect(analytics.flowHealth.reviewQueue).toBe(6);
    expect(analytics.flowHealth.autoChecked).toBe(1);
    expect(analytics.flowHealth.waitingMerge).toBe(1);
    expect(analytics.flowHealth.merged).toBe(1);
    expect(analytics.flowHealth.needsHumanConfirmation).toBe(5);
  });

  it("keeps alternate time windows explicit for the UI", () => {
    expect(deriveParameterHomepageAnalytics(initialState, "7d").timeWindowLabel).toBe("近 7 天");
    expect(deriveParameterHomepageAnalytics(initialState, "180d").timeWindowLabel).toBe("近 180 天");
  });

  it("changes metric and priority outputs across time windows", () => {
    const sevenDays = deriveParameterHomepageAnalytics(initialState, "7d");
    const thirtyDays = deriveParameterHomepageAnalytics(initialState, "30d");
    const oneHundredEightyDays = deriveParameterHomepageAnalytics(initialState, "180d");

    expect(sevenDays.summary.changeEvents).not.toBe(thirtyDays.summary.changeEvents);
    expect(oneHundredEightyDays.summary.changeEvents).not.toBe(thirtyDays.summary.changeEvents);
    expect(sevenDays.hotspots.map((hotspot) => hotspot.score)).not.toEqual(thirtyDays.hotspots.map((hotspot) => hotspot.score));
    expect(oneHundredEightyDays.hotspots.length).toBeGreaterThanOrEqual(thirtyDays.hotspots.length);
    expect(sevenDays.keyChanges.map((change) => change.id)).not.toEqual(oneHundredEightyDays.keyChanges.map((change) => change.id));
  });

  it("aggregates hotspots by module or project dimension", () => {
    const moduleAnalytics = deriveParameterHomepageAnalytics(initialState, "30d", "module");
    const projectAnalytics = deriveParameterHomepageAnalytics(initialState, "30d", "project");

    expect(moduleAnalytics.hotspotDimension).toBe("module");
    expect(moduleAnalytics.hotspots[0].title).not.toContain("·");
    expect(moduleAnalytics.hotspots.map((hotspot) => hotspot.title)).toContain("Charging Policy");
    expect(moduleAnalytics.hotspots.every((hotspot) => hotspot.suggestedPath.includes("module="))).toBe(true);

    expect(projectAnalytics.hotspotDimension).toBe("project");
    expect(projectAnalytics.hotspots.map((hotspot) => hotspot.title)).toEqual(expect.arrayContaining(["AUR-Prod", "NEB-RD", "ATL-Intl"]));
    expect(projectAnalytics.hotspots.every((hotspot) => hotspot.suggestedPath.includes("project="))).toBe(true);
  });
});

const riskPriority = {
  High: 3,
  Medium: 2,
  Low: 1
};

const requestStatuses = {
  reviewPending: "待审阅",
  autoChecked: "自动检查通过",
  waitingMerge: "等待合入",
  merged: "已合入",
  rejected: "已打回"
} satisfies Record<string, RequestStatus>;

function readDrift(driftLabel: string) {
  return Number.parseFloat(driftLabel);
}
