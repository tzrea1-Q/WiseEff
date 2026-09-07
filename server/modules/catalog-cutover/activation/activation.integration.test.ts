import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertOwnedUpgradeTestTarget } from "../../../../scripts/upgrade-test-target";
import { createCheckedEmptyDatabase, type ParameterCatalogDatabase } from "../../../testing/upgradeComponents";
import { createPostgresDatabase, type RootDatabase } from "../../../shared/database/client";
import { applyMigrations } from "../../../shared/database/migrations";
import { createCatalogKernel } from "../../catalog-kernel/interface";
import { installPublishedCatalogChain } from "../../catalog-kernel/runtime/catalogChain.fixture";
import { readBindingDatabaseIdentity, type BindingDatabaseIdentity } from "../../parameter-bindings/cutoverImport/sourceBoundary";
import { verifyCatalogReaderSession } from "./readerTarget";
import { assertDedicatedCatalogReader } from "./readerAuthorization";
import { createP12Activation, type ActivationOptions } from "./index";

// These tests prove migration/connection/inspection boundaries. They do not
// fabricate P0-P10 checkpoints or use constant passingAdapters to authorize P12.
describe("P12 management persistence on an owned old-schema database", () => {
  let database: ParameterCatalogDatabase;
  let second: ParameterCatalogDatabase;
  let admin: RootDatabase;
  let adminPool: pg.Pool;
  let management: pg.Pool;
  let wrongManagement: pg.Pool;
  let reader: pg.Pool;
  let readerUrl: string;
  let wrongReader: pg.Pool;
  let target: BindingDatabaseIdentity;
  let directory: string;
  let migrations: { name: string; checksum: string }[];
  const roleSuffix = randomUUID().replaceAll("-", "");
  const readerName = `p12_reader_${roleSuffix}`;
  const managementName = `p12_manager_${roleSuffix}`;
  let rolesCreated = false;
  let chain: Awaited<ReturnType<typeof installPublishedCatalogChain>>;
  let lock: pg.PoolClient | undefined;
  const owner: ActivationOptions["owner"] = {
    async withLockedBoundary(body) {
      lock = await adminPool.connect();
      try { await lock.query("begin"); await lock.query("lock table public.parameter_specs in share mode nowait"); return await body(); }
      finally { if (lock) { await lock.query("rollback"); lock.release(); lock = undefined; } }
    },
    async verify(expected) {
      if (!lock) throw new Error("synthetic boundary unavailable");
      expect(await readBindingDatabaseIdentity(lock)).toEqual(expected);
      const locked = (await lock.query(`select count(*)::int as n from pg_locks where pid=pg_backend_pid()
        and relation='public.parameter_specs'::regclass and granted and mode='ShareLock'`)).rows[0];
      if (locked.n !== 1) throw new Error("synthetic boundary lost");
    },
    async observeBoundary() { throw new Error("real full report boundary is not installed in this component fixture"); },
  };
  const options = (): ActivationOptions => ({ managementPool: management, catalogReadConnectionString: readerUrl, reportDatabase: admin,
    target, runId: "absent-run", expectedMigrations: migrations, owner });

  beforeAll(async () => {
    assertOwnedUpgradeTestTarget();
    database = await createCheckedEmptyDatabase("p12activation");
    second = await createCheckedEmptyDatabase("p12wrongtarget");
    directory = await mkdtemp(path.join(os.tmpdir(), "p12-old-schema-"));
    const old = path.join(directory, "migrations"); await mkdir(old);
    const sha = "82344044b436a8dafecefbb85dfd724cecb05e3f";
    const names = execFileSync("git", ["ls-tree", "--name-only", `${sha}:server/migrations`], { encoding: "utf8" }).trim().split("\n").filter(name => name.endsWith(".sql"));
    for (const name of names) await writeFile(path.join(old, name), execFileSync("git", ["show", `${sha}:server/migrations/${name}`]));
    admin = createPostgresDatabase(database.url);
    await applyMigrations(admin, old);
    await admin.query("insert into public.parameter_specs(id,source_kind,specification_key,definition_lifecycle) values('p12-old-spec','dts','synthetic-p12','deprecated')");
    await applyMigrations(admin, path.resolve("server/migrations"));
    migrations = (await admin.query<{ name: string; checksum: string }>("select name,checksum from public.schema_migrations order by name")).rows;
    adminPool = new pg.Pool({ connectionString: database.url, max: 3 });
    const client = await adminPool.connect();
    try { target = await readBindingDatabaseIdentity(client); } finally { client.release(); }
    const password = randomUUID();
    await admin.query(`create role ${pg.escapeIdentifier(readerName)} login noinherit nosuperuser nobypassrls nocreatedb nocreaterole password ${pg.escapeLiteral(password)};
      create role ${pg.escapeIdentifier(managementName)} login noinherit nosuperuser nobypassrls nocreatedb nocreaterole password ${pg.escapeLiteral(password)};
      grant catalog_runtime_reader_role to ${pg.escapeIdentifier(readerName)} with inherit true,set false,admin false;
      grant catalog_migration_owner to ${pg.escapeIdentifier(managementName)} with inherit false,set true,admin false;`);
    rolesCreated = true;
    const pool = (urlText: string, name: string) => { const url = new URL(urlText); url.username = name; url.password = password; return new pg.Pool({ connectionString: url.href, max: 2 }); };
    const readerPrivateUrl = new URL(database.url); readerPrivateUrl.username = readerName; readerPrivateUrl.password = password;
    readerUrl = readerPrivateUrl.href;
    reader = pool(database.url, readerName); wrongReader = pool(second.url, readerName); management = pool(database.url, managementName);
    wrongManagement = pool(second.url, managementName);
    chain = await installPublishedCatalogChain(adminPool);
  }, 120000);
  afterAll(async () => {
    await reader?.end(); await wrongReader?.end(); await management?.end(); await wrongManagement?.end(); await adminPool?.end();
    if (rolesCreated) {
      await admin.query(`drop role ${pg.escapeIdentifier(readerName)}; drop role ${pg.escapeIdentifier(managementName)}`);
    }
    await admin?.close(); await second?.close(); await database?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }, 120000);

  it("adds legacy read state without changing the nonempty old source or P5 release", async () => {
    expect((await admin.query("select id from public.parameter_specs where id='p12-old-spec'")).rows).toEqual([{ id: "p12-old-spec" }]);
    expect((await admin.query("select mode,generation::text,activation_attempt_id from parameter_catalog.application_read_state")).rows)
      .toEqual([{ mode: "legacy", generation: "0", activation_attempt_id: null }]);
    expect((await admin.query("select current_catalog_release_id from parameter_catalog.catalog_state")).rows[0].current_catalog_release_id).toBe(chain.pinC.id);
  });
  it("allows the real reader's formal Kernel query but rejects activation object SELECT and DML", async () => {
    expect((await createCatalogKernel(reader).loadCurrentCatalog(chain.pinC)).ok).toBe(true);
    for (const table of ["application_read_state", "cutover_mapping_epochs", "cutover_activation_attempts"]) {
      for (const sql of [`select * from parameter_catalog.${table}`, `delete from parameter_catalog.${table} where false`]) {
        await expect(reader.query(sql)).rejects.toMatchObject({ code: "42501" });
      }
      expect((await admin.query("select pg_get_userbyid(relowner) as owner from pg_class where oid=$1::regclass", [`parameter_catalog.${table}`])).rows).toEqual([{ owner: "catalog_migration_owner" }]);
    }
  });
  it("independently observes two real sessions in the same database and refuses the other database", async () => {
    const client = await adminPool.connect();
    const good = await reader.connect(); const wrong = await wrongReader.connect();
    try {
      await verifyCatalogReaderSession(client, good, target);
      await expect(verifyCatalogReaderSession(client, wrong, target)).rejects.toThrow("p12-catalog-reader-target-mismatch");
    } finally { good.release(); wrong.release(); client.release(); }
    expect((await reader.query("select count(*)::int as n from pg_locks where pid=pg_backend_pid() and locktype='advisory'")).rows[0].n).toBe(0);
  });
  it("refuses installed P5 without an actual controlled P0-P10 run; inspect does not create an epoch", async () => {
    const activation = createP12Activation(options());
    try {
    await expect(activation.inspect()).rejects.toThrow("p12-run-not-prepared");
    await expect(activation.prepareEpoch()).rejects.toThrow("p12-run-not-prepared");
    expect((await admin.query("select count(*)::int as n from parameter_catalog.cutover_mapping_epochs")).rows[0].n).toBe(0);
    expect((await activation.inspectAttempt("absent-attempt")).outcome).toBe("missing");
    await expect(activation.inspectAppliedBinding("absent-attempt")).rejects.toThrow("p12-activation-missing");
    } finally { await activation.close(); }
  });
  it("rejects a privileged management login instead of borrowing it to make preparation pass", async () => {
    const activation = createP12Activation({ ...options(), managementPool: adminPool });
    try { await expect(activation.inspect()).rejects.toThrow("p12-query-failed"); }
    finally { await activation.close(); }
    expect((await admin.query("select mode from parameter_catalog.application_read_state")).rows[0].mode).toBe("legacy");
  });
  it("rejects a wrong management target before reading activation state or taking target locks", async () => {
    const activation = createP12Activation({ ...options(), managementPool: wrongManagement });
    try { await expect(activation.inspectAttempt("absent-attempt")).rejects.toThrow("p12-target-mismatch"); }
    finally { await activation.close(); }
    expect((await admin.query("select mode from parameter_catalog.application_read_state")).rows[0].mode).toBe("legacy");
  });
  const quotedReader = pg.escapeIdentifier(readerName);
  it.each([
    ["SET membership", `grant catalog_runtime_reader_role to ${quotedReader} with set true`, `grant catalog_runtime_reader_role to ${quotedReader} with set false`],
    ["non-inheriting membership", `grant catalog_runtime_reader_role to ${quotedReader} with inherit false`, `grant catalog_runtime_reader_role to ${quotedReader} with inherit true`],
    ["ADMIN membership", `grant catalog_runtime_reader_role to ${quotedReader} with admin true`, `grant catalog_runtime_reader_role to ${quotedReader} with admin false`],
    ["extra report-reader capability", `grant catalog_verifier_role to ${quotedReader} with inherit true,set false,admin false`, `revoke catalog_verifier_role from ${quotedReader}`],
    ["direct business-table capability", `grant select on public.parameter_specs to ${quotedReader}`, `revoke select on public.parameter_specs from ${quotedReader}`],
    ["PUBLIC writable schema", "grant create on schema public to public", "revoke create on schema public from public"],
    ["direct administrative built-in", `grant execute on function pg_catalog.pg_read_file(text) to ${quotedReader}`, `revoke execute on function pg_catalog.pg_read_file(text) from ${quotedReader}`],
    ["PUBLIC administrative built-in", "grant execute on function pg_catalog.pg_read_file(text) to public", "revoke execute on function pg_catalog.pg_read_file(text) from public"],
    ["PUBLIC privileged definer", "create function public.p12_unsafe_definer() returns integer language sql security definer as 'select 1'; grant execute on function public.p12_unsafe_definer() to public", "drop function public.p12_unsafe_definer()"],
    ["PUBLIC external view", "create view public.p12_unsafe_view as select * from parameter_catalog.catalog_state; grant select on public.p12_unsafe_view to public", "drop view public.p12_unsafe_view"],
  ])("rejects actual dedicated LOGIN drift: %s", async (_name, introduce, remove) => {
    await assertDedicatedCatalogReader(reader);
    await admin.query(introduce);
    try { await expect(assertDedicatedCatalogReader(reader)).rejects.toThrow("p12-catalog-reader-login-required"); }
    finally { await admin.query(remove); }
    await assertDedicatedCatalogReader(reader);
  });
  it("rejects effective PUBLIC database CREATE without forbidding default CONNECT/TEMP", async () => {
    const quotedDatabase = pg.escapeIdentifier((await admin.query<{ name: string }>("select current_database() as name")).rows[0].name);
    expect((await reader.query("select has_database_privilege(current_database(),'CREATE') as allowed")).rows[0].allowed).toBe(false);
    await admin.query(`grant create on database ${quotedDatabase} to public`);
    try { await expect(assertDedicatedCatalogReader(reader)).rejects.toThrow("p12-catalog-reader-login-required"); }
    finally { await admin.query(`revoke create on database ${quotedDatabase} from public`); }
    await assertDedicatedCatalogReader(reader);
  });
  it.each([
    ["sequence USAGE", "create sequence public.p12_private_seq; grant usage on sequence public.p12_private_seq to DELEGATE", "select nextval('public.p12_private_seq')::integer", "drop sequence public.p12_private_seq"],
    ["private function EXECUTE", "create function public.p12_private_inner() returns integer language sql security definer as 'select 101'; revoke all on function public.p12_private_inner() from public; grant execute on function public.p12_private_inner() to DELEGATE", "select public.p12_private_inner()", "drop function public.p12_private_inner()"],
    ["external column SELECT", "create table public.p12_private_table(secret integer); insert into public.p12_private_table values(101); grant select(secret) on public.p12_private_table to DELEGATE", "select secret from public.p12_private_table", "drop table public.p12_private_table"],
    ["external column UPDATE", "create table public.p12_private_table(secret integer); insert into public.p12_private_table values(101); grant update(secret) on public.p12_private_table to DELEGATE", "update public.p12_private_table set secret=102; select 1", "drop table public.p12_private_table"],
  ])("rejects a PUBLIC definer whose otherwise limited owner delegates %s", async (_name, setup, body, cleanup) => {
    const delegate = pg.escapeIdentifier(`p12_delegate_${roleSuffix}`);
    await assertDedicatedCatalogReader(reader);
    await admin.query(`create role ${delegate} nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole`);
    try {
      await admin.query(setup.replaceAll("DELEGATE", delegate));
      await admin.query(`create function public.p12_public_outer() returns integer language sql security definer as ${pg.escapeLiteral(body)};
        alter function public.p12_public_outer() owner to ${delegate}; grant execute on function public.p12_public_outer() to public`);
      try {
        // Establish the real capability path; no body-text regex is the oracle.
        expect((await reader.query("select public.p12_public_outer() as value")).rows[0].value).toBeTypeOf("number");
        await expect(assertDedicatedCatalogReader(reader)).rejects.toThrow("p12-catalog-reader-login-required");
      } finally { await admin.query("drop function public.p12_public_outer()"); }
    } finally { await admin.query(cleanup); await admin.query(`drop role ${delegate}`); }
    await assertDedicatedCatalogReader(reader);
  });
  it("keeps a PUBLIC definer with no additional owner capability admissible", async () => {
    const delegate = pg.escapeIdentifier(`p12_delegate_${roleSuffix}`);
    await admin.query(`create role ${delegate} nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole`);
    try {
      await admin.query(`create function public.p12_public_outer() returns integer language sql security definer as 'select 7';
        alter function public.p12_public_outer() owner to ${delegate}; grant execute on function public.p12_public_outer() to public`);
      try {
        await assertDedicatedCatalogReader(reader);
        expect((await reader.query("select public.p12_public_outer() as value")).rows[0].value).toBe(7);
      } finally { await admin.query("drop function public.p12_public_outer()"); }
    } finally { await admin.query(`drop role ${delegate}`); }
  });
});
