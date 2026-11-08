import { describe, expect, it } from "vitest";
import { applyMigrations, migrationsDir, withTempDatabase } from "../tempDatabase";
import { readCanonicalSchemaFingerprint, S2_SCH_0335_FINGERPRINT } from "./database";

describe("compatible delimiter-space forward migration", () => {
  it("preserves historical 0335 and changes only the exact SQL predicate", async () => {
    await withTempDatabase({ prefix: "compatible_spaces", migrate: false }, async ({ db, connectionString }) => {
      await applyMigrations(db, migrationsDir, { through: "0335_module_structure_driver_publications.sql" });
      const beforeFingerprint = await readCanonicalSchemaFingerprint(connectionString);
      expect(beforeFingerprint).toBe(S2_SCH_0335_FINGERPRINT);
      const signature = "parameter_catalog.is_canonical_compatible_selector(text)";
      const definition = async () => (await db.query<{ sql: string }>(
        "select pg_get_functiondef($1::regprocedure) as sql", [signature])).rows[0]!.sql;
      const beforeDefinition = await definition();
      const check = async (value: string): Promise<boolean> => (await db.query<{ valid: boolean }>(
        "select parameter_catalog.is_canonical_compatible_selector($1) as valid", [value])).rows[0]!.valid;
      expect(await check("huawei, wireless_aux_tx")).toBe(false);
      expect(await check("huawei,wireless_aux_tx")).toBe(true);

      await applyMigrations(db, migrationsDir, { through: "0336_compatible_vendor_comma_spaces.sql" });
      expect(await definition()).not.toBe(beforeDefinition);
      expect(await check("huawei, wireless_aux_tx")).toBe(true);
      expect(await check("huawei,  wireless_aux_tx")).toBe(true);
      expect(await check("huawei,wireless_aux_tx")).toBe(true);
      for (const value of [" huawei,wireless_aux_tx", "huawei ,wireless_aux_tx", "huawei,wireless aux_tx",
        "huawei,wireless_aux_tx ", "huawei,\tdevice", "huawei,*", "huawei,wireless_aux_tx,other"]) {
        expect(await check(value), value).toBe(false);
      }
      expect(await readCanonicalSchemaFingerprint(connectionString)).not.toBe(beforeFingerprint);

      // Restore the original function body inside the disposable DB to prove
      // there were no other Catalog schema changes in this migration.
      await db.query(beforeDefinition);
      expect(await readCanonicalSchemaFingerprint(connectionString)).toBe(beforeFingerprint);
    });
  }, 120_000);
});
