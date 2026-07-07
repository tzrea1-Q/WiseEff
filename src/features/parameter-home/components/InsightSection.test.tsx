import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DashboardSummary } from "@/domain/parameters/dashboardTypes";
import { initialState } from "@/mockData";
import { InsightSection } from "./InsightSection";

const summary: DashboardSummary = {
  window: "30d",
  windowLabel: "近 30 天",
  projectId: null,
  kpis: {
    totalParameters: 10,
    managedProjects: 2,
    changeFrequency: 5,
    activeContributors: 3,
    highRiskParameters: 2
  },
  trend: [{ bucketStart: "2026-07-01T00:00:00Z", label: "7/1", changeCount: 2, workflowEventCount: 1 }],
  riskBuckets: [
    {
      projectId: "aurora",
      projectCode: "AUR-Prod",
      projectName: "Aurora",
      high: 2,
      medium: 1,
      low: 1,
      total: 4
    }
  ],
  workbenchSignals: {
    reviewQueue: 0,
    myDrafts: 0,
    returnedChanges: 0,
    waitingMerge: 0,
    unappliedImportBatches: 0,
    inactiveAccounts: 0
  }
};

const hotspot = {
  id: "project:aurora",
  kind: "project" as const,
  title: "AUR-Prod",
  projectCode: "AUR-Prod",
  module: "项目参数",
  statusLabel: "需要关注",
  statusLevel: "watch" as const,
  score: 180,
  scoreBreakdown: { frequency: 30, risk: 30, impact: 30, workflow: 30, drift: 60 },
  evidence: ["高风险参数 2 项"],
  trendDelta: 0,
  trendDirection: "flat" as const,
  suggestedPath: "/parameters?project=aurora"
};

describe("InsightSection", () => {
  it("is collapsed by default for action-first emphasis", () => {
    render(
      <InsightSection
        emphasis="action-first"
        window="30d"
        dimension="overall"
        summaryStatus="ready"
        hotspotsStatus="ready"
        summary={summary}
        hotspots={[hotspot]}
        state={initialState}
        onWindowChange={vi.fn()}
        onDimensionChange={vi.fn()}
        onSummaryRetry={vi.fn()}
        onHotspotsRetry={vi.fn()}
        onNavigate={vi.fn()}
      />
    );
    expect(screen.queryByRole("img", { name: /参数更新趋势/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开洞察" }));
    expect(screen.getByRole("img", { name: /参数更新趋势/ })).toBeInTheDocument();
  });

  it("is expanded by default for insight-first emphasis", () => {
    render(
      <InsightSection
        emphasis="insight-first"
        window="30d"
        dimension="overall"
        summaryStatus="ready"
        hotspotsStatus="ready"
        summary={summary}
        hotspots={[hotspot]}
        state={initialState}
        onWindowChange={vi.fn()}
        onDimensionChange={vi.fn()}
        onSummaryRetry={vi.fn()}
        onHotspotsRetry={vi.fn()}
        onNavigate={vi.fn()}
      />
    );
    expect(screen.getByRole("img", { name: /参数更新趋势/ })).toBeInTheDocument();
  });

  it("renders skeleton and error states per section status", () => {
    const onSummaryRetry = vi.fn();
    const onHotspotsRetry = vi.fn();
    render(
      <InsightSection
        emphasis="insight-first"
        window="30d"
        dimension="overall"
        summaryStatus="loading"
        hotspotsStatus="error"
        summary={null}
        hotspots={[]}
        hotspotsError="热榜失败"
        state={initialState}
        onWindowChange={vi.fn()}
        onDimensionChange={vi.fn()}
        onSummaryRetry={onSummaryRetry}
        onHotspotsRetry={onHotspotsRetry}
        onNavigate={vi.fn()}
      />
    );
    expect(screen.getByText("加载趋势", { selector: ".sr-only" })).toBeInTheDocument();
    expect(screen.getByText("热榜失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onHotspotsRetry).toHaveBeenCalledOnce();
  });
});
