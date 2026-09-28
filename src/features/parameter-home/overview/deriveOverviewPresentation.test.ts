import { describe, expect, it } from "vitest";
import { deriveOverviewPresentation } from "./deriveOverviewPresentation";

describe("deriveOverviewPresentation", () => {
  it("maps user personal KPI labels", () => {
    const view = deriveOverviewPresentation("user", "personal");
    expect(view.kpiItems.map((i) => i.label)).toEqual([
      "我的变更",
      "我的提交",
      "我的草稿",
      "待处理事项",
      "风险分类"
    ]);
    expect(view.panelSubtitle).toBe("我的关键指标");
    expect(view.trendTitle).toBe("我的变更趋势");
  });

  it("maps committer personal KPI and trend labels", () => {
    const view = deriveOverviewPresentation("committer", "personal");
    expect(view.kpiItems.map((i) => i.label)).toEqual([
      "我的审阅完成",
      "我处理的流程",
      "待我审阅",
      "其他待办",
      "风险分类"
    ]);
    expect(view.trendTitle).toBe("我的审阅趋势");
    expect(view.changeSeriesName).toBe("我的审阅完成");
    expect(view.workflowSeriesName).toBe("我处理的流程");
  });

  it("maps overall labels for any role", () => {
    const view = deriveOverviewPresentation("admin", "overall");
    expect(view.panelSubtitle).toBe("参数库关键指标");
    expect(view.trendTitle).toBe("参数更新趋势");
  });

  it("renders unavailable canonical risk instead of inventing a number", () => {
    const view = deriveOverviewPresentation(
      "user",
      "personal",
      undefined,
      {
        contributionCount: 0,
        workflowCount: 0,
        openItemCount: 0,
        pendingTodoCount: 0,
        highRiskTouchCount: null,
        riskAvailability: "unavailable"
      }
    );
    expect(view.kpiItems.at(-1)?.value).toBe("不可用");
  });

  it("does not turn missing Binding fields into zero", () => {
    const view = deriveOverviewPresentation("guest", "overall", {
      totalParameters: 3,
      managedProjects: 1,
      changeFrequency: 0,
      activeContributors: 0,
      highRiskParameters: null
    });
    expect(view.kpiItems[0]?.value).toBe("不可用");
    expect(view.kpiItems[2]?.value).toBe(1);
  });
});
