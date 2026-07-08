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
    managedProjects: 3,
    changeFrequency: 19,
    activeContributors: 5,
    highRiskParameters: 12
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
