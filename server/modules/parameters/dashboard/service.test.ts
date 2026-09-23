import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { AuthContext } from "../../auth/types";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../../testing/testDatabase";
import {
  PARAMETER_DASHBOARD_FIXTURE,
  seedParameterDashboardFixture
} from "../../../testing/parameterDashboardFixture";
import { getDashboardSummary, getDashboardHotspots } from "./service";

const auth: AuthContext = {
  user: {
    id: PARAMETER_DASHBOARD_FIXTURE.activeUserId,
    organizationId: PARAMETER_DASHBOARD_FIXTURE.organizationId,
    name: "Xu Yun",
    email: "xu@chargelab.cn",
    title: "Platform Owner",
    isActive: true
  },
  organization: {
    id: PARAMETER_DASHBOARD_FIXTURE.organizationId,
    name: PARAMETER_DASHBOARD_FIXTURE.organizationName
  },
  roles: [{ projectId: null, roleId: "admin" }],
  permissions: ["parameter:view", "parameter:edit", "admin:access"]
};

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("dashboard service", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedParameterDashboardFixture(db);
  });

  afterEach(async () => {
    await db.rollback();
  });

  it("keeps independent admin metrics while excluding legacy parameter rows", async () => {
    const summary = await getDashboardSummary(db, { auth, window: "30d" });
    expect(summary.window).toBe("30d");
    expect(summary.windowLabel).toBe("近 30 天 · 完整 UTC 日（不含今天）");
    expect(summary.trend).toHaveLength(30);
    expect(summary.kpis.totalParameters).toBe(0);
    expect(summary.kpis.totalBindings).toBe(0);
    expect(summary.kpis.totalDefinitions).toBe(0);
    expect(summary.kpis.highRiskParameters).toBeNull();
    expect(summary.kpis.riskAvailability).toBe("unavailable");
    expect(summary.personalKpis).toMatchObject({
      workflowCount: 0,
      openItemCount: summary.workbenchSignals.unappliedImportBatches,
      pendingTodoCount: summary.workbenchSignals.inactiveAccounts
    });
    expect(summary.personalTrend).toHaveLength(30);
    expect(summary.riskBuckets).toEqual([]);
  });

  it("keeps perspective role display-only for canonical admin metrics", async () => {
    const summary = await getDashboardSummary(db, {
      auth,
      window: "30d",
      perspectiveRoleId: "hardware-committer"
    });
    expect(summary.personalKpis).toMatchObject({
      contributionCount: 0,
      workflowCount: 0,
      highRiskTouchCount: 0,
      riskAvailability: "available"
    });
  });

  it("uses a lower perspective only when the caller holds it in the selected scope", async () => {
    const multiRoleAuth: AuthContext = {
      ...auth,
      roles: [...auth.roles, { projectId: PARAMETER_DASHBOARD_FIXTURE.projectIds.aurora, roleId: "software-user" }]
    };
    const ownScope = await getDashboardSummary(db, {
      auth: multiRoleAuth,
      projectId: PARAMETER_DASHBOARD_FIXTURE.projectIds.aurora,
      window: "30d",
      perspectiveRoleId: "software-user"
    });
    expect(ownScope.personalKpis.highRiskTouchCount).toBeNull();
    expect(ownScope.personalKpis.riskAvailability).toBe("unavailable");
    const otherScope = await getDashboardSummary(db, {
      auth: multiRoleAuth,
      projectId: PARAMETER_DASHBOARD_FIXTURE.projectIds.zephyr,
      window: "30d",
      perspectiveRoleId: "software-user"
    });
    expect(otherScope.personalKpis.riskAvailability).toBe("available");
  });

  it("does not expose legacy semantic rows as module hotspots", async () => {
    const hotspots = await getDashboardHotspots(db, { auth, window: "30d", dimension: "module" });
    expect(hotspots).toEqual([]);
  });

  it("does not expose legacy semantic rows as project hotspots", async () => {
    const hotspots = await getDashboardHotspots(db, { auth, window: "30d", dimension: "project" });
    expect(hotspots).toEqual([]);
  });

  it("does not expose legacy semantic rows as parameter hotspots", async () => {
    const hotspots = await getDashboardHotspots(db, { auth, window: "30d", dimension: "parameter" });
    expect(hotspots).toEqual([]);
  });

  it("rejects a missing or unauthorized project scope before returning zeroes", async () => {
    await expect(
      getDashboardSummary(db, { auth, projectId: "dashboard-fixture-missing", window: "30d" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      getDashboardHotspots(db, { auth, projectId: "dashboard-fixture-missing", window: "30d", dimension: "project" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const projectScopedAuth = {
      ...auth,
      roles: [{ projectId: PARAMETER_DASHBOARD_FIXTURE.projectIds.aurora, roleId: "admin" }]
    };
    await expect(
      getDashboardSummary(db, {
        auth: projectScopedAuth,
        projectId: PARAMETER_DASHBOARD_FIXTURE.projectIds.zephyr,
        window: "30d"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      getDashboardHotspots(db, {
        auth: projectScopedAuth,
        projectId: PARAMETER_DASHBOARD_FIXTURE.projectIds.zephyr,
        window: "30d",
        dimension: "project"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
