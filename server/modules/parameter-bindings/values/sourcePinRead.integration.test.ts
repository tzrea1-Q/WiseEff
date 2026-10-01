import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createManagedInstanceTestDatabase } from "../../../testing/testDatabase";
import { createPostgresDatabase } from "../../../shared/database/client";
import { seedCanonicalParameterFixture } from "../../dts-reload/testing/canonicalReloadFixture";
import { createLocalObjectStore } from "../../logs/objectStore";
import { loadOwnedProjectValueSourcePin } from "./index";

describe("Value owner exact source-pin read", () => {
  it("holds SHARE on the caller transaction independently of any source-cohort lock", async () => {
    const database = await createManagedInstanceTestDatabase("898pin");
    const db = createPostgresDatabase(database.url);
    const directory = await mkdtemp(join(tmpdir(), "wiseeff-898-source-pin-"));
    try {
      // Setup uses the fixture administrator. The read/lock proof uses the
      // existing non-superuser table owner, not an API or deployment LOGIN.
      const fixture = await seedCanonicalParameterFixture(db, createLocalObjectStore(directory));
      const scope = { organizationId: fixture.organizationId, projectId: fixture.projectId,
        bindingId: fixture.bindingId, projectValueId: fixture.currentValueId };
      const before = await loadOwnedProjectValueSourcePin(db, scope);
      expect(before).not.toBeNull();
      await db.transaction(async (tx) => {
        await tx.query("set local role catalog_migration_owner");
        expect((await tx.query<{ currentUser: string; superuser: boolean }>(
          `select current_user as "currentUser",rolsuper as superuser from pg_roles where rolname=current_user`,
        )).rows[0]).toEqual({ currentUser: "catalog_migration_owner", superuser: false });
        expect(await loadOwnedProjectValueSourcePin({ query: tx.query }, { ...scope, lock: true })).toEqual(before);
        await expect(db.transaction(async (rival) => {
          await rival.query("set local role catalog_migration_owner");
          await rival.query("set local lock_timeout = '100ms'");
          await rival.query(`select id from parameter_catalog.project_value_source_pins
            where id=$1 and organization_id=$2 and project_id=$3 for update`,
          [before!.sourcePinId, scope.organizationId, scope.projectId]);
        })).rejects.toMatchObject({ code: "55P03" });
        expect(await loadOwnedProjectValueSourcePin(tx, { ...scope, organizationId: fixture.otherOrganizationId })).toBeNull();
        expect(await loadOwnedProjectValueSourcePin(tx, { ...scope, projectId: fixture.otherProjectId })).toBeNull();
        expect(await loadOwnedProjectValueSourcePin(tx, { ...scope, projectValueId: "missing-value" })).toBeNull();
      });
      expect(await loadOwnedProjectValueSourcePin(db, scope)).toEqual(before);
    } finally {
      await db.close();
      await database.drop();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
