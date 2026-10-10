import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPostgresDatabase } from "../server/shared/database/client";
import { createEphemeralTestDatabase } from "../server/testing/testDatabase";
import { ensurePublishedVendorCatalog } from "./sync-vendor-property-docs";
import { compileConstrainedVendorCatalogSuccessor } from "./compile-vendor-catalog-release";

describe("ensurePublishedVendorCatalog", () => {
  it("installs vendor documentation as immutable canonical Definition revisions, idempotently", async () => {
    const database = await createEphemeralTestDatabase("vendordocs");
    const db = createPostgresDatabase(database.url);
    try {
      const releaseDefinitionCount = await ensurePublishedVendorCatalog(db);
      expect(releaseDefinitionCount).toBeGreaterThan(0);
      const installedKeys = (await db.query<{ property_key: string }>(
        "select property_key from parameter_catalog.parameter_definitions",
      )).rows.map((definition) => definition.property_key);
      expect(installedKeys).toContain("gpio_int");
      for (const structuralKey of ["status", "compatible", "#address-cells"]) {
        expect(installedKeys).not.toContain(structuralKey);
      }
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
      expect(await ensurePublishedVendorCatalog(db)).toBe(releaseDefinitionCount);
      expect(await snapshot()).toEqual(first);
      expect((await db.query("select count(*)::int as count from parameter_specs")).rows).toEqual([{ count: 0 }]);
    } finally {
      await db.close();
      await database.drop();
    }
  });
  it("reports the release Definition count rather than an update count in CLI output", async () => {
    const database = await createEphemeralTestDatabase("vendorcli");
    const db = createPostgresDatabase(database.url);
    try {
      const run = () => JSON.parse(execFileSync(process.execPath, [
        "--import", "tsx", fileURLToPath(new URL("./sync-vendor-property-docs.ts", import.meta.url)),
      ], {
        env: { ...process.env, DATABASE_URL: database.url },
        encoding: "utf8",
        timeout: 30_000,
      }));
      const output = run();
      const definitions = await db.query<{ count: number }>(
        "select count(*)::int as count from parameter_catalog.catalog_release_definition_heads where release_id = $1",
        [compileConstrainedVendorCatalogSuccessor().compiled.release.id],
      );
      expect(definitions.rows[0]!.count).toBeGreaterThan(0);
      expect(output).toEqual({
        releaseDefinitionCount: definitions.rows[0]!.count,
        sample: { content: expect.objectContaining({ documentation: expect.any(String) }) },
      });
      expect(run()).toEqual(output);
    } finally {
      await db.close();
      await database.drop();
    }
  });
});
