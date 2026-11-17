import { describe, expect, it } from "vitest";
import { applyMigrations, migrationsDir, withTempDatabase } from "../tempDatabase";
import { readCanonicalSchemaFingerprint, S2_SCH_0337_FINGERPRINT, S2_SCH_0338_FINGERPRINT } from "./database";

describe("long vendor property-key forward migration", () => {
  it("changes only the property predicate and preserves function ownership and privileges", async () => {
    await withTempDatabase({ prefix: "long_property_key", migrate: false }, async ({ db, connectionString }) => {
      await applyMigrations(db, migrationsDir, { through: "0337_compatible_multi_comma.sql" });
      expect(await readCanonicalSchemaFingerprint(connectionString)).toBe(S2_SCH_0337_FINGERPRINT);
      const signature = "parameter_catalog.is_canonical_property_key(text)";
      const definition = async () => (await db.query<{ sql: string }>(
        "select pg_get_functiondef($1::regprocedure) as sql", [signature],
      )).rows[0]!.sql;
      const metadata = async () => (await db.query(
        `select proowner, proacl::text, provolatile, proisstrict, prosecdef, proconfig
         from pg_proc where oid = $1::regprocedure`, [signature],
      )).rows[0];
      const beforeDefinition = await definition();
      const beforeMetadata = await metadata();
      const check = async (key: string) => (await db.query<{ valid: boolean }>(
        "select parameter_catalog.is_canonical_property_key($1) as valid", [key],
      )).rows[0]!.valid;
      expect(await check("support_sink_hiz_switch_from_rsc")).toBe(false);

      await applyMigrations(db, migrationsDir, { through: "0338_long_catalog_property_keys.sql" });
      expect(await definition()).not.toBe(beforeDefinition);
      expect(await metadata()).toEqual(beforeMetadata);
      for (const key of ["support_sink_hiz_switch_from_rsc", "adapter_protocol_ic_sysfs_support",
        "clear_water_intrused_flag_after_read", "a".repeat(64)]) {
        expect(await check(key), key).toBe(true);
      }
      for (const key of ["a".repeat(65), "STATUS", "#custom", "bad/property", "bad key", "véndor,key"]) {
        expect(await check(key), key).toBe(false);
      }
      expect(await readCanonicalSchemaFingerprint(connectionString)).toBe(S2_SCH_0338_FINGERPRINT);

      // Restore only this function in the disposable database. The entire old
      // six-category fingerprint must return, detecting any unrelated change.
      await db.query(beforeDefinition);
      expect(await readCanonicalSchemaFingerprint(connectionString)).toBe(S2_SCH_0337_FINGERPRINT);
    });
  }, 120_000);
});
