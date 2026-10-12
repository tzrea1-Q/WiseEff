import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../../shared/database/client";
import { createParameterModule, updateParameterModule } from "../../parameters/parameterModuleRepository";
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

  it("creates a Chinese-named dedicated driver slot, then renames it in place idempotently", async () => {
    const native = await createParameterModule(db, { organizationId: "capacity-a", name: "Native driver",
      kind: "driver-group", origin: "auto", sourceKey: "compatible:example,native" });
    const business = await createParameterModule(db, { organizationId: "capacity-a", name: "Existing business",
      kind: "business", origin: "curated" });
    const result = await curateReviewedSeedPlacementCapacity(db, { organizationId: "capacity-a" });
    expect(result.driverGroupModuleId).not.toBe(native.id);
    expect(result.businessModuleId).toBe(business.id);
    expect(result.created).toEqual([result.driverGroupModuleId]);
    expect((await db.query("select name, source_key from parameter_modules where id=$1", [result.driverGroupModuleId])).rows)
      .toEqual([{ name: "默认驱动分组", source_key: "seed-placement-capacity:driver-group" }]);
    await db.query("update parameter_modules set name='Seed placement capacity' where id=$1", [result.driverGroupModuleId]);
    const renamedBefore = await db.query("select * from parameter_modules where id=$1", [result.driverGroupModuleId]);
    expect(await curateReviewedSeedPlacementCapacity(db, { organizationId: "capacity-a" }))
      .toEqual({ ...result, created: [] });
    const renamedAfter = await db.query("select * from parameter_modules where id=$1", [result.driverGroupModuleId]);
    expect(renamedAfter.rows).toEqual([{ ...renamedBefore.rows[0], name: "默认驱动分组",
      updated_at: renamedAfter.rows[0].updated_at }]);
    const before = await db.query("select * from parameter_modules where organization_id='capacity-a' order by id");
    expect(await curateReviewedSeedPlacementCapacity(db, { organizationId: "capacity-a" }))
      .toEqual({ ...result, created: [] });
    expect((await db.query("select * from parameter_modules where organization_id='capacity-a' order by id")).rows)
      .toEqual(before.rows);
    const other = await curateReviewedSeedPlacementCapacity(db, { organizationId: "capacity-b" });
    expect(other.driverGroupModuleId).not.toBe(result.driverGroupModuleId);
    expect(other.created).toHaveLength(2);
    expect((await db.query("select name from parameter_modules where id=$1", [other.driverGroupModuleId])).rows)
      .toEqual([{ name: "默认驱动分组" }]);
  });

  it("preserves an administrator-renamed keyed driver slot byte-for-byte without creating duplicates", async () => {
    await db.query("insert into organizations (id,name) values ('capacity-custom','Custom')");
    const driver = await createParameterModule(db, { organizationId: "capacity-custom", name: "默认驱动分组",
      kind: "driver-group", origin: "curated", sourceKey: "seed-placement-capacity:driver-group" });
    const business = await createParameterModule(db, { organizationId: "capacity-custom", name: "Existing business",
      kind: "business", origin: "curated" });
    await updateParameterModule(db, { organizationId: "capacity-custom", moduleId: driver.id, name: "充电驱动分组" });
    const snapshot = () => db.query<{ snapshot: string }>(
      "select row_to_json(module)::text as snapshot from parameter_modules module where organization_id='capacity-custom' order by id"
    );
    const before = await snapshot();
    expect(before.rows).toHaveLength(2);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(await curateReviewedSeedPlacementCapacity(db, { organizationId: "capacity-custom" }))
        .toEqual({ driverGroupModuleId: driver.id, businessModuleId: business.id, created: [] });
      expect((await snapshot()).rows).toEqual(before.rows);
    }
  });

  it("upgrades the earlier operator's unkeyed English slot in place without duplicates", async () => {
    const existing = await createParameterModule(db, { organizationId: "capacity-old", name: "Seed placement capacity",
      kind: "driver-group", origin: "curated" });
    const before = await db.query("select * from parameter_modules where id=$1", [existing.id]);
    const result = await curateReviewedSeedPlacementCapacity(db, { organizationId: "capacity-old" });
    expect(result.driverGroupModuleId).toBe(existing.id);
    expect(result.created).toEqual([result.businessModuleId]);
    const after = await db.query("select * from parameter_modules where id=$1", [existing.id]);
    expect(after.rows).toEqual([{ ...before.rows[0], name: "默认驱动分组",
      source_key: "seed-placement-capacity:driver-group", updated_at: after.rows[0].updated_at }]);
    const modules = await db.query("select * from parameter_modules where organization_id='capacity-old' order by id");
    expect(modules.rows).toHaveLength(2);
    expect(await curateReviewedSeedPlacementCapacity(db, { organizationId: "capacity-old" }))
      .toEqual({ ...result, created: [] });
    expect((await db.query("select * from parameter_modules where organization_id='capacity-old' order by id")).rows)
      .toEqual(modules.rows);
  });

  it.each([
    { id: "wrong-kind", kind: "business", origin: "curated", sourceKey: null },
    { id: "auto-origin", kind: "driver-group", origin: "auto", sourceKey: null },
    { id: "other-source", kind: "driver-group", origin: "curated", sourceKey: "compatible:example,other" },
    { id: "keyed-wrong-kind", kind: "business", origin: "curated", sourceKey: "seed-placement-capacity:driver-group" },
    { id: "keyed-auto-origin", kind: "driver-group", origin: "auto", sourceKey: "seed-placement-capacity:driver-group" },
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
