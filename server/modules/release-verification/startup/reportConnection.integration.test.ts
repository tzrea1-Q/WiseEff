import { randomBytes } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createSelfHostedPg16Database } from "../../../testing/selfHostedUpgrade/database";
import { createPostgresDatabase, type RootDatabase } from "../../../shared/database/client";
import { applyMigrations } from "../../../shared/database/migrations";
import { createVerificationReportService } from "../report/index";
import { openStartupReportDatabase } from "./reportConnection";

// Mandatory owned-cluster receipt is checked before connecting. This test does
// not probe ambient DATABASE_URL or turn an unavailable cluster into a skip.
let target: Awaited<ReturnType<typeof createSelfHostedPg16Database>>;
let admin: RootDatabase;
const name = `report_login_${randomBytes(8).toString("hex")}`;
const password = randomBytes(24).toString("hex");
const role = pg.escapeIdentifier(name);
let url: string;
beforeAll(async () => {
  target = await createSelfHostedPg16Database("reportlogin");
  admin = createPostgresDatabase(target.url);
  await applyMigrations(admin, path.resolve("server/migrations"));
  await admin.query(`create role ${role} login noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication password '${password}'`);
  await admin.query(`grant catalog_verifier_role to ${role} with inherit true, set false, admin false`);
  const parsed = new URL(target.url); parsed.username = name; parsed.password = password; url = parsed.href;
}, 60_000);
afterAll(async () => {
  await admin?.close(); await target?.close();
  // The nonce LOGIN belongs to this disposable cluster, destroyed by its owner.
  // Do not run a broad role cleanup on another cluster.
});

it("opens a real restricted LOGIN for the formal report projection without startup recursion", async () => {
  const db = await openStartupReportDatabase({ connectionString: url });
  try {
    expect((await db.query("select session_user as login,current_user as effective")).rows).toEqual([{ login: name, effective: name }]);
    expect(await createVerificationReportService({ db }).readReport("synthetic-absent-report"))
      .toEqual({ kind: "absent", reason: "missing" });
    const membership = await admin.query(`select inherit_option,set_option,admin_option from pg_auth_members
      where member=$1::regrole and roleid='catalog_verifier_role'::regrole`, [name]);
    expect(membership.rows).toEqual([{ inherit_option: true, set_option: false, admin_option: false }]);
    for (const statement of [
      "delete from parameter_catalog.verification_reports where false",
      "create table parameter_catalog.report_login_forbidden(id int)",
      "set role catalog_verifier_role", "set role catalog_verification_writer_role",
      "select * from parameter_catalog.catalog_state",
    ]) await expect(db.query(statement)).rejects.toMatchObject({ code: "42501" });
  } finally { await db.close(); }
});

it("keeps ordinary PUBLIC reads without converting them to report or startup authority", async () => {
  await admin.query("create table public.report_public_read_probe(id int); grant select on public.report_public_read_probe to public");
  try {
    const db = await openStartupReportDatabase({ connectionString: url });
    await db.close();
  } finally { await admin.query("drop table public.report_public_read_probe"); }
});

it.each(["superuser", "bypassrls", "createdb", "createrole", "replication"])("refuses actual %s privilege", async attribute => {
  await admin.query(`alter role ${role} ${attribute}`);
  try { await expect(openStartupReportDatabase({ connectionString: url })).rejects.toMatchObject({ code: "PCAT-REPORT-LOGIN-ROLE-REJECTED" }); }
  finally { await admin.query(`alter role ${role} no${attribute}`); }
});

it.each(["catalog_migration_owner", "catalog_synchronizer_role", "catalog_verification_writer_role", "parameter_governance_writer_role", "catalog_runtime_reader_role"])("refuses a mixed %s capability", async extra => {
  await admin.query(`grant ${pg.escapeIdentifier(extra)} to ${role} with inherit false, set false, admin false`);
  try { await expect(openStartupReportDatabase({ connectionString: url })).rejects.toMatchObject({ code: "PCAT-REPORT-LOGIN-ROLE-REJECTED" }); }
  finally { await admin.query(`revoke ${pg.escapeIdentifier(extra)} from ${role}`); }
});

it.each(["set true", "admin true", "inherit false"])("refuses incorrect PG16 membership option %s", async option => {
  await admin.query(`grant catalog_verifier_role to ${role} with ${option}`);
  try { await expect(openStartupReportDatabase({ connectionString: url })).rejects.toMatchObject({ code: "PCAT-REPORT-LOGIN-ROLE-REJECTED" }); }
  finally { await admin.query(`grant catalog_verifier_role to ${role} with inherit true, set false, admin false`); }
});

it("refuses owned application objects", async () => {
  await admin.query(`create table public.report_owner_probe(id int); alter table public.report_owner_probe owner to ${role}`);
  try { await expect(openStartupReportDatabase({ connectionString: url })).rejects.toMatchObject({ code: "PCAT-REPORT-LOGIN-OBJECT-OWNER" }); }
  finally { await admin.query("drop table public.report_owner_probe"); }
});

it.each([
  ["direct application SELECT", `grant select on public.organizations to ${role}`, `revoke select on public.organizations from ${role}`],
  ["PUBLIC application write", "grant update on public.organizations to public", "revoke update on public.organizations from public"],
  ["column-only application write", `grant update(name) on public.organizations to ${role}`, `revoke update(name) on public.organizations from ${role}`],
  ["report grant option", `grant select on parameter_catalog.verification_reports to ${role} with grant option`, `revoke select on parameter_catalog.verification_reports from ${role}`],
  ["system function EXECUTE", `grant execute on function pg_catalog.pg_read_file(text) to ${role}`, `revoke execute on function pg_catalog.pg_read_file(text) from ${role}`],
  ["PUBLIC privileged parameter", "grant set on parameter session_replication_role to public", "revoke set on parameter session_replication_role from public"],
  ["PUBLIC non-report Catalog SELECT", "grant select on parameter_catalog.catalog_state to public", "revoke select on parameter_catalog.catalog_state from public"],
  ["PUBLIC non-report Catalog column SELECT", "grant select(current_catalog_release_id) on parameter_catalog.catalog_state to public", "revoke select(current_catalog_release_id) on parameter_catalog.catalog_state from public"],
])("refuses %s outside its read contract", async (_name, setup, cleanup) => {
  await admin.query(setup);
  try { await expect(openStartupReportDatabase({ connectionString: url })).rejects.toMatchObject({ code: "PCAT-REPORT-LOGIN-CAPABILITY-REJECTED" }); }
  finally { await admin.query(cleanup); }
});

it("refuses a PUBLIC definer that delegates owner write capability", async () => {
  await admin.query("create function public.report_write_proxy() returns void language sql security definer set search_path=pg_catalog as 'delete from public.organizations where false'");
  try { await expect(openStartupReportDatabase({ connectionString: url })).rejects.toMatchObject({ code: "PCAT-REPORT-LOGIN-CAPABILITY-REJECTED" }); }
  finally { await admin.query("drop function public.report_write_proxy()"); }
});

it.each(["builtin-execute", "new-system-definer"])("refuses actual PUBLIC system capability through %s", async capability => {
  if (capability === "builtin-execute") await admin.query("grant execute on function pg_catalog.pg_read_file(text) to public");
  else await admin.query(`create table public.report_system_canary(value text);
    create function pg_catalog.report_system_proxy() returns bigint language sql security definer
      set search_path=pg_catalog as 'with inserted as (insert into public.report_system_canary values (current_user) returning *) select count(*) from inserted'`);
  const direct = createPostgresDatabase(url);
  try {
    if (capability === "builtin-execute") expect((await direct.query("select trim(pg_catalog.pg_read_file('PG_VERSION')) as version")).rows).toEqual([{ version: "16" }]);
    else {
      await expect(direct.query("insert into public.report_system_canary values ('forbidden')")).rejects.toMatchObject({ code: "42501" });
      expect((await direct.query("select pg_catalog.report_system_proxy()::int as count")).rows).toEqual([{ count: 1 }]);
      expect((await admin.query("select count(*)::int as count from pg_init_privs where classoid='pg_proc'::regclass and objoid='pg_catalog.report_system_proxy()'::regprocedure")).rows).toEqual([{ count: 0 }]);
    }
    await expect(openStartupReportDatabase({ connectionString: url }).then(async db => { await db.close(); return db; }))
      .rejects.toMatchObject({ code: "PCAT-REPORT-LOGIN-CAPABILITY-REJECTED" });
  } finally {
    await direct.close();
    await admin.query(capability === "builtin-execute" ? "revoke execute on function pg_catalog.pg_read_file(text) from public" : "drop function pg_catalog.report_system_proxy(); drop table public.report_system_canary");
  }
});

it("refuses a PUBLIC definer whose owner can only advance a sequence", async () => {
  const owner = pg.escapeIdentifier(`sequence_owner_${randomBytes(8).toString("hex")}`);
  await admin.query(`create role ${owner} nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
    create sequence public.report_sequence_probe;
    grant usage on sequence public.report_sequence_probe to ${owner};
    grant usage on schema public to ${owner};
    create function public.report_sequence_proxy() returns bigint language sql security definer
      set search_path=pg_catalog as 'select nextval(''public.report_sequence_probe''::regclass)';
    alter function public.report_sequence_proxy() owner to ${owner}`);
  const direct = createPostgresDatabase(url);
  try {
    const ownerName = owner.slice(1, -1);
    expect((await admin.query(`select has_schema_privilege($1,'public','CREATE') as schema_create,
      has_sequence_privilege($1,'public.report_sequence_probe','USAGE') as sequence_usage,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where c.relkind in ('r','p','v','m','f') and n.nspname not in ('pg_catalog','information_schema')
        and (has_table_privilege($1,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or has_any_column_privilege($1,c.oid,'INSERT,UPDATE,REFERENCES'))) as table_writes`, [ownerName])).rows)
      .toEqual([{ schema_create: false, sequence_usage: true, table_writes: 0 }]);
    await expect(direct.query("select nextval('public.report_sequence_probe')")).rejects.toMatchObject({ code: "42501" });
    // Actual restricted LOGIN demonstrates the definer side effect. This is a
    // permission probe, not a pool that has passed the new admission check.
    expect((await direct.query("select public.report_sequence_proxy()::text as value")).rows).toEqual([{ value: "1" }]);
    await expect(openStartupReportDatabase({ connectionString: url })).rejects.toMatchObject({ code: "PCAT-REPORT-LOGIN-CAPABILITY-REJECTED" });
  } finally {
    await direct.close();
    await admin.query("drop function public.report_sequence_proxy(); drop sequence public.report_sequence_probe");
  }
});

it.each(["reader-member", "column-only", "function-only"])("refuses a PUBLIC definer delegating %s Catalog access", async capability => {
  const ownerName = `catalog_proxy_${randomBytes(8).toString("hex")}`;
  const owner = pg.escapeIdentifier(ownerName);
  await admin.query(`create role ${owner} nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
    grant usage on schema parameter_catalog to ${owner}`);
  if (capability === "reader-member") {
    await admin.query(`grant catalog_runtime_reader_role to ${owner} with inherit true, set false, admin false`);
  } else if (capability === "column-only") {
    await admin.query(`grant select(current_catalog_release_id) on parameter_catalog.catalog_state to ${owner}`);
  } else {
    await admin.query(`create function parameter_catalog.report_protected_probe() returns bigint language sql security definer
      set search_path=pg_catalog as 'select count(current_catalog_release_id) from parameter_catalog.catalog_state';
      revoke all on function parameter_catalog.report_protected_probe() from public;
      grant execute on function parameter_catalog.report_protected_probe() to ${owner}`);
  }
  const body = capability === "function-only"
    ? "select parameter_catalog.report_protected_probe()"
    : "select count(current_catalog_release_id) from parameter_catalog.catalog_state";
  await admin.query(`create function public.report_catalog_proxy() returns bigint language sql security definer
    set search_path=pg_catalog as '${body}'; alter function public.report_catalog_proxy() owner to ${owner}`);
  const direct = createPostgresDatabase(url);
  try {
    expect((await admin.query(`select has_schema_privilege($1,'public','CREATE') as schema_create,
      has_table_privilege($1,'parameter_catalog.catalog_state','UPDATE') as catalog_write`, [ownerName])).rows)
      .toEqual([{ schema_create: false, catalog_write: false }]);
    if (capability === "column-only") {
      expect((await admin.query("select has_table_privilege($1,'parameter_catalog.catalog_state','SELECT') as table_select", [ownerName])).rows)
        .toEqual([{ table_select: false }]);
    }
    if (capability === "function-only") {
      expect((await admin.query("select has_any_column_privilege($1,'parameter_catalog.catalog_state','SELECT') as column_select", [ownerName])).rows)
        .toEqual([{ column_select: false }]);
    }
    await expect(direct.query("select current_catalog_release_id from parameter_catalog.catalog_state")).rejects.toMatchObject({ code: "42501" });
    if (capability === "function-only") await expect(direct.query("select parameter_catalog.report_protected_probe()")).rejects.toMatchObject({ code: "42501" });
    // This actual LOGIN can reach protected state through the PUBLIC definer;
    // opening it as an admitted report pool must refuse that extra capability.
    expect((await direct.query("select public.report_catalog_proxy()::text as value")).rows).toEqual([{ value: "0" }]);
    await expect(openStartupReportDatabase({ connectionString: url })).rejects.toMatchObject({ code: "PCAT-REPORT-LOGIN-CAPABILITY-REJECTED" });
  } finally {
    await direct.close();
    await admin.query("drop function public.report_catalog_proxy()");
    if (capability === "function-only") await admin.query("drop function parameter_catalog.report_protected_probe()");
    if (capability === "reader-member") await admin.query(`revoke catalog_runtime_reader_role from ${owner}`);
    if (capability === "column-only") await admin.query(`revoke select(current_catalog_release_id) on parameter_catalog.catalog_state from ${owner}`);
    await admin.query(`revoke usage on schema parameter_catalog from ${owner}; drop role ${owner}`);
  }
});

it("retains formal 0139 report reads with a definer owner limited to the same six tables", async () => {
  const owner = pg.escapeIdentifier(`report_proxy_${randomBytes(8).toString("hex")}`);
  await admin.query(`create role ${owner} nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
    grant catalog_verifier_role to ${owner} with inherit true, set false, admin false;
    create function public.report_read_proxy() returns bigint language sql security definer
      set search_path=pg_catalog as 'select count(*) from parameter_catalog.verification_reports';
    alter function public.report_read_proxy() owner to ${owner}`);
  try {
    const db = await openStartupReportDatabase({ connectionString: url });
    try {
      expect(await createVerificationReportService({ db }).readReport("synthetic-absent-report"))
        .toEqual({ kind: "absent", reason: "missing" });
    } finally { await db.close(); }
  } finally {
    await admin.query(`drop function public.report_read_proxy(); revoke catalog_verifier_role from ${owner}; drop role ${owner}`);
  }
});

it.each(["public-function", "private-function", "private-view", "split-view-columns"])("refuses owner-only delegation through %s", async route => {
  const ownerName = `delegated_owner_${randomBytes(8).toString("hex")}`;
  const owner = pg.escapeIdentifier(ownerName);
  const schemaName = `report_private_${randomBytes(8).toString("hex")}`;
  const schema = pg.escapeIdentifier(schemaName);
  const privateSchema = route === "private-function" || route === "private-view";
  const qualified = `${privateSchema ? schema : "public"}.report_hidden_inner`;
  const isFunction = route.endsWith("function");
  await admin.query(`create role ${owner} nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication`);
  if (privateSchema) await admin.query(`create schema ${schema}; grant usage on schema ${schema} to ${owner}`);
  if (isFunction) {
    await admin.query(`create function ${qualified}() returns bigint language sql security definer
      set search_path=pg_catalog as 'select count(current_catalog_release_id) from parameter_catalog.catalog_state';
      revoke all on function ${qualified}() from public; grant execute on function ${qualified}() to ${owner}`);
  } else {
    await admin.query(`create view ${qualified} as select
      (select count(current_catalog_release_id) from parameter_catalog.catalog_state) as protected, 7 as visible`);
    if (route === "split-view-columns") await admin.query(`grant select(protected) on ${qualified} to ${owner}; grant select(visible) on ${qualified} to public`);
    else await admin.query(`grant select on ${qualified} to ${owner}`);
  }
  const body = isFunction ? `select ${qualified}()` : `select protected from ${qualified}`;
  await admin.query(`create function public.report_outer_proxy() returns bigint language sql security definer
    set search_path=pg_catalog as '${body}'; alter function public.report_outer_proxy() owner to ${owner}`);
  const direct = createPostgresDatabase(url);
  try {
    await expect(direct.query("select current_catalog_release_id from parameter_catalog.catalog_state")).rejects.toMatchObject({ code: "42501" });
    await expect(direct.query(isFunction ? `select ${qualified}()` : `select protected from ${qualified}`)).rejects.toMatchObject({ code: "42501" });
    if (route === "split-view-columns") {
      expect((await direct.query(`select visible from ${qualified}`)).rows).toEqual([{ visible: 7 }]);
      expect((await admin.query(`select has_table_privilege($1,$3,'SELECT') as owner_table,
        has_table_privilege($2,$3,'SELECT') as login_table,
        has_any_column_privilege($1,$3,'SELECT') as owner_column,
        has_any_column_privilege($2,$3,'SELECT') as login_column`, [ownerName, name, qualified])).rows)
        .toEqual([{ owner_table: false, login_table: false, owner_column: true, login_column: true }]);
    }
    expect((await direct.query("select public.report_outer_proxy()::text as value")).rows).toEqual([{ value: "0" }]);
    await expect(openStartupReportDatabase({ connectionString: url })).rejects.toMatchObject({ code: "PCAT-REPORT-LOGIN-CAPABILITY-REJECTED" });
  } finally {
    await direct.close();
    await admin.query("drop function public.report_outer_proxy()");
    await admin.query(isFunction ? `drop function ${qualified}()` : `drop view ${qualified}`);
    if (privateSchema) await admin.query(`drop schema ${schema}`);
    await admin.query(`drop role ${owner}`);
  }
});
