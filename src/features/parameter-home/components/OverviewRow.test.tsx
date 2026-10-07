import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DashboardSummary } from "@/domain/parameters/dashboardTypes";
import { OverviewRow } from "./OverviewRow";

const summary: DashboardSummary = {
  window: "30d",
  windowLabel: "近 30 天",
  projectId: null,
  kpis: {
    totalParameters: 51,
    totalBindings: 51,
    totalDefinitions: 40,
    managedProjects: 3,
    changeFrequency: 19,
    activeContributors: 5,
    highRiskParameters: null,
    riskAvailability: "unavailable"
  },
  trend: [{ bucketStart: "2026-07-01T00:00:00Z", label: "7/1", changeCount: 6, workflowEventCount: 2 }],
  personalKpis: {
    contributionCount: 4,
    workflowCount: 2,
    openItemCount: 1,
    pendingTodoCount: 3,
    highRiskTouchCount: 1
  },
  personalTrend: [{ bucketStart: "2026-07-02T00:00:00Z", label: "7/2", changeCount: 3, workflowEventCount: 1 }],
  riskBuckets: [],
  workbenchSignals: {
    reviewQueue: 0,
    myDrafts: 0,
    returnedChanges: 0,
    waitingMerge: 0,
    unappliedImportBatches: 0,
    inactiveAccounts: 0
  }
};

describe("OverviewRow", () => {
  it.each(["idle", "loading", "error"] as const)(
    "hides the cached window label while %s and restores the current result label",
    (summaryStatus) => {
      const props = {
        summary,
        kpis: summary.kpis,
        overviewScope: "personal" as const,
        roleView: "user" as const,
        onOverviewScopeChange: vi.fn(),
        onSummaryRetry: vi.fn(),
        summaryError: "看板加载失败"
      };
      const { rerender } = render(<OverviewRow {...props} summaryStatus="ready" />);
      expect(screen.getByText("近 30 天")).toBeInTheDocument();

      rerender(<OverviewRow {...props} summaryStatus={summaryStatus} />);
      expect(screen.queryByText("近 30 天")).not.toBeInTheDocument();
      expect(screen.queryByText("近 7 天")).not.toBeInTheDocument();
      expect(screen.queryByRole("img", { name: "参数更新趋势" })).not.toBeInTheDocument();
      if (summaryStatus === "error") {
        expect(screen.getAllByText("看板加载失败")).toHaveLength(2);
      } else {
        expect(screen.getAllByRole("status")).toHaveLength(2);
      }

      const currentSummary: DashboardSummary = { ...summary, window: "7d", windowLabel: "近 7 天" };
      rerender(<OverviewRow {...props} summary={currentSummary} summaryStatus="ready" />);
      expect(screen.getByText("近 7 天")).toBeInTheDocument();
      expect(screen.queryByText("近 30 天")).not.toBeInTheDocument();
      expect(screen.getByRole("img", { name: "参数更新趋势" })).toBeInTheDocument();

      rerender(<OverviewRow {...props} summary={currentSummary} summaryStatus="empty" />);
      expect(screen.getByText("近 7 天")).toBeInTheDocument();
      expect(screen.getByText("当前窗口暂无趋势数据")).toBeInTheDocument();
      expect(screen.queryByRole("img", { name: "参数更新趋势" })).not.toBeInTheDocument();
    }
  );

  it("renders personal trend title and uses personal trend points", () => {
    render(
      <OverviewRow
        summaryStatus="ready"
        summary={summary}
        kpis={summary.kpis}
        overviewScope="personal"
        roleView="user"
        onOverviewScopeChange={vi.fn()}
        onSummaryRetry={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "我的变更趋势" })).toBeInTheDocument();
    expect(screen.getByText("7/2")).toBeInTheDocument();
    expect(screen.queryByText("7/1")).not.toBeInTheDocument();
  });

  it("forwards scope switch changes", () => {
    const onOverviewScopeChange = vi.fn();
    render(
      <OverviewRow
        summaryStatus="ready"
        summary={summary}
        kpis={summary.kpis}
        overviewScope="personal"
        roleView="user"
        onOverviewScopeChange={onOverviewScopeChange}
        onSummaryRetry={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("radio", { name: "整体" }));
    expect(onOverviewScopeChange).toHaveBeenCalledWith("overall");
  });
});
