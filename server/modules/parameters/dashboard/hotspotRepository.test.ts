import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createInMemoryTestDatabase, type InMemoryTestDatabase } from "../../../testing/testDatabase";
import { seedParameterDashboardFixture } from "../../../testing/parameterDashboardFixture";
import { aggregateHotspotGroups } from "./hotspotRepository";

describe("hotspot repository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedParameterDashboardFixture(db);
  }, 30_000);

  afterEach(async () => {
    await db.rollback();
  });

  it("aggregates module-dimension groups with behavioral counts", async () => {
    const groups = await aggregateHotspotGroups(db, {
      organizationId: "org-chargelab",
      projectId: null,
      dimension: "module",
      windowStart: "2026-06-07T00:00:00Z",
      windowEnd: "2026-07-07T00:00:00Z"
    });
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0]).toHaveProperty("modifiedParamCount");
    expect(groups[0]).toHaveProperty("historyEventsInWindow");
  });

  it("aggregates project-dimension groups with real counts", async () => {
    const groups = await aggregateHotspotGroups(db, {
      organizationId: "org-chargelab",
      projectId: null,
      dimension: "project",
      windowStart: "2026-06-07T00:00:00Z",
      windowEnd: "2026-07-07T00:00:00Z"
    });
    expect(groups.length).toBeGreaterThan(0);
    const first = groups[0];
    expect(first).toHaveProperty("groupId");
    expect(first).toHaveProperty("riskWeightSum");
    expect(first).toHaveProperty("relatedRequestCount");
  });

  it("aggregates parameter-dimension groups across projects with project scope counts", async () => {
    const groups = await aggregateHotspotGroups(db, {
      organizationId: "org-chargelab",
      projectId: null,
      dimension: "parameter",
      windowStart: "2026-06-07T00:00:00Z",
      windowEnd: "2026-07-07T00:00:00Z"
    });
    expect(groups.length).toBeGreaterThan(0);
    const first = groups[0];
    expect(first.kind).toBe("parameter");
    expect(first.projectId).toBeUndefined();
    expect(first.projectCode).toContain("个项目");
    expect(first.parameterCount).toBeGreaterThan(0);
    expect(first).toHaveProperty("modifiedParamCount");
    expect(first.modifiedParamCount).toBeLessThanOrEqual(first.parameterCount);
  });
});
