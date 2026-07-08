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
      "高风险经手"
    ]);
    expect(view.panelSubtitle).toBe("我的关键指标");
    expect(view.trendTitle).toBe("我的变更趋势");
  });

  it("maps overall labels for any role", () => {
    const view = deriveOverviewPresentation("admin", "overall");
    expect(view.panelSubtitle).toBe("参数库关键指标");
    expect(view.trendTitle).toBe("参数更新趋势");
  });
});
