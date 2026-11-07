import { describe, expect, it } from "vitest";
import { applyMigrations, migrationsDir, withTempDatabase } from "../tempDatabase";
import { readCanonicalSchemaFingerprint, S2_SCH_0333_FINGERPRINT, S2_SCH_LIVE_FINGERPRINT } from "./database";

describe("user import receipt Catalog inventory migration", () => {
  it("changes only the expected organization-deletion inventory entry in the Catalog fingerprint", async () => {
    await withTempDatabase({ prefix: "receipt_catalog", migrate: false }, async ({ db, connectionString }) => {
      await applyMigrations(db, migrationsDir, { through: "0333_organization_subject_owners.sql" });
      expect(await readCanonicalSchemaFingerprint(connectionString)).toBe(S2_SCH_0333_FINGERPRINT);
      const definition = async () => (await db.query<{ sql: string }>("select pg_get_functiondef('parameter_catalog.preview_organization_deletion_0276(text,text)'::regprocedure) as sql")).rows[0].sql;
      const before = await definition();
      await applyMigrations(db, migrationsDir, { through: "0334_user_import_receipts.sql" });
      const after = await definition();
      const needle = "for target in select * from (values";
      expect(before).toContain(needle);
      expect(after).toBe(before.replace(needle, `${needle}\n    ('public.user_import_receipts','accounts','r.organization_id=$1'),`));
      // Restoring only the previous function must restore the entire old Catalog
      // fingerprint; this detects any unrelated schema change in this migration.
      await db.query(before);
      expect(await readCanonicalSchemaFingerprint(connectionString)).toBe(S2_SCH_0333_FINGERPRINT);
      await db.query(after);
      expect(await readCanonicalSchemaFingerprint(connectionString)).toBe(S2_SCH_LIVE_FINGERPRINT);
    });
  }, 120_000);
});
