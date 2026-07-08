import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createInMemoryTestDatabase, type InMemoryTestDatabase } from "../../../testing/testDatabase";
import { seedParameterDashboardFixture } from "../../../testing/parameterDashboardFixture";
import type { Database } from "../../../shared/database/client";
import {
  countKpis,
  aggregateTrend,
  aggregateRiskDistribution,
  aggregateWorkbenchSignals,
  countPersonalKpis,
  aggregatePersonalTrend
} from "./repository";

describe("dashboard repository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedParameterDashboardFixture(db);
  });

  afterEach(async () => {
    await db.rollback();
  });

  it("counts KPIs scoped to org and window", async () => {
    const kpis = await countKpis(db, { organizationId: "org-chargelab", projectId: null, windowStart: "2026-06-07T00:00:00Z" });
    expect(kpis.totalParameters).toBeGreaterThan(0);
    expect(kpis.managedProjects).toBeGreaterThan(0);
    expect(kpis.highRiskParameters).toBeGreaterThanOrEqual(1);
  });

  it("aggregates trend into zero-filled day buckets", async () => {
    const points = await aggregateTrend(db, {
      organizationId: "org-chargelab",
      projectId: null,
      windowStart: "2026-06-07T00:00:00Z",
      windowEnd: "2026-07-07T00:00:00Z",
      granularity: "day"
    });
    expect(points.length).toBe(30);
    expect(points.every((p) => typeof p.changeCount === "number")).toBe(true);
  });

  it("aggregates risk distribution by project without scaling", async () => {
    const buckets = await aggregateRiskDistribution(db, { organizationId: "org-chargelab", projectId: null });
    const aurora = buckets.find((b) => b.projectId === "aurora");
    expect(aurora).toBeDefined();
    expect(aurora!.high + aurora!.medium + aurora!.low).toBe(aurora!.total);
  });

  it("aggregates workbench signals", async () => {
    const signals = await aggregateWorkbenchSignals(db, {
      organizationId: "org-chargelab",
      userId: "u-xu-yun",
      projectId: null
    });
    expect(signals.reviewQueue).toBeGreaterThanOrEqual(0);
    expect(signals.inactiveAccounts).toBeGreaterThanOrEqual(0);
  });

  it("counts personal KPIs scoped by user, project and window", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          contribution_count: "8",
          workflow_count: "3",
          high_risk_touch_count: "2"
        }
      ],
      rowCount: 1
    });
    const mockDb = {
      query,
      transaction: vi.fn()
    } as unknown as Database;

    const result = await countPersonalKpis(mockDb, {
      organizationId: "org-chargelab",
      projectId: "aurora",
      userId: "u-xu-yun",
      windowStart: "2026-06-01T00:00:00Z",
      perspectiveRoleId: "software-user",
      workbenchSignals: {
        reviewQueue: 5,
        myDrafts: 4,
        returnedChanges: 2,
        waitingMerge: 1,
        unappliedImportBatches: 6,
        inactiveAccounts: 7
      },
      roleLevel: "user"
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, args] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("h.changed_by_user_id = $2");
    expect(sql).toContain("r.submitter_user_id = $2");
    expect(sql).toContain("h.project_id = $4");
    expect(sql).toContain("r.project_id = $4");
    expect(args).toEqual(["org-chargelab", "u-xu-yun", "2026-06-01T00:00:00Z", "aurora"]);

    expect(result).toEqual({
      contributionCount: 8,
      workflowCount: 3,
      highRiskTouchCount: 2,
      openItemCount: 4,
      pendingTodoCount: 3
    });
  });

  it("aggregates personal trend with user-scoped filters", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          bucket_start: new Date("2026-07-01T00:00:00.000Z"),
          change_count: "4",
          workflow_event_count: "2"
        }
      ],
      rowCount: 1
    });
    const mockDb = {
      query,
      transaction: vi.fn()
    } as unknown as Database;

    const points = await aggregatePersonalTrend(mockDb, {
      organizationId: "org-chargelab",
      projectId: null,
      userId: "u-xu-yun",
      windowStart: "2026-07-01T00:00:00Z",
      windowEnd: "2026-07-02T00:00:00Z",
      granularity: "day",
      roleLevel: "user"
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, args] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("t.changed_by_user_id = $4");
    expect(sql).toContain("t.submitter_user_id = $4");
    expect(args).toEqual(["2026-07-01T00:00:00Z", "2026-07-02T00:00:00Z", "org-chargelab", "u-xu-yun"]);
    expect(points).toEqual([
      {
        bucketStart: "2026-07-01T00:00:00.000Z",
        changeCount: 4,
        workflowEventCount: 2
      }
    ]);
  });

  it("counts committer personal KPIs from review decisions", async () => {
    const result = await countPersonalKpis(db, {
      organizationId: "org-chargelab",
      projectId: null,
      userId: "u-xu-yun",
      windowStart: "2026-06-01T00:00:00.000Z",
      perspectiveRoleId: "hardware-committer",
      workbenchSignals: {
        reviewQueue: 0,
        myDrafts: 0,
        returnedChanges: 0,
        waitingMerge: 0,
        unappliedImportBatches: 0,
        inactiveAccounts: 0
      },
      roleLevel: "committer"
    });

    expect(result.contributionCount).toBe(2);
    expect(result.workflowCount).toBe(2);
    expect(result.openItemCount).toBeGreaterThanOrEqual(0);
  });
});
