import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { applyMigrations, migrationsDir, withTempDatabase } from "../../../testing/tempDatabase";
import { withTestClusterRoleCatalogLock } from "../../../testing/testDatabase";
import { readCanonicalSchemaFingerprint, S2_SCH_0181_FINGERPRINT, S2_SCH_LIVE_FINGERPRINT } from "../../../testing/parameterCatalog";
import { readRetainedDismissedCompatibleIdentities } from "./retainedDismissedIdentities";

const capability = "catalog_legacy_identity_reader_role";
const functionIdentity = "parameter_catalog.list_retained_dismissed_compatible_identities(text)";

describe("retained historical identity owner / PostgreSQL capability", () => {
  it("upgrades retained rows without changing old receipts, and reads all 202 through a non-superuser capability", async () => {
    await withTestClusterRoleCatalogLock(() => withTempDatabase({ prefix: "retainedids", migrate: false }, async ({ db, connectionString }) => {
      await applyMigrations(db, migrationsDir, { through: "0181_mod_d02_capture_revalidation.sql" });
      expect(await readCanonicalSchemaFingerprint(connectionString)).toBe(S2_SCH_0181_FINGERPRINT);
      const oldReceipts = (await db.query("select name, checksum from schema_migrations order by name")).rows;
      await db.query("insert into organizations (id, name) values ('identity-org-a', 'A'), ('identity-org-b', 'B')");
      await db.query(`insert into public.parameter_module_dismissed_compatibles (id, organization_id, compatible)
        select 'historical-' || lpad(n::text, 3, '0'), 'identity-org-a', 'Vendor,Device-' || n from generate_series(0,200) n`);
      await db.query(`insert into public.parameter_module_dismissed_compatibles (id, organization_id, compatible)
        values ('historical-other-org', 'identity-org-b', 'Vendor,Device-200')`);
      const snapshot = async () => (await db.query(`select
        (select jsonb_agg(to_jsonb(h) order by id) from public.parameter_module_dismissed_compatibles h) as identities,
        (select jsonb_agg(to_jsonb(o) order by id) from public.organizations o) as organizations,
        (select count(*)::int from public.audit_events) as audits`)).rows;
      const before = await snapshot();
      await db.query(`grant select on public.parameter_module_dismissed_compatibles to ${capability}`);
      await expect(applyMigrations(db, migrationsDir)).rejects.toThrow("unapproved pre-existing capabilities");
      await db.query(`revoke select on public.parameter_module_dismissed_compatibles from ${capability}`);
      const prebound = `identity_prebound_${process.pid}_${randomBytes(4).toString("hex")}`;
      await db.query(`create role ${prebound} nologin`);
      try {
        await db.query(`grant ${capability} to ${prebound}`);
        await expect(applyMigrations(db, migrationsDir)).rejects.toThrow("unapproved pre-existing capabilities");
      } finally {
        await db.query(`drop role ${prebound}`);
      }
      const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
      await db.query(`grant create on database "${databaseName}" to ${capability}`);
      await expect(applyMigrations(db, migrationsDir)).rejects.toThrow("unapproved pre-existing capabilities");
      await db.query(`revoke create on database "${databaseName}" from ${capability}`);
      await db.query(`alter database "${databaseName}" owner to ${capability}`);
      try {
        await expect(applyMigrations(db, migrationsDir)).rejects.toThrow("unapproved pre-existing capabilities");
      } finally {
        await db.query(`alter database "${databaseName}" owner to current_user`);
      }
      await db.query(`alter default privileges grant select on tables to ${capability}`);
      await expect(applyMigrations(db, migrationsDir)).rejects.toThrow("unapproved pre-existing capabilities");
      await db.query(`alter default privileges revoke select on tables from ${capability}`);
      expect(await applyMigrations(db, migrationsDir)).toEqual(["0182_legacy_dismissed_identity_reader.sql"]);
      expect((await db.query("select name, checksum from schema_migrations where name < '0182' order by name")).rows).toEqual(oldReceipts);
      expect(await snapshot()).toEqual(before);
      const owner = (await db.query<{ owner: string; prosecdef: boolean; provolatile: string; proconfig: string[]; public_execute: boolean }>(`
        select pg_catalog.pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.provolatile, p.proconfig,
          exists(select 1 from pg_catalog.aclexplode(p.proacl) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') as public_execute
        from pg_catalog.pg_proc p where p.oid=$1::regprocedure`, [functionIdentity])).rows[0];
      expect(owner).toEqual({ owner: "catalog_migration_owner", prosecdef: true, provolatile: "s",
        proconfig: ["search_path=pg_catalog, parameter_catalog"], public_execute: false });
      expect((await db.query(`select rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
        from pg_catalog.pg_roles where rolname=$1`, [capability])).rows)
        .toEqual([{ rolcanlogin: false, rolinherit: false, rolsuper: false, rolcreatedb: false,
          rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
      for (const login of ["wiseeff_mod_d02_source_reader", "wiseeff_mod_d02_capture"]) {
        expect((await db.query<{ allowed: boolean }>("select has_function_privilege($1,$2,'EXECUTE') as allowed", [login, functionIdentity])).rows[0]?.allowed).toBe(false);
      }
      expect((await db.query(`select rolname from pg_catalog.pg_roles where rolcanlogin and not rolsuper
        and pg_catalog.pg_has_role(oid, $1, 'MEMBER')`, [capability])).rows).toEqual([]);
      // Membership is an explicit test-only maintenance grant, never a deployed account claim.
      const role = `identity_read_${process.pid}_${randomBytes(4).toString("hex")}`;
      const password = randomBytes(24).toString("hex");
      await db.query(`create role ${role} login password '${password}' inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`);
      const url = new URL(connectionString);
      url.username = role;
      url.password = password;
      const reader = new pg.Client({ connectionString: url.toString() });
      try {
        await reader.connect();
        await expect(readRetainedDismissedCompatibleIdentities(reader, "identity-org-a")).rejects.toMatchObject({ code: "42501" });
        await expect(readRetainedDismissedCompatibleIdentities(reader, "identity-org-b")).rejects.toMatchObject({ code: "42501" });
        await db.query(`grant ${capability} to ${role}`);
        const session = (await reader.query(`select session_user, current_user,
          (select rolsuper from pg_catalog.pg_roles where rolname=current_user) as superuser,
          has_table_privilege(current_user,'public.parameter_module_dismissed_compatibles','SELECT') as direct_select,
          has_any_column_privilege(current_user,'public.parameter_module_dismissed_compatibles','SELECT') as column_select`)).rows[0];
        expect(session).toEqual({ session_user: role, current_user: role, superuser: false, direct_select: false, column_select: false });
        await reader.query("begin read only");
        const first = await readRetainedDismissedCompatibleIdentities(reader, "identity-org-a");
        const second = await readRetainedDismissedCompatibleIdentities(reader, "identity-org-b");
        await reader.query("commit");
        expect(first.map(({ id }) => id)).toEqual(Array.from({ length: 201 }, (_, n) => `historical-${n.toString().padStart(3, "0")}`));
        expect(second).toEqual([{ organizationId: "identity-org-b", id: "historical-other-org", compatible: "Vendor,Device-200" }]);
        expect(first[200]?.compatible).toBe(second[0]?.compatible);
        expect(first.every(({ organizationId }) => organizationId === "identity-org-a")).toBe(true);
        expect(await readRetainedDismissedCompatibleIdentities(reader, "no-retained-rows")).toEqual([]);
        await expect(reader.query(`select * from public.parameter_module_dismissed_compatibles`)).rejects.toMatchObject({ code: "42501" });
        await expect(reader.query(`update public.parameter_module_dismissed_compatibles set compatible=compatible`)).rejects.toMatchObject({ code: "42501" });
        await expect(reader.query(`set role catalog_migration_owner`)).rejects.toMatchObject({ code: "42501" });
        await expect(reader.query("select * from parameter_catalog.list_retained_dismissed_compatible_identities(null)")).rejects.toMatchObject({ code: "22023" });
        await db.query(`revoke ${capability} from ${role}`);
        await expect(readRetainedDismissedCompatibleIdentities(reader, "identity-org-a")).rejects.toMatchObject({ code: "42501" });
        expect(await snapshot()).toEqual(before);
        process.stdout.write(`MOD_IDENTITY_ROLE_EVIDENCE ${JSON.stringify({ ...session, authorizedOrganizations: "explicit all-organization maintenance capability", ids: 202, revoked: "42501", readOnly: true })}\n`);
      } finally {
        await reader.end();
        await db.query(`drop role ${role}`);
      }
      const upgradedFingerprint = await readCanonicalSchemaFingerprint(connectionString);
      expect(upgradedFingerprint).toBe(S2_SCH_LIVE_FINGERPRINT);
      await withTempDatabase({ prefix: "retainedfresh" }, async ({ db: fresh, connectionString: freshUrl }) => {
        expect(await readCanonicalSchemaFingerprint(freshUrl)).toBe(upgradedFingerprint);
        process.stdout.write(`MOD_IDENTITY_SCHEMA_EVIDENCE ${JSON.stringify({ upgradedFingerprint,
          receipts: (await fresh.query("select name, checksum from schema_migrations order by name")).rows })}\n`);
      });
    }));
  }, 60_000);
});
