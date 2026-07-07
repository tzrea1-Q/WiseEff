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

  it("builds a full summary with zero-filled trend", async () => {
    const summary = await getDashboardSummary(db, { auth, window: "30d" });
    expect(summary.window).toBe("30d");
    expect(summary.windowLabel).toBe("近 30 天");
    expect(summary.trend).toHaveLength(30);
    expect(summary.riskBuckets.length).toBeGreaterThan(0);
  });

  it("returns ranked hotspots with explainable score", async () => {
    const hotspots = await getDashboardHotspots(db, { auth, window: "30d", dimension: "project" });
    expect(hotspots.length).toBeGreaterThan(0);
    expect(hotspots[0].score).toBeGreaterThanOrEqual(hotspots[hotspots.length - 1].score);
    expect(hotspots[0].scoreBreakdown).toHaveProperty("frequency");
  });
});
