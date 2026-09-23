import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../../testing/testDatabase";
import {
  PARAMETER_DASHBOARD_FIXTURE,
  seedParameterDashboardFixture
} from "../../../testing/parameterDashboardFixture";
import type { Database } from "../../../shared/database/client";
import {
  countKpis,
  aggregateTrend,
  aggregateRiskDistribution,
  aggregateWorkbenchSignals,
  countPersonalKpis,
  aggregatePersonalTrend
} from "./repository";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("dashboard repository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedParameterDashboardFixture(db);
  });

  afterEach(async () => {
    await db.rollback();
  });

  it("does not count legacy semantic rows as canonical KPIs", async () => {
    const kpis = await countKpis(db, {
      organizationId: PARAMETER_DASHBOARD_FIXTURE.organizationId,
      projectId: null,
      windowStart: "2026-06-07T00:00:00Z",
      windowEnd: "2026-07-07T00:00:00Z"
    });
    expect(kpis.totalParameters).toBe(0);
    expect(kpis.totalBindings).toBe(0);
    expect(kpis.totalDefinitions).toBe(0);
    expect(kpis.managedProjects).toBeGreaterThan(0);
    expect(kpis.highRiskParameters).toBeNull();
    expect(kpis.riskAvailability).toBe("unavailable");
  });

  it("aggregates trend into zero-filled day buckets", async () => {
    const points = await aggregateTrend(db, {
      organizationId: PARAMETER_DASHBOARD_FIXTURE.organizationId,
      projectId: null,
      windowStart: "2026-06-07T00:00:00Z",
      windowEnd: "2026-07-07T00:00:00Z",
      granularity: "day"
    });
    expect(points.length).toBe(30);
    expect(points.every((p) => typeof p.changeCount === "number")).toBe(true);
  });

  it("does not derive risk distribution from legacy semantic rows", async () => {
    const buckets = await aggregateRiskDistribution(db, { organizationId: PARAMETER_DASHBOARD_FIXTURE.organizationId, projectId: null });
    expect(buckets).toEqual([]);
  });

  it("aggregates workbench signals", async () => {
    const signals = await aggregateWorkbenchSignals(db, {
      organizationId: PARAMETER_DASHBOARD_FIXTURE.organizationId,
      userId: PARAMETER_DASHBOARD_FIXTURE.activeUserId,
      projectId: null,
      authorizedProjectIds: null,
      reviewableProjectIds: []
    });
    expect(signals.reviewQueue).toBeGreaterThanOrEqual(0);
    expect(signals.inactiveAccounts).toBeGreaterThanOrEqual(0);
  });

  it("counts personal KPIs scoped by user, project and window", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            contribution_count: "0",
            workflow_count: "0",
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
      windowEnd: "2026-07-01T00:00:00Z",
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
    expect(sql).toContain("parameter_catalog.binding_history_events history");
    expect(sql).toContain("public.project_parameter_value_change_requests request");
    expect(sql).not.toContain("parameter_history_entries");
    expect(sql).not.toContain("parameter_change_requests");
    expect(args).toEqual([
      "org-chargelab",
      "aurora",
      null,
      "u-xu-yun",
      "2026-06-01T00:00:00Z",
      "2026-07-01T00:00:00Z"
    ]);

    expect(result).toEqual({
      contributionCount: 0,
      workflowCount: 0,
      highRiskTouchCount: null,
      openItemCount: 4,
      pendingTodoCount: 2,
      riskAvailability: "unavailable"
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
    expect(sql).toContain("history.created_at");
    expect(sql).toContain("request.created_at");
    expect(sql).not.toContain("parameter_history_entries");
    expect(sql).not.toContain("parameter_change_requests");
    expect(args).toEqual([
      "2026-07-01T00:00:00Z",
      "2026-07-02T00:00:00Z",
      "org-chargelab",
      "u-xu-yun",
      null,
      null
    ]);
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
      organizationId: PARAMETER_DASHBOARD_FIXTURE.organizationId,
      projectId: null,
      userId: PARAMETER_DASHBOARD_FIXTURE.activeUserId,
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

    expect(result.contributionCount).toBe(0);
    expect(result.workflowCount).toBe(0);
    expect(result.highRiskTouchCount).toBeNull();
    expect(result.riskAvailability).toBe("unavailable");
    expect(result.openItemCount).toBeGreaterThanOrEqual(0);
  });
});
