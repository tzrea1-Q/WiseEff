import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../../shared/database/client";
import { createParameterModule } from "../../parameters/parameterModuleRepository";
import { curateReviewedSeedPlacementCapacity } from "./placementCapacity";

describe("seed business placement", () => {
  let database: EphemeralTestDatabase;
  let db: RootDatabase;
  beforeAll(async () => {
    database = await createEphemeralTestDatabase("seedcapacity");
    db = createPostgresDatabase(database.url);
    await db.query(`insert into organizations (id,name) values ('capacity-a','A'),('capacity-b','B'),('capacity-old','Old'),('capacity-root','Root')`);
  });
  afterAll(async () => { await db?.close(); await database?.drop(); });

  it("reuses an existing business category without creating a driver slot", async () => {
    const business = await createParameterModule(db, { organizationId: "capacity-a", name: "Existing business", kind: "business", origin: "curated" });
    const before = await db.query("select * from parameter_modules where organization_id='capacity-a' order by id");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(await curateReviewedSeedPlacementCapacity(db, { organizationId: "capacity-a" })).toEqual({ businessModuleId: business.id, created: [] });
      expect((await db.query("select * from parameter_modules where organization_id='capacity-a' order by id")).rows).toEqual(before.rows);
    }
  });

  it("creates one business category per organization and reuses it", async () => {
    const first = await curateReviewedSeedPlacementCapacity(db, { organizationId: "capacity-b" });
    expect(first.created).toEqual([first.businessModuleId]);
    expect((await db.query("select kind from parameter_modules where organization_id='capacity-b'")).rows).toEqual([{ kind: "business" }]);
    expect(await curateReviewedSeedPlacementCapacity(db, { organizationId: "capacity-b" })).toEqual({ ...first, created: [] });
  });

  it("reuses an existing unclassified root without creating a category", async () => {
    await db.query("insert into parameter_modules (id,organization_id,name,path,kind,origin) values ('capacity-root-module','capacity-root','未分类','capacity-root-module','unclassified','auto')");
    expect(await curateReviewedSeedPlacementCapacity(db, { organizationId: "capacity-root" }))
      .toEqual({ businessModuleId: "capacity-root-module", created: [] });
  });

  it("preserves legacy driver slots without adopting, renaming or reclassifying them", async () => {
    const legacy = await createParameterModule(db, { organizationId: "capacity-old", name: "Seed placement capacity", kind: "driver-group", origin: "curated" });
    const before = await db.query("select * from parameter_modules where id=$1", [legacy.id]);
    const result = await curateReviewedSeedPlacementCapacity(db, { organizationId: "capacity-old" });
    expect(result.created).toEqual([result.businessModuleId]);
    expect((await db.query("select * from parameter_modules where id=$1", [legacy.id])).rows).toEqual(before.rows);
    expect(await curateReviewedSeedPlacementCapacity(db, { organizationId: "capacity-old" })).toEqual({ ...result, created: [] });
  });
});
