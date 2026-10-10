import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase,
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("retained overlay migration constraints", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen" }],
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("allows historical drafts but rejects a second case-insensitive active overlay", async () => {
    await db.query(
      `insert into driver_schema_overlays
        (id, organization_id, compatible, display_name, lifecycle, version)
       values ('ods-draft-a','org-1','vendor,same','A','draft',1),
              ('ods-draft-b','org-1','Vendor,SAME','B','draft',1)`,
    );
    await db.query("update driver_schema_overlays set lifecycle = 'active' where id = 'ods-draft-a'");
    await expect(db.transaction((tx) => tx.query(
      "update driver_schema_overlays set lifecycle = 'active' where id = 'ods-draft-b'",
    ))).rejects.toMatchObject({ code: "23505" });
    const rows = await db.query<{ id: string; lifecycle: string }>(
      "select id, lifecycle from driver_schema_overlays where organization_id = 'org-1' order by id",
    );
    expect(rows.rows).toEqual([
      { id: "ods-draft-a", lifecycle: "active" },
      { id: "ods-draft-b", lifecycle: "draft" },
    ]);
  });
});
