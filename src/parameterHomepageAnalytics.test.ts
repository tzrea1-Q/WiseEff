import { describe, expect, it } from "vitest";
import {
  deriveParameterHomepageAnalytics,
  deriveProjectRiskDistribution,
  deriveUpdateTrendSeries,
  generateOpsHeadline
} from "./parameterHomepageAnalytics";
import { initialState, type RequestStatus } from "./mockData";

describe("parameter homepage analytics", () => {
  it("derives manager dashboard metrics from the prototype state", () => {
    const analytics = deriveParameterHomepageAnalytics(initialState, "30d");

    expect(analytics.timeWindowLabel).toBe("近 30 天");
    expect(analytics.hotspotDimension).toBe("overall");
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
    expect(analytics.hotspots[0].explanation).toContain("近 30 天");
    expect(analytics.hotspots[0].suggestedPath).toMatch(/^\/(parameters|parameter-comparison|parameter-review|parameter-admin)/);
  });

  it("injects hotspot presentation metadata for leaderboard rendering", () => {
    const analytics = deriveParameterHomepageAnalytics(initialState, "30d");
    const sevenDays = deriveParameterHomepageAnalytics(initialState, "7d");

    expect(analytics.hotspots.length).toBeGreaterThan(0);
    analytics.hotspots.forEach((hotspot) => {
      expect(["alert", "watch", "healthy"]).toContain(hotspot.statusLevel);
      expect(["up", "down", "flat"]).toContain(hotspot.trend.direction);
      expect(hotspot.trend.delta).toBeGreaterThanOrEqual(-25);
      expect(hotspot.trend.delta).toBeLessThanOrEqual(25);
    });
    expect(analytics.hotspots.some((hotspot) => hotspot.lastChangedAt)).toBe(true);
    expect(new Set(analytics.hotspots.map((hotspot) => hotspot.statusLevel)).size).toBeGreaterThanOrEqual(2);
    expect(sevenDays.hotspots.map((hotspot) => hotspot.trend.delta)).not.toEqual(
      analytics.hotspots.map((hotspot) => hotspot.trend.delta)
    );
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
  });

  it("aggregates hotspots by module, project, or parameter dimension", () => {
    const moduleAnalytics = deriveParameterHomepageAnalytics(initialState, "30d", "module");
    const projectAnalytics = deriveParameterHomepageAnalytics(initialState, "30d", "project");
    const parameterAnalytics = deriveParameterHomepageAnalytics(initialState, "30d", "parameter");

    expect(moduleAnalytics.hotspotDimension).toBe("module");
    expect(moduleAnalytics.hotspots.every((hotspot) => hotspot.kind === "module")).toBe(true);
    expect(moduleAnalytics.hotspots[0].title).not.toContain("·");
    expect(moduleAnalytics.hotspots.map((hotspot) => hotspot.title)).toContain("Charging Policy");
    expect(moduleAnalytics.hotspots.every((hotspot) => hotspot.suggestedPath.includes("module="))).toBe(true);

    expect(projectAnalytics.hotspotDimension).toBe("project");
    expect(projectAnalytics.hotspots.every((hotspot) => hotspot.kind === "project")).toBe(true);
    expect(projectAnalytics.hotspots.map((hotspot) => hotspot.title)).toEqual(expect.arrayContaining(["AUR-Prod", "NEB-RD", "ATL-Intl"]));
    expect(projectAnalytics.hotspots.every((hotspot) => hotspot.suggestedPath.includes("project="))).toBe(true);

    expect(parameterAnalytics.hotspotDimension).toBe("parameter");
    expect(parameterAnalytics.hotspots.every((hotspot) => hotspot.kind === "parameter")).toBe(true);
    expect(parameterAnalytics.hotspots.map((hotspot) => hotspot.title)).toContain("fast_charge_current_limit_ma");
    expect(parameterAnalytics.hotspots.every((hotspot) => hotspot.suggestedPath.includes("parameter="))).toBe(true);
  });

  it("builds the overall leaderboard from module, project, and parameter candidates", () => {
    const analytics = deriveParameterHomepageAnalytics(initialState, "30d", "overall");
    const kinds = new Set(analytics.hotspots.map((hotspot) => hotspot.kind));

    expect(analytics.hotspotDimension).toBe("overall");
    expect(kinds).toEqual(new Set(["module", "project", "parameter"]));
    expect(analytics.hotspots).toHaveLength(5);
    analytics.hotspots.slice(1).forEach((hotspot, index) => {
      expect(analytics.hotspots[index].score).toBeGreaterThanOrEqual(hotspot.score);
    });
  });
});

const requestStatuses = {
  reviewPending: "待审阅",
  autoChecked: "自动检查通过",
  waitingMerge: "等待合入",
  merged: "已合入",
  rejected: "已打回"
} satisfies Record<string, RequestStatus>;

describe("deriveUpdateTrendSeries", () => {
  it("returns 7 daily points for the 7d window", () => {
    const series = deriveUpdateTrendSeries("7d");

    expect(series).toHaveLength(7);
    series.forEach((point) => {
      expect(point.value).toBeGreaterThanOrEqual(0);
      expect(point.value).toBeLessThanOrEqual(8);
      expect(Number.isInteger(point.value)).toBe(true);
      expect(point.label).toMatch(/^\d+\/\d+$/);
      expect(point.date).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });
  });

  it("returns 30 daily points for the 30d window", () => {
    const series = deriveUpdateTrendSeries("30d");

    expect(series).toHaveLength(30);
    expect(series[0].label).toMatch(/^\d+\/\d+$/);
  });

  it("returns 26 weekly points for the 180d window", () => {
    const series = deriveUpdateTrendSeries("180d");

    expect(series).toHaveLength(26);
    expect(series[0].label).toMatch(/^第\d+周$/);
    expect(series[25].label).toBe("第26周");
  });

  it("is deterministic across repeated calls", () => {
    expect(deriveUpdateTrendSeries("30d")).toEqual(deriveUpdateTrendSeries("30d"));
    expect(deriveUpdateTrendSeries("7d")).toEqual(deriveUpdateTrendSeries("7d"));
    expect(deriveUpdateTrendSeries("180d")).toEqual(deriveUpdateTrendSeries("180d"));
  });

  it("places a visible peak near the middle of the series", () => {
    const series = deriveUpdateTrendSeries("30d");
    const maxValue = Math.max(...series.map((point) => point.value));

    expect(maxValue).toBeGreaterThanOrEqual(7);
  });
});

describe("deriveProjectRiskDistribution", () => {
  it("returns one bucket per managed project", () => {
    const buckets = deriveProjectRiskDistribution(initialState, "30d");

    expect(buckets).toHaveLength(initialState.configDraft.projects.length);
    expect(buckets.map((bucket) => bucket.projectId)).toEqual(
      initialState.configDraft.projects.map((project) => project.id)
    );
  });

  it("exposes project code and name for display", () => {
    const buckets = deriveProjectRiskDistribution(initialState, "30d");
    const aurora = buckets.find((bucket) => bucket.projectId === "aurora");

    expect(aurora?.projectCode).toBe("AUR-Prod");
    expect(aurora?.projectName).toBe("Aurora 量产平台");
  });

  it("uses non-negative risk counts and matching totals", () => {
    const buckets = deriveProjectRiskDistribution(initialState, "30d");

    buckets.forEach((bucket) => {
      expect(bucket.high).toBeGreaterThanOrEqual(0);
      expect(bucket.medium).toBeGreaterThanOrEqual(0);
      expect(bucket.low).toBeGreaterThanOrEqual(0);
      expect(bucket.total).toBe(bucket.high + bucket.medium + bucket.low);
    });
  });

  it("scales totals by time window", () => {
    const sevenDays = deriveProjectRiskDistribution(initialState, "7d");
    const thirtyDays = deriveProjectRiskDistribution(initialState, "30d");
    const oneHundredEightyDays = deriveProjectRiskDistribution(initialState, "180d");
    const sum = (buckets: ReturnType<typeof deriveProjectRiskDistribution>) =>
      buckets.reduce((acc, bucket) => acc + bucket.total, 0);

    expect(sum(sevenDays)).toBeLessThan(sum(thirtyDays));
    expect(sum(oneHundredEightyDays)).toBeGreaterThan(sum(thirtyDays));
  });

  it("is deterministic for repeated calls", () => {
    expect(deriveProjectRiskDistribution(initialState, "30d")).toEqual(
      deriveProjectRiskDistribution(initialState, "30d")
    );
  });
});

describe("generateOpsHeadline", () => {
  it("uses the module template in module mode", () => {
    const analytics = deriveParameterHomepageAnalytics(initialState, "30d", "module");
    const headline = generateOpsHeadline(analytics);

    expect(headline).toContain("近 30 天");
    expect(headline).toContain("参数修改集中在");
    expect(headline).toContain(analytics.hotspots[0].title);
    expect(headline).toMatch(/待治理高风险参数最多（\d+ 项）/);
    expect(headline.endsWith("建议优先关注。")).toBe(true);
  });

  it("uses the project template in project mode", () => {
    const analytics = deriveParameterHomepageAnalytics(initialState, "30d", "project");
    const headline = generateOpsHeadline(analytics);

    expect(headline).toContain("近 30 天");
    expect(headline).toContain(analytics.hotspots[0].title);
    expect(headline).toContain("修改最活跃");
    expect(headline).toMatch(/待治理高风险参数 \d+ 项/);
  });

  it("falls back to a calm line when data is empty", () => {
    const emptyAnalytics = deriveParameterHomepageAnalytics({ ...initialState, parameters: [] }, "7d", "module");
    const headline = generateOpsHeadline(emptyAnalytics);

    expect(headline).toBe("近 7 天参数库运行平稳，暂无需优先处理的高风险热点。");
  });

  it("updates copy across different windows", () => {
    const sevenDays = generateOpsHeadline(deriveParameterHomepageAnalytics(initialState, "7d", "module"));
    const thirtyDays = generateOpsHeadline(deriveParameterHomepageAnalytics(initialState, "30d", "module"));

    expect(sevenDays).toContain("近 7 天");
    expect(thirtyDays).toContain("近 30 天");
  });
});
