import { describe, expect, it } from "vitest";
import { createPostgresDatabase } from "../server/shared/database/client";
import { createEphemeralTestDatabase } from "../server/testing/testDatabase";
import { syncVendorPropertyDocs } from "./sync-vendor-property-docs";
import { compileConstrainedVendorCatalogSuccessor } from "./compile-vendor-catalog-release";

import { isSyncableVendorProperty } from "./sync-vendor-property-docs";

describe("syncVendorPropertyDocs", () => {
  it("installs vendor documentation as immutable canonical Definition revisions, idempotently", async () => {
    const database = await createEphemeralTestDatabase("vendordocs");
    const db = createPostgresDatabase(database.url);
    try {
      const updated = await syncVendorPropertyDocs(db);
      expect(updated).toBeGreaterThan(0);
      const snapshot = async () => (await db.query(`select id, content->'documentation' as documentation, content_digest
        from parameter_catalog.definition_revisions order by id`)).rows;
      const first = await snapshot();
      const vendor = compileConstrainedVendorCatalogSuccessor();
      const definition = vendor.bundle.releases.at(-1)!.documents.find((item) =>
        item.kind === "definition" && item.content.id === "pdef_drv_huawei_bypass_bst_hl7603_const_vout");
      expect(definition).toBeDefined();
      if (!definition || definition.kind !== "definition") throw new Error("Vendor fixture Definition missing");
      expect(first).toContainEqual(expect.objectContaining({
        id: definition.content.revision.id, documentation: definition.content.revision.documentation,
      }));
      expect(await syncVendorPropertyDocs(db)).toBe(updated);
      expect(await snapshot()).toEqual(first);
      expect((await db.query("select count(*)::int as count from parameter_specs")).rows).toEqual([{ count: 0 }]);
    } finally {
      await db.close();
      await database.drop();
    }
  });
  it("excludes structural DTS properties from parameter definitions", () => {
    expect(isSyncableVendorProperty({ propertyKey: "status" })).toBe(false);
    expect(isSyncableVendorProperty({ propertyKey: "compatible" })).toBe(false);
    expect(isSyncableVendorProperty({ propertyKey: "#address-cells" })).toBe(false);
    expect(isSyncableVendorProperty({ propertyKey: "gpio_int" })).toBe(true);
  });
});
