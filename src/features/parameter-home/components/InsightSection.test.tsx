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
  personalKpis: {
    contributionCount: 0,
    workflowCount: 0,
    openItemCount: 0,
    pendingTodoCount: 0,
    highRiskTouchCount: 0
  },
  personalTrend: [],
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
  scoreBreakdown: { frequency: 30, scope: 40, workflow: 25, collaboration: 15 },
  evidence: [
    "累计修改 12 / 200 个参数（6%）",
    "窗口内 8 次参数变更",
    "待处理流程 2 项 · 窗口内 3 项请求"
  ],
  trendDelta: 0,
  trendDirection: "flat" as const,
  suggestedPath: "/parameters?project=aurora"
};

describe("InsightSection", () => {
  it("is collapsed by default for action-first emphasis", () => {
    render(
      <InsightSection
        emphasis="action-first"
        dimension="project"
        hotspotsStatus="ready"
        summary={summary}
        hotspots={[hotspot]}
        state={initialState}
        onHotspotsRetry={vi.fn()}
      />
    );
    expect(screen.queryByText("热榜")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开洞察" }));
    expect(screen.getByText("热榜")).toBeInTheDocument();
  });

  it("is expanded by default for insight-first emphasis", () => {
    render(
      <InsightSection
        emphasis="insight-first"
        dimension="project"
        hotspotsStatus="ready"
        summary={summary}
        hotspots={[hotspot]}
        state={initialState}
        onHotspotsRetry={vi.fn()}
      />
    );
    expect(screen.getByText("热榜")).toBeInTheDocument();
  });

  it("renders skeleton and error states per section status", () => {
    const onHotspotsRetry = vi.fn();
    render(
      <InsightSection
        emphasis="insight-first"
        dimension="project"
        hotspotsStatus="error"
        summary={summary}
        hotspots={[]}
        hotspotsError="热榜失败"
        state={initialState}
        onHotspotsRetry={onHotspotsRetry}
      />
    );
    expect(screen.getByText("热榜失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onHotspotsRetry).toHaveBeenCalledOnce();
  });
});
