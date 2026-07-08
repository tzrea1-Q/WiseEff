import { describe, expect, it, vi } from "vitest";
import { createHttpParameterDashboardRepository } from "./parameterDashboardClient";

function stubClient(responses: Record<string, unknown>) {
  return { get: vi.fn(async (path: string) => responses[path]) } as any;
}

describe("http parameter dashboard repository", () => {
  it("requests summary with window + projectId query", async () => {
    const client = stubClient({
      "/api/v1/parameters/dashboard/summary?projectId=aurora&window=30d": {
        item: {
          window: "30d",
          windowLabel: "近 30 天",
          projectId: "aurora",
          kpis: {
            totalParameters: 1,
            managedProjects: 1,
            changeFrequency: 1,
            activeContributors: 1,
            highRiskParameters: 1
          },
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
    });
    const repo = createHttpParameterDashboardRepository(client);
    const summary = await repo.listDashboardSummary({ projectId: "aurora", window: "30d" });
    expect(summary.kpis.totalParameters).toBe(1);
    expect(client.get).toHaveBeenCalledWith("/api/v1/parameters/dashboard/summary?projectId=aurora&window=30d");
  });

  it("requests hotspots with dimension query", async () => {
    const client = stubClient({
      "/api/v1/parameters/dashboard/hotspots?window=30d&dimension=project": { items: [] }
    });
    const repo = createHttpParameterDashboardRepository(client);
    const items = await repo.listDashboardHotspots({ window: "30d", dimension: "project" });
    expect(items).toEqual([]);
    expect(client.get).toHaveBeenCalledWith("/api/v1/parameters/dashboard/hotspots?window=30d&dimension=project");
  });
});
