import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../../shared/database/client";
import { createParameterModule } from "../../parameters/parameterModuleRepository";
import { curateReviewedSeedPlacementCapacity } from "./placementCapacity";

describe("reviewed seed placement capacity", () => {
  let database: EphemeralTestDatabase;
  let db: RootDatabase;
  beforeAll(async () => {
    database = await createEphemeralTestDatabase("seedcapacity");
    db = createPostgresDatabase(database.url);
    await db.query(`insert into organizations (id,name) values
      ('capacity-a','A'),('capacity-b','B'),('capacity-old','Old')`);
  });
  afterAll(async () => { await db?.close(); await database?.drop(); });

  it("adds a dedicated driver slot despite a free native slot, then reuses it without writes", async () => {
    const native = await createParameterModule(db, { organizationId: "capacity-a", name: "Native driver",
      kind: "driver-group", origin: "auto", sourceKey: "compatible:example,native" });
    const business = await createParameterModule(db, { organizationId: "capacity-a", name: "Existing business",
      kind: "business", origin: "curated" });
    const result = await curateReviewedSeedPlacementCapacity(db, { organizationId: "capacity-a" });
    expect(result.driverGroupModuleId).not.toBe(native.id);
    expect(result.businessModuleId).toBe(business.id);
    expect(result.created).toEqual([result.driverGroupModuleId]);
    await db.query("update parameter_modules set name='Renamed reviewed capacity' where id=$1", [result.driverGroupModuleId]);
    const before = await db.query("select * from parameter_modules where organization_id='capacity-a' order by id");
    expect(await curateReviewedSeedPlacementCapacity(db, { organizationId: "capacity-a" }))
      .toEqual({ ...result, created: [] });
    expect((await db.query("select * from parameter_modules where organization_id='capacity-a' order by id")).rows)
      .toEqual(before.rows);
    const other = await curateReviewedSeedPlacementCapacity(db, { organizationId: "capacity-b" });
    expect(other.driverGroupModuleId).not.toBe(result.driverGroupModuleId);
    expect(other.created).toHaveLength(2);
  });

  it("reuses the earlier operator's unkeyed dedicated slot without modifying it", async () => {
    const existing = await createParameterModule(db, { organizationId: "capacity-old", name: "Seed placement capacity",
      kind: "driver-group", origin: "curated" });
    const before = await db.query("select * from parameter_modules where id=$1", [existing.id]);
    const result = await curateReviewedSeedPlacementCapacity(db, { organizationId: "capacity-old" });
    expect(result.driverGroupModuleId).toBe(existing.id);
    expect(result.created).toEqual([result.businessModuleId]);
    expect((await db.query("select * from parameter_modules where id=$1", [existing.id])).rows).toEqual(before.rows);
  });

  it.each([
    { id: "wrong-kind", kind: "business", origin: "curated", sourceKey: null },
    { id: "auto-origin", kind: "driver-group", origin: "auto", sourceKey: null },
    { id: "other-source", kind: "driver-group", origin: "curated", sourceKey: "compatible:example,other" },
    { id: "keyed-wrong-kind", kind: "business", origin: "curated", sourceKey: "seed-placement-capacity:driver-group" },
  ] as const)("refuses $id without reclassifying existing structure", async ({ id, ...fields }) => {
    await db.query("insert into organizations (id,name) values ($1,$1)", [id]);
    const existing = await createParameterModule(db, { organizationId: id, name: "Seed placement capacity", ...fields });
    const before = await db.query("select * from parameter_modules where id=$1", [existing.id]);
    await expect(curateReviewedSeedPlacementCapacity(db, { organizationId: id }))
      .rejects.toThrow("seed-rebuild-placement-capacity-conflict");
    expect((await db.query("select * from parameter_modules where organization_id=$1", [id])).rows)
      .toEqual(before.rows);
  });
});
