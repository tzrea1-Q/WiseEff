import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createInMemoryTestDatabase, type InMemoryTestDatabase } from "../../../testing/testDatabase";
import { seedParameterDashboardFixture } from "../../../testing/parameterDashboardFixture";
import { aggregateHotspotGroups } from "./hotspotRepository";

describe("hotspot repository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedParameterDashboardFixture(db);
  });

  afterEach(async () => {
    await db.rollback();
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
});
