import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { createPostgresDatabase } from "../shared/database/client";
import { quoteIdent } from "../modules/catalog-kernel/security/catalogRoleManifest";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins, revokeForeignTestRuntimeGrants } from "./labRuntimeLogins";
import { dropLabRuntimeLogins as dropViaBarrel, provisionPublicationRuntimeLogins as provisionViaBarrel } from "../modules/catalog-publication/runtime";
import { applyTestMigrations, migrationsDir, withAdminClient } from "./tempDatabase";
import { createEphemeralTestDatabase, isGeneratedTestDatabaseName, isTestDatabaseAvailable, TEMPLATE_BUILD_LOCK, withTestClusterRoleCatalogLock } from "./testDatabase";

const available = await isTestDatabaseAvailable();

it("routes transitive runtime exports through cleanup and excludes application database names", () => {
  expect(dropViaBarrel).toBe(dropLabRuntimeLogins);
  for (const name of ["postgres", "wiseeff", "wiseeff_remediation", "wiseeff_production", "wiseeff_test_wk_unknown"]) {
    expect(isGeneratedTestDatabaseName(name)).toBe(false);
  }
  expect(isGeneratedTestDatabaseName("wiseeff_cleanup_acl_upgrade_1729080000000_12345")).toBe(true);
});

describe.skipIf(!available)("lab runtime role isolation", () => {
  it("borrows the active outer lease for default provision and cleanup without releasing it", async () => {
    const source = await createEphemeralTestDatabase("borrowrole");
    const token = `borrowrole${randomBytes(5).toString("hex")}`;
    try {
      await withTestClusterRoleCatalogLock(async () => {
        await provisionViaBarrel(source.url, { mode: "lab", runToken: token });
        await withAdminClient(async (observer) => {
          expect((await observer.query("select pg_try_advisory_lock($1) as acquired", [4_201_659])).rows).toEqual([{ acquired: false }]);
        });
        expect((await dropViaBarrel(source.url, token)).failed).toEqual([]);
        await expect(withTestClusterRoleCatalogLock(async () => undefined)).rejects.toThrow("Nested test cluster role catalog lease");
        await withAdminClient(async (observer) => {
          expect((await observer.query("select pg_try_advisory_lock($1) as acquired", [4_201_659])).rows).toEqual([{ acquired: false }]);
        });
      });
      await expect(withTestClusterRoleCatalogLock(async () => "released")).resolves.toBe("released");
    } finally {
      try { expect((await dropLabRuntimeLogins(source.url, token)).failed).toEqual([]); }
      finally { await source.drop(); }
    }
  });

  it("prevents a concurrent template clone from copying a grant after the cleanup snapshot", async () => {
    const source = await createEphemeralTestDatabase("cloneacl");
    const token = `cloneacl${randomBytes(5).toString("hex")}`;
    const runtime = await provisionPublicationRuntimeLogins(source.url, { mode: "lab", runToken: token });
    const fingerprint = new URL(source.url).pathname.match(/_([a-f0-9]{12})_[a-z0-9]+_e/)![1];
    const templateUrl = new URL(source.url);
    templateUrl.pathname = `/${process.env.WISEEFF_TEST_DATABASE_PREFIX?.trim() || "wiseeff"}_test_tpl_${fingerprint}`;
    const template = createPostgresDatabase(templateUrl.href);
    await template.query(`grant execute on function parameter_catalog.preview_parameter_definition_purge(text) to ${quoteIdent(runtime.apiRole)}`);
    await template.close();
    let reached!: () => void, release!: () => void;
    const snapshot = new Promise<void>((resolve) => { reached = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    const original = pg.Client.prototype.query;
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: unknown[]) {
      const [sql] = args;
      const result = Reflect.apply(original, this, args);
      return typeof sql === "string" && sql.includes("select distinct database.datname as database")
        ? result.then(async (value: unknown) => { reached(); await resume; return value; })
        : result;
    } as typeof original);
    let clone: ReturnType<typeof createEphemeralTestDatabase> | undefined;
    const cleanup = withTestClusterRoleCatalogLock(() => revokeForeignTestRuntimeGrants(source.url, [runtime.apiRole], runtime.ownershipComment));
    try {
      await snapshot;
      let cloned = false;
      clone = createEphemeralTestDatabase("copyacl").then((database) => { cloned = true; return database; });
      await withAdminClient(async (observer) => {
        await vi.waitFor(async () => {
          const waiting = await observer.query(`select 1 from pg_locks where locktype = 'advisory'
            and database = (select oid from pg_database where datname = 'postgres')
            and classid = 0 and objid = $1 and objsubid = 1 and not granted`, [TEMPLATE_BUILD_LOCK]);
          expect(cloned || waiting.rows.length > 0).toBe(true);
        });
      });
      release();
      await cleanup;
      const copied = createPostgresDatabase((await clone).url);
      try {
        expect((await copied.query<{ allowed: boolean }>(
          "select has_function_privilege($1, 'parameter_catalog.preview_parameter_definition_purge(text)', 'EXECUTE') as allowed", [runtime.apiRole]
        )).rows[0].allowed).toBe(false);
      } finally { await copied.close(); }
      expect((await dropLabRuntimeLogins(source.url, token)).failed).toEqual([]);
    } finally {
      release();
      spy.mockRestore();
      await cleanup;
      await (await clone)?.drop();
      expect((await dropLabRuntimeLogins(source.url, token)).failed).toEqual([]);
      await source.drop();
    }
  });

  it.each(["before", "after"])("drops owned runtime roles %s their database without hiding unrelated dependencies", async (dropOrder) => {
    const source = await createEphemeralTestDatabase("labsource");
    const upgrading = await createEphemeralTestDatabase("labupgrade");
    const upgradedDb = createPostgresDatabase(upgrading.url);
    const token = `isolation${randomBytes(5).toString("hex")}`;
    let runtime: Awaited<ReturnType<typeof provisionPublicationRuntimeLogins>> | undefined;
    try {
      runtime = await provisionPublicationRuntimeLogins(source.url, { mode: "lab", runToken: token });
      expect((await upgradedDb.query<{ allowed: boolean }>(
        "select has_table_privilege($1, 'public.log_domains', 'INSERT') as allowed", [runtime.apiRole]
      )).rows[0].allowed).toBe(false);
      expect((await upgradedDb.query<{ allowed: boolean }>(
        "select has_function_privilege($1, 'parameter_catalog.preview_parameter_definition_purge(text)', 'EXECUTE') as allowed", [runtime.apiRole]
      )).rows[0].allowed).toBe(false);
      await upgradedDb.query("delete from schema_migrations where name = '0257_definition_erasure_writer_runtime_grants.sql'");
      await applyTestMigrations(upgradedDb, migrationsDir);
      const functionPrivilege = async (role: string) => (await upgradedDb.query<{ allowed: boolean }>(
        "select has_function_privilege($1, 'parameter_catalog.preview_parameter_definition_purge(text)', 'EXECUTE') as allowed", [role]
      )).rows[0].allowed;
      const upgradeRoutines = [
        "reserve_parameter_object_write(text,text)", "lock_parameter_object_write(text)",
        "organization_parameter_archives(text,text,text)", "purge_organization_parameter_assets(text,text,text)",
        "organization_parameter_pending_objects(text,text,text)", "finish_organization_parameter_object(text,text,text,text,text,boolean)",
        "lock_definition_erasure_object(text,text,text)", "list_platform_definition_erasures()",
        "source_origin_matches(text,text,text)", "source_member_is_restored(text,text)",
        "source_anchor_restoration_matches(text,text,text,text)",
      ].map(routine => `parameter_catalog.${routine}`);
      for (const routine of upgradeRoutines) {
        await upgradedDb.query(`grant execute on function ${routine} to ${quoteIdent(runtime.apiRole)}`);
      }
      const upgradePrivileges = async () => (await upgradedDb.query<{ allowed: boolean }>(
        "select has_function_privilege($1, routine, 'EXECUTE') as allowed from unnest($2::text[]) routine",
        [runtime!.apiRole, upgradeRoutines],
      )).rows.map(row => row.allowed);
      await upgradedDb.query(`create function parameter_catalog.unreviewed_runtime_cleanup() returns void language sql as $$ select $$;
        revoke all on function parameter_catalog.unreviewed_runtime_cleanup() from public;
        grant execute on function parameter_catalog.unreviewed_runtime_cleanup() to ${quoteIdent(runtime.apiRole)}`);
      expect(await functionPrivilege(runtime.apiRole)).toBe(true);
      await upgradedDb.query(`grant select on organizations to ${quoteIdent(runtime.apiRole)};
        grant execute on function parameter_catalog.preview_parameter_definition_purge(text) to ${quoteIdent(runtime.workerRole)}`);
      await withTestClusterRoleCatalogLock(() => revokeForeignTestRuntimeGrants(source.url, [runtime!.apiRole], `${runtime!.ownershipComment}other`));
      expect(await functionPrivilege(runtime.apiRole)).toBe(true);
      expect(await upgradePrivileges()).toEqual(upgradeRoutines.map(() => true));
      await withTestClusterRoleCatalogLock(() => revokeForeignTestRuntimeGrants(source.url, [runtime!.apiRole], runtime!.ownershipComment));
      expect(await functionPrivilege(runtime.apiRole)).toBe(false);
      expect(await upgradePrivileges()).toEqual(upgradeRoutines.map(() => false));
      expect((await upgradedDb.query<{ allowed: boolean }>(
        "select has_function_privilege($1, 'parameter_catalog.unreviewed_runtime_cleanup()', 'EXECUTE') as allowed", [runtime.apiRole]
      )).rows[0].allowed).toBe(true);
      expect(await functionPrivilege(runtime.workerRole)).toBe(true);
      expect((await upgradedDb.query<{ allowed: boolean }>(
        "select has_table_privilege($1, 'organizations', 'SELECT') as allowed", [runtime.apiRole]
      )).rows[0].allowed).toBe(true);
      if (dropOrder === "after") {
        await source.drop();
        await withTestClusterRoleCatalogLock(() => withAdminClient(async (admin) => {
          await expect(admin.query(`drop role ${quoteIdent(runtime!.apiRole)}`)).rejects.toMatchObject({ code: "2BP01" });
        }));
      } else {
        expect((await dropLabRuntimeLogins(source.url, token)).failed).toEqual([runtime.apiRole]);
      }
      await upgradedDb.query(`revoke select on organizations from ${quoteIdent(runtime.apiRole)};
        revoke execute on function parameter_catalog.unreviewed_runtime_cleanup() from ${quoteIdent(runtime.apiRole)}`);
      if (dropOrder === "after") {
        await withTestClusterRoleCatalogLock(() => withAdminClient(async (admin) => {
          const roles = [runtime!.apiRole, runtime!.workerRole, runtime!.managerRole];
          const adminUrl = new URL(source.url); adminUrl.pathname = "/postgres";
          await revokeForeignTestRuntimeGrants(adminUrl.href, roles, runtime!.ownershipComment);
          for (const role of roles) await expect(admin.query(`drop role ${quoteIdent(role)}`)).resolves.toMatchObject({ command: "DROP" });
        }));
      } else {
        expect((await dropLabRuntimeLogins(source.url, token)).failed).toEqual([]);
      }
    } finally {
      await upgradedDb.close();
      await upgrading.drop();
      await source.drop();
      if (runtime) await withTestClusterRoleCatalogLock(() => withAdminClient(async (admin) => {
        for (const role of [runtime!.apiRole, runtime!.workerRole, runtime!.managerRole]) {
          const owned = await admin.query("select 1 from pg_roles where rolname = $1 and shobj_description(oid, 'pg_authid') = $2", [role, runtime!.ownershipComment]);
          if (owned.rows.length) await admin.query(`drop role ${quoteIdent(role)}`);
        }
      }));
    }
  });
});
