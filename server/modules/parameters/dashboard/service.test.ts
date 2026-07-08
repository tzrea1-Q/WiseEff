import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { AuthContext } from "../../auth/types";
import { createInMemoryTestDatabase, type InMemoryTestDatabase } from "../../../testing/testDatabase";
import { seedParameterDashboardFixture } from "../../../testing/parameterDashboardFixture";
import { getDashboardSummary, getDashboardHotspots } from "./service";

const auth: AuthContext = {
  user: {
    id: "u-xu-yun",
    organizationId: "org-chargelab",
    name: "Xu Yun",
    email: "xu@chargelab.cn",
    title: "Platform Owner",
    isActive: true
  },
  organization: { id: "org-chargelab", name: "ChargeLab" },
  roles: [{ projectId: null, roleId: "admin" }],
  permissions: ["parameter:view", "parameter:edit", "admin:access"]
};

describe("dashboard service", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedParameterDashboardFixture(db);
  });

  afterEach(async () => {
    await db.rollback();
  });

  it("builds a full summary with personal metrics and trend", async () => {
    const summary = await getDashboardSummary(db, { auth, window: "30d" });
    expect(summary.window).toBe("30d");
    expect(summary.windowLabel).toBe("近 30 天");
    expect(summary.trend).toHaveLength(30);
    expect(summary.personalKpis).toMatchObject({
      workflowCount: 1,
      openItemCount: summary.workbenchSignals.unappliedImportBatches,
      pendingTodoCount: summary.workbenchSignals.inactiveAccounts
    });
    expect(summary.personalTrend).toHaveLength(30);
    expect(summary.riskBuckets.length).toBeGreaterThan(0);
  });

  it("builds committer personal metrics from review decisions", async () => {
    const summary = await getDashboardSummary(db, {
      auth,
      window: "30d",
      perspectiveRoleId: "hardware-committer"
    });
    expect(summary.personalKpis).toMatchObject({
      contributionCount: 2,
      workflowCount: 2
    });
  });

  it("returns ranked module hotspots with behavioral score breakdown", async () => {
    const hotspots = await getDashboardHotspots(db, { auth, window: "30d", dimension: "module" });
    expect(hotspots.length).toBeGreaterThan(0);
    expect(hotspots[0].scoreBreakdown).toHaveProperty("scope");
    expect(hotspots[0].evidence[0]).toContain("累计修改");
  });

  it("returns ranked project hotspots with behavioral score breakdown", async () => {
    const hotspots = await getDashboardHotspots(db, { auth, window: "30d", dimension: "project" });
    expect(hotspots.length).toBeGreaterThan(0);
    expect(hotspots[0].score).toBeGreaterThanOrEqual(hotspots[hotspots.length - 1].score);
    expect(hotspots[0].scoreBreakdown).toHaveProperty("scope");
    expect(hotspots[0].evidence[0]).toContain("累计修改");
  });

  it("returns ranked parameter hotspots with project-scope evidence", async () => {
    const hotspots = await getDashboardHotspots(db, { auth, window: "30d", dimension: "parameter" });
    expect(hotspots.length).toBeGreaterThan(0);
    expect(hotspots[0].scoreBreakdown).toHaveProperty("scope");
    expect(hotspots[0].scoreBreakdown).not.toHaveProperty("risk");
    expect(hotspots[0].evidence[0]).toContain("个项目中修改");
    expect(hotspots[0].projectCode).toContain("个项目");
  });
});
