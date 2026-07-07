import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createInMemoryTestDatabase, type InMemoryTestDatabase } from "../../../testing/testDatabase";
import { seedParameterDashboardFixture } from "../../../testing/parameterDashboardFixture";
import {
  countKpis,
  aggregateTrend,
  aggregateRiskDistribution,
  aggregateWorkbenchSignals
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
});
