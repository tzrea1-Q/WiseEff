import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSelfHostedPg16Database } from "../../../testing/selfHostedUpgrade/database";
import { createPostgresDatabase, type RootDatabase } from "../../../shared/database/client";
import { applyMigrations } from "../../../shared/database/migrations";
import { createCatalogKernel, CatalogReleaseDigest } from "../interface";
import { installPublishedCatalogChain, X_DEFINITION_ID } from "../runtime/catalogChain.fixture";
import { CATALOG_READER_MIGRATION, CATALOG_READER_ROLE, CATALOG_READER_RELATIONS } from "./catalogReaderManifest";

describe("authorized additive Catalog reader on owned PG16", () => {
  let target: Awaited<ReturnType<typeof createSelfHostedPg16Database>>;
  let admin: RootDatabase;
  let ownerPool: pg.Pool;
  let reader: pg.Pool;
  let denied: pg.Pool;
  let chain: Awaited<ReturnType<typeof installPublishedCatalogChain>>;
  const migrations = path.resolve("server/migrations");
  const password = randomBytes(24).toString("hex");

  beforeAll(async () => {
    target = await createSelfHostedPg16Database("reader");
    admin = createPostgresDatabase(target.url);
    await applyMigrations(admin, migrations, { through: "0138_canonical_parameter_catalog_roles.sql" });
    await admin.query(`create role reader_login login nosuperuser nobypassrls nocreatedb nocreaterole noinherit password '${password}';
      create role denied_login login nosuperuser nobypassrls nocreatedb nocreaterole noinherit password '${password}';`);
    const login = (name: string) => { const url = new URL(target.url); url.username = name; url.password = password; return new pg.Pool({ connectionString: url.href, max: 2 }); };
    reader = login("reader_login"); denied = login("denied_login");
    // This is the actual historical migration boundary, before the new grant.
    await expect(reader.query("select * from parameter_catalog.catalog_state")).rejects.toMatchObject({ code: "42501" });
    await applyMigrations(admin, migrations);
    expect((await admin.query("select name from schema_migrations where name=$1", [CATALOG_READER_MIGRATION])).rows).toHaveLength(1);
    await admin.query(`grant ${CATALOG_READER_ROLE} to reader_login with inherit true, set false, admin false`);
    ownerPool = new pg.Pool({ connectionString: target.url });
    // Real compiler/installer lineage; never INSERT fabricated passed reports.
    chain = await installPublishedCatalogChain(ownerPool);
  });
  afterAll(async () => {
    await reader?.end(); await denied?.end(); await ownerPool?.end(); await admin?.close();
    await target?.close();
  });

  it("uses a restricted LOGIN and exact PG16 membership options", async () => {
    expect((await reader.query(`select session_user as login, current_user as effective,
      rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname=current_user`)).rows)
      .toEqual([{ login: "reader_login", effective: "reader_login", rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false }]);
    expect((await admin.query(`select inherit_option, set_option, admin_option from pg_auth_members
      where roleid=$1::regrole and member='reader_login'::regrole`, [CATALOG_READER_ROLE])).rows)
      .toEqual([{ inherit_option: true, set_option: false, admin_option: false }]);
  });
  it("loads formal current and historical Kernel snapshots and refuses mismatched pins", async () => {
    const kernel = createCatalogKernel(reader);
    const current = await kernel.loadCurrentCatalog(chain.pinC);
    const pinned = await kernel.loadPinnedCatalog(chain.pinA);
    expect(current.ok).toBe(true); expect(pinned.ok).toBe(true);
    if (!current.ok || !pinned.ok) throw new Error("formal reader snapshot unavailable");
    expect(current.value.getDefinitionById(X_DEFINITION_ID as Parameters<typeof current.value.getDefinitionById>[0]).status).toBe("found");
    expect(pinned.value.release.id).toBe(chain.pinA.id);
    expect(await kernel.loadCurrentCatalog(chain.pinA)).toMatchObject({ ok: false, error: { kind: "release-mismatch" } });
    expect(await kernel.loadPinnedCatalog({ ...chain.pinA, digest: CatalogReleaseDigest("sha256:" + "0".repeat(64)) }))
      .toMatchObject({ ok: false, error: { kind: "digest-conflict" } });
    expect((await reader.query("select current_setting('transaction_read_only') as value")).rows).toEqual([{ value: "off" }]);
  });
  it("keeps ungranted production login unable to read any Catalog object", async () => {
    for (const table of CATALOG_READER_RELATIONS) await expect(denied.query(`select * from parameter_catalog.${table} limit 0`)).rejects.toMatchObject({ code: "42501" });
    expect(await createCatalogKernel(denied).loadCurrentCatalog(chain.pinC)).toMatchObject({ ok: false, error: { kind: "storage-failure" } });
  });
  it("grants precisely ten SELECTs, no DML, extra-domain reads or function EXECUTE", async () => {
    const rows = (await admin.query(`select c.relname,
      has_table_privilege($1,c.oid,'SELECT') as can_select,
      has_table_privilege($1,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as can_write
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='parameter_catalog' and c.relkind in ('r','p','v','m') order by c.relname`, [CATALOG_READER_ROLE])).rows;
    expect(rows.filter(row => row.can_select).map(row => row.relname)).toEqual(CATALOG_READER_RELATIONS);
    expect(rows.some(row => row.can_write)).toBe(false);
    for (const row of rows) {
      if (!row.can_select) await expect(reader.query(`select * from parameter_catalog.${row.relname} limit 0`)).rejects.toMatchObject({ code: "42501" });
      const columns = await admin.query<{ attname: string }>(`select attname from pg_attribute
        where attrelid=$1::regclass and attnum>0 and not attisdropped order by attnum limit 1`, [`parameter_catalog.${row.relname}`]);
      const column = pg.escapeIdentifier(columns.rows[0]!.attname);
      for (const sql of [`insert into parameter_catalog.${row.relname} default values`, `update parameter_catalog.${row.relname} set ${column}=${column} where false`, `delete from parameter_catalog.${row.relname} where false`, `truncate parameter_catalog.${row.relname}`]) {
        await expect(reader.query(sql)).rejects.toMatchObject({ code: "42501" });
      }
    }
    expect((await admin.query(`select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='parameter_catalog' and has_function_privilege($1,p.oid,'EXECUTE')`, [CATALOG_READER_ROLE])).rows).toEqual([]);
    for (const sql of ["create table parameter_catalog.forbidden(id int)", "select parameter_catalog.acquire_current_pointer_lock_exclusive()", "select parameter_catalog.assert_catalog_subject_active('x','x','x','x')",
      "update parameter_catalog.catalog_releases set release_version=release_version where false",
      "grant catalog_runtime_reader_role to denied_login"]) await expect(reader.query(sql)).rejects.toMatchObject({ code: "42501" });
  });
  it.each([
    ["LOGIN", `alter role ${CATALOG_READER_ROLE} login`],
    ["BYPASSRLS", `alter role ${CATALOG_READER_ROLE} bypassrls`],
    ["indirect management membership", `create role reader_bridge nologin noinherit; grant catalog_migration_owner to reader_bridge with inherit false; grant reader_bridge to ${CATALOG_READER_ROLE} with inherit false`],
    ["inbound ADMIN", `grant ${CATALOG_READER_ROLE} to denied_login with inherit true,set false,admin true`],
    ["inbound SET", `grant ${CATALOG_READER_ROLE} to denied_login with inherit true,set true,admin false`],
    ["object ownership", `alter table parameter_catalog.catalog_drivers owner to ${CATALOG_READER_ROLE}`],
    ["database ownership", `alter database CURRENT_DATABASE owner to ${CATALOG_READER_ROLE}`],
    ["column ACL", `grant update(current_catalog_release_id) on parameter_catalog.catalog_state to ${CATALOG_READER_ROLE}`],
    ["grant option", `grant select on parameter_catalog.catalog_state to ${CATALOG_READER_ROLE} with grant option`],
    ["governance read", `grant select on parameter_catalog.subject_placements to ${CATALOG_READER_ROLE}`],
    ["function EXECUTE", `grant execute on function parameter_catalog.acquire_current_pointer_lock_exclusive() to ${CATALOG_READER_ROLE}`],
    ["PUBLIC Catalog DML", "grant insert on parameter_catalog.catalog_state to public"],
    ["PUBLIC function", "grant execute on function parameter_catalog.acquire_current_pointer_lock_exclusive() to public"],
    ["PUBLIC column ACL", "grant update(current_catalog_release_id) on parameter_catalog.catalog_state to public"],
    ["PUBLIC future default ACL", "alter default privileges for role catalog_migration_owner in schema parameter_catalog grant select on tables to public"],
    ["future default ACL", `alter default privileges for role catalog_migration_owner in schema parameter_catalog grant select on tables to ${CATALOG_READER_ROLE}`],
    ["role settings", `alter role ${CATALOG_READER_ROLE} set search_path=parameter_catalog`],
    ["system parameter ACL", `grant set on parameter session_replication_role to ${CATALOG_READER_ROLE}`],
    ["PUBLIC system parameter ACL", "grant set on parameter session_replication_role to public"],
    ["PUBLIC privileged definer", "create function public.reader_leak() returns bigint language sql security definer as 'select count(*) from parameter_catalog.subject_placements'"],
    ["PUBLIC privileged dynamic definer", "create function public.reader_leak_dynamic() returns bigint language plpgsql security definer as $$declare n bigint; begin execute 'select count(*) from parameter_catalog.' || 'subject_placements' into n; return n; end$$"],
    ["column-only definer owner", "create role reader_column_owner nologin; grant usage on schema parameter_catalog to reader_column_owner; grant select(id) on parameter_catalog.subject_placements to reader_column_owner; create function public.reader_column_leak() returns bigint language sql security definer as 'select count(id) from parameter_catalog.subject_placements'; alter function public.reader_column_leak() owner to reader_column_owner"],
    ["CREATE-only definer owner", "create role reader_schema_owner nologin; grant create on schema parameter_catalog to reader_schema_owner; create function public.reader_schema_leak() returns void language plpgsql security definer as $$begin execute 'create table parameter_catalog.reader_created(id integer)'; end$$; alter function public.reader_schema_leak() owner to reader_schema_owner"],
    ["EXECUTE-only definer owner", "create role reader_function_owner nologin; grant usage on schema parameter_catalog to reader_function_owner; grant execute on function parameter_catalog.acquire_current_pointer_lock_exclusive() to reader_function_owner; create function public.reader_function_leak() returns void language sql security definer as 'select parameter_catalog.acquire_current_pointer_lock_exclusive()'; alter function public.reader_function_leak() owner to reader_function_owner"],
    ["private definer through parsed PUBLIC view", "create schema reader_private; revoke all on schema reader_private from public; create function reader_private.leak() returns bigint language sql security definer as 'select count(*) from parameter_catalog.subject_placements'; create view public.reader_private_leak_view as select reader_private.leak() as n; grant select on public.reader_private_leak_view to public"],
    ["PUBLIC owner-rights view", "create view public.reader_leak_view as select * from parameter_catalog.subject_placements; grant select on public.reader_leak_view to public"],
    ["PUBLIC nested owner-rights view", "create view public.reader_hidden_view as select * from parameter_catalog.subject_placements; create view public.reader_leak_view as select * from public.reader_hidden_view; grant select on public.reader_leak_view to public"],
    ["PUBLIC materialized Catalog view", "create materialized view public.reader_leak_materialized as select * from parameter_catalog.subject_placements; grant select on public.reader_leak_materialized to public"],
    ["temporary system-catalog shadow", `create temporary table pg_roles as select * from pg_catalog.pg_roles; alter role ${CATALOG_READER_ROLE} bypassrls`],
    ["large object ACL", `do $$declare obj oid; begin obj := lo_create(0); execute format('grant select on large object %s to ${CATALOG_READER_ROLE}',obj); end$$`],
    ["type ACL", `create type public.reader_extra_type as enum ('x'); grant usage on type public.reader_extra_type to ${CATALOG_READER_ROLE}`],
    ["language ACL", `grant usage on language plpgsql to ${CATALOG_READER_ROLE}`],
    ["tablespace ACL", `grant create on tablespace pg_default to ${CATALOG_READER_ROLE}`],
    ["foreign data wrapper ACL", `create foreign data wrapper reader_extra_wrapper; grant usage on foreign data wrapper reader_extra_wrapper to ${CATALOG_READER_ROLE}`],
    ["foreign server ACL", `create foreign data wrapper reader_extra_wrapper; create server reader_extra_server foreign data wrapper reader_extra_wrapper; grant usage on foreign server reader_extra_server to ${CATALOG_READER_ROLE}`],
  ])("refuses contaminated existing role without normalizing: %s", async (_label, sql) => {
    const migration = await readFile(path.join(migrations, CATALOG_READER_MIGRATION), "utf8");
    const databaseName = (await admin.query<{ name: string }>("select current_database() as name")).rows[0]!.name;
    await expect(admin.transaction(async tx => {
      await tx.query(sql.replace("CURRENT_DATABASE", pg.escapeIdentifier(databaseName)));
      await tx.query(migration);
    })).rejects.toMatchObject({ code: "42501" });
    expect((await createCatalogKernel(reader).loadCurrentCatalog(chain.pinC)).ok).toBe(true);
  });
  it("reuses the audited cluster role in another database and makes committed retries no-op", async () => {
    const another = await createSelfHostedPg16Database("readerreuse");
    const concurrent = await createSelfHostedPg16Database("readerparallel");
    const second = createPostgresDatabase(another.url);
    const third = createPostgresDatabase(concurrent.url);
    try {
      await Promise.all([applyMigrations(second, migrations), applyMigrations(third, migrations)]);
      expect(await applyMigrations(second, migrations)).toEqual([]);
      expect(await applyMigrations(third, migrations)).toEqual([]);
      expect((await second.query(`select has_table_privilege($1,'parameter_catalog.catalog_state','SELECT') as allowed`, [CATALOG_READER_ROLE])).rows).toEqual([{ allowed: true }]);
      expect(await applyMigrations(admin, migrations)).toEqual([]);
      expect((await createCatalogKernel(reader).loadCurrentCatalog(chain.pinC)).ok).toBe(true);
    } finally { await second.close(); await third.close(); await another.close(); await concurrent.close(); }
  });
  it("proves a real LOGIN can invoke a private definer through a parsed view, then refuses that state", async () => {
    // Deliberately unsafe synthetic state in this owned cluster, never a grant
    // recommended for runtime. The normal reader still cannot query the table.
    await admin.query(`create schema reader_private_probe;
      revoke all on schema reader_private_probe from public;
      create function reader_private_probe.leak() returns bigint language sql security definer
        as 'select count(*) from parameter_catalog.subject_placements';
      create view public.reader_private_probe_view as select reader_private_probe.leak() as n;
      grant select on public.reader_private_probe_view to public;`);
    try {
      expect((await reader.query("select session_user as login, has_schema_privilege(current_user,'reader_private_probe','USAGE') as usage")).rows)
        .toEqual([{ login: "reader_login", usage: false }]);
      await expect(reader.query("select * from parameter_catalog.subject_placements")).rejects.toMatchObject({ code: "42501" });
      expect((await reader.query("select n from public.reader_private_probe_view")).rows)
        .toEqual((await admin.query("select count(*) as n from parameter_catalog.subject_placements")).rows);
      await expect(admin.transaction(async tx => {
        await tx.query(await readFile(path.join(migrations,CATALOG_READER_MIGRATION),"utf8"));
      })).rejects.toMatchObject({ code: "42501", message: "PCAT-READER-DEFINER-DRIFT" });
    } finally {
      await admin.query(`drop view public.reader_private_probe_view;
        drop function reader_private_probe.leak(); drop schema reader_private_probe;`);
    }
  });
  it("cannot SET ROLE to reader or any management/synchronizer/verifier writer", async () => {
    for (const role of [CATALOG_READER_ROLE, "catalog_migration_owner", "catalog_synchronizer_role", "catalog_verification_writer_role", "parameter_governance_writer_role"]) {
      await expect(reader.query(`set role ${role}`)).rejects.toMatchObject({ code: "42501" });
    }
    expect((await admin.query(`select * from pg_auth_members where member=$1::regrole`, [CATALOG_READER_ROLE])).rows).toEqual([]);
    expect((await admin.query(`select * from pg_shdepend where refobjid=$1::regrole and deptype='o'`, [CATALOG_READER_ROLE])).rows).toEqual([]);
  });
  it("does not grant future objects or default ACLs and preserves independent business writes", async () => {
    await admin.query(`create table parameter_catalog.reader_future_probe(id integer); alter table parameter_catalog.reader_future_probe owner to catalog_migration_owner;
      create table public.reader_business(id integer); grant insert,select on public.reader_business to reader_login;`);
    await expect(reader.query("select * from parameter_catalog.reader_future_probe")).rejects.toMatchObject({ code: "42501" });
    await reader.query("insert into public.reader_business values (7)");
    expect((await reader.query("select id from public.reader_business")).rows).toEqual([{ id: 7 }]);
    expect((await admin.query(`select * from pg_default_acl where defaclrole=$1::regrole`, [CATALOG_READER_ROLE])).rows).toEqual([]);
  });
  it("keeps normal builtins, invoker views and an unprivileged business definer usable", async () => {
    await admin.query(`create role reader_business_definer nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
      create function public.reader_safe_business() returns integer language sql security definer as 'select 42';
      alter function public.reader_safe_business() owner to reader_business_definer;
      create view public.reader_invoker_view with (security_invoker=true) as select id from parameter_catalog.catalog_subjects;
      grant select on public.reader_invoker_view to public;`);
    await admin.transaction(async tx => { await tx.query(await readFile(path.join(migrations,CATALOG_READER_MIGRATION),"utf8")); });
    expect((await reader.query("select public.reader_safe_business() as value, length('abc') as builtin")).rows).toEqual([{ value: 42, builtin: 3 }]);
    expect((await reader.query("select id from public.reader_invoker_view")).rows.length).toBeGreaterThan(0);
    await expect(denied.query("select id from public.reader_invoker_view")).rejects.toMatchObject({ code: "42501" });
  });
});
