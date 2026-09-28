import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../../testing/testDatabase";
import {
  PARAMETER_DASHBOARD_FIXTURE,
  seedParameterDashboardFixture
} from "../../../testing/parameterDashboardFixture";
import { aggregateHotspotGroups } from "./hotspotRepository";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("hotspot repository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedParameterDashboardFixture(db);
  });

  afterEach(async () => {
    await db.rollback();
  });

  it("does not count legacy semantic rows as module hotspots", async () => {
    const groups = await aggregateHotspotGroups(db, {
      organizationId: PARAMETER_DASHBOARD_FIXTURE.organizationId,
      projectId: null,
      dimension: "module",
      windowStart: "2026-06-07T00:00:00Z",
      windowEnd: "2026-07-07T00:00:00Z"
    });
    expect(groups).toEqual([]);
  });

  it("does not count legacy semantic rows as project hotspots", async () => {
    const groups = await aggregateHotspotGroups(db, {
      organizationId: PARAMETER_DASHBOARD_FIXTURE.organizationId,
      projectId: null,
      dimension: "project",
      windowStart: "2026-06-07T00:00:00Z",
      windowEnd: "2026-07-07T00:00:00Z"
    });
    expect(groups).toEqual([]);
  });

  it("does not count legacy semantic rows as parameter hotspots", async () => {
    const groups = await aggregateHotspotGroups(db, {
      organizationId: PARAMETER_DASHBOARD_FIXTURE.organizationId,
      projectId: null,
      dimension: "parameter",
      windowStart: "2026-06-07T00:00:00Z",
      windowEnd: "2026-07-07T00:00:00Z"
    });
    expect(groups).toEqual([]);
  });
});
