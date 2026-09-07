import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createMigratedSelfHostedPg16Database } from "../../../../testing/selfHostedUpgrade/database";
import { createPostgresDatabase, type RootDatabase } from "../../../../shared/database/client";
import { createReleaseVerificationService } from "../../core/service";
import { VerificationGateId, type VerificationPlan } from "../../core/types";
import { validPrepare } from "../../report/fixtures";
import { createPostgresGateAdapters } from "./index";
import { LEGACY_STRUCTURAL_TABLES } from "../../../catalog-kernel/security/catalogRoleManifest";

// An owned cluster is necessary: PUBLIC and role membership are deliberately
// contaminated. These are actual gate/LOGIN probes, not P13 or passing reports.
const tables = [...LEGACY_STRUCTURAL_TABLES, "driver_schemas", "driver_schema_versions", "dts_property_specs"];
let target: Awaited<ReturnType<typeof createMigratedSelfHostedPg16Database>>;
let admin: RootDatabase, verifier: RootDatabase;
let plan: VerificationPlan;
const nonce = randomBytes(8).toString("hex"), secret = randomBytes(24).toString("hex");
const observerName = `v13_observer_${nonce}`;
const writerName = `v13_writer_${nonce}`;
const capabilityName = `v13_capability_${nonce}`;
let writer: pg.Client;

beforeAll(async () => {
  target = await createMigratedSelfHostedPg16Database("v13writer");
  admin = createPostgresDatabase(target.url);
  const prepared = await createReleaseVerificationService({ db: admin }).prepareVerification(validPrepare());
  if (!prepared.ok) throw new Error("v13-test-plan-unavailable");
  plan = prepared.value;
  await admin.query(`create role ${observerName} login nosuperuser nobypassrls nocreatedb nocreaterole noinherit password '${secret}';
    alter role ${observerName} set default_transaction_read_only=on;
    create role ${writerName} login nosuperuser nobypassrls nocreatedb nocreaterole noinherit password '${secret}';
    create role ${capabilityName} nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit;`);
  const loginUrl = (name: string) => { const url = new URL(target.url); url.username = name; url.password = secret; return url.href; };
  verifier = createPostgresDatabase(loginUrl(observerName));
  writer = new pg.Client({ connectionString: loginUrl(writerName) });
  writer.on("error", () => {});
  await writer.connect();
  await admin.query(`insert into public.parameter_specs(id,source_kind,specification_key) values ('v13-spec','dts','v13.driver');
    insert into public.driver_schemas(id,parameter_spec_id,schema_namespace) values ('v13-driver','v13-spec','before');`);
});
afterAll(async () => {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => writer?.end()), Promise.resolve().then(() => verifier?.close()),
    Promise.resolve().then(() => admin?.close()),
  ]);
  const removed = await Promise.allSettled([Promise.resolve().then(() => target?.close())]);
  if ([...results, ...removed].some(result => result.status === "rejected")) throw new Error("v13-test-cleanup-failed");
});
const runGate = () => createPostgresGateAdapters({ db: verifier }).get("PCAT-DB-V13")!({
  gateId: VerificationGateId("PCAT-DB-V13"), plan,
});
const expectBlocked = async () => expect(await runGate()).toMatchObject({
  status: "failed", failureCode: "PCAT-VRF-V13-LEGACY-WRITER-REACHABLE",
});

it("uses a genuinely read-only verification LOGIN and a separate restricted application LOGIN", async () => {
  for (const [query, name, readonly] of [[(sql: string) => verifier.query(sql), observerName, "on"], [(sql: string) => writer.query(sql), writerName, "off"]] as const) {
    expect((await query(`select session_user as name,current_user as effective,
      current_setting('transaction_read_only') as readonly,rolsuper or rolbypassrls or rolcreatedb or rolcreaterole as privileged
      from pg_catalog.pg_roles where rolname=session_user`)).rows).toEqual([{ name, effective: name, readonly, privileged: false }]);
  }
  expect(await runGate()).toMatchObject({ status: "passed" }); // Database submatrix only.
});

it("blocks the formal V13 gate after a real restricted LOGIN changes a legacy driver schema", async () => {
  await admin.query(`grant select(id),update(schema_namespace) on public.driver_schemas to ${writerName}`);
  try {
    const changed = await writer.query("update public.driver_schemas set schema_namespace='changed' where id='v13-driver'");
    expect(changed.rowCount).toBe(1);
    expect((await admin.query("select schema_namespace from public.driver_schemas where id='v13-driver'")).rows)
      .toEqual([{ schema_namespace: "changed" }]);
    await expectBlocked();
    // The verifier neither repairs the data nor removes the offending grant.
    expect((await admin.query("select schema_namespace from public.driver_schemas where id='v13-driver'")).rows)
      .toEqual([{ schema_namespace: "changed" }]);
  } finally { await admin.query(`revoke select(id),update(schema_namespace) on public.driver_schemas from ${writerName}`); }
});

it.each(tables)("detects PUBLIC column UPDATE on existing scoped table %s", async table => {
  const column = (await admin.query<{ attname: string }>(`select attname from pg_catalog.pg_attribute
    where attrelid=$1::regclass and attnum>0 and not attisdropped and attgenerated='' order by attnum limit 1`, [`public.${table}`])).rows[0].attname;
  const identifier = pg.escapeIdentifier(column), relation = `public.${pg.escapeIdentifier(table)}`;
  await admin.query(`grant update(${identifier}) on ${relation} to public`);
  try {
    expect((await writer.query(`update ${relation} set ${identifier}=null where false`)).rowCount).toBe(0);
    await expectBlocked();
  } finally { await admin.query(`revoke update(${identifier}) on ${relation} from public`); }
});

it.each(["direct", "inherited", "set-only"])("detects %s table mutation capability using actual LOGIN semantics", async mode => {
  const role = mode === "direct" ? writerName : capabilityName;
  await admin.query(`grant update on public.driver_schemas to ${role}`);
  if (mode !== "direct") await admin.query(`grant ${capabilityName} to ${writerName} with inherit ${mode === "inherited"},set ${mode === "set-only"},admin false`);
  try {
    if (mode === "set-only") await writer.query(`set role ${capabilityName}`);
    expect((await writer.query("update public.driver_schemas set schema_namespace='capability' where false")).rowCount).toBe(0);
    await expectBlocked();
  } finally {
    await writer.query("reset role");
    await admin.query(`revoke update on public.driver_schemas from ${role}`);
    if (mode !== "direct") await admin.query(`revoke ${capabilityName} from ${writerName}`);
  }
});

it("does not infer a runtime writer from an unreachable NOLOGIN owner, but detects an actual member", async () => {
  await admin.query(`alter table public.driver_schemas owner to ${capabilityName}`);
  try {
    expect(await runGate()).toMatchObject({ status: "passed" });
    await admin.query(`grant ${capabilityName} to ${writerName} with inherit false,set true,admin false`);
    await writer.query(`set role ${capabilityName}`);
    expect((await writer.query("update public.driver_schemas set schema_namespace='owned' where false")).rowCount).toBe(0);
    await expectBlocked();
  } finally {
    await writer.query("reset role");
    await admin.query(`revoke ${capabilityName} from ${writerName}; alter table public.driver_schemas owner to postgres`);
  }
});

it("blocks an executable opaque SECURITY DEFINER instead of treating absent SQL text as no writer", async () => {
  const fn = `v13_opaque_${nonce}`;
  await admin.query(`create function public.${fn}() returns void language plpgsql security definer as $$
    begin execute format('update %I.%I set schema_namespace=%L', 'public', 'driver_schemas', 'opaque'); end $$`);
  try {
    await writer.query(`select public.${fn}()`);
    expect((await admin.query("select schema_namespace from public.driver_schemas where id='v13-driver'")).rows)
      .toEqual([{ schema_namespace: "opaque" }]);
    await expectBlocked();
  } finally { await admin.query(`drop function public.${fn}()`); }
});

it.each(["INSERT", "DELETE", "TRUNCATE", "TRIGGER", "REFERENCES"])("detects effective table %s without executing the destructive operation", async permission => {
  await admin.query(`grant ${permission} on public.driver_schemas to public`);
  try {
    expect((await writer.query("select pg_catalog.has_table_privilege(current_user,'public.driver_schemas',$1) as allowed", [permission])).rows)
      .toEqual([{ allowed: true }]);
    await expectBlocked();
  } finally { await admin.query(`revoke ${permission} on public.driver_schemas from public`); }
});

it("blocks a public definer delegating through a private executable definer", async () => {
  const inner = `v13_inner_${nonce}`, outer = `v13_outer_${nonce}`;
  await admin.query(`create function public.${inner}() returns void language plpgsql security definer as $$
    begin execute format('update %I.%I set schema_namespace=%L', 'public', 'driver_schemas', 'delegated'); end $$;
    revoke all on function public.${inner}() from public;
    grant execute on function public.${inner}() to ${capabilityName};
    create function public.${outer}() returns void language plpgsql security definer as $$
    begin perform public.${inner}(); end $$;
    alter function public.${outer}() owner to ${capabilityName}`);
  try {
    expect((await writer.query(`select pg_catalog.has_function_privilege(current_user,'public.${inner}()','EXECUTE') as allowed`)).rows)
      .toEqual([{ allowed: false }]);
    await writer.query(`select public.${outer}()`);
    expect((await admin.query("select schema_namespace from public.driver_schemas where id='v13-driver'")).rows)
      .toEqual([{ schema_namespace: "delegated" }]);
    await expectBlocked();
  } finally { await admin.query(`drop function public.${outer}(); drop function public.${inner}()`); }
});

it("allows a restricted-owner read-only definer without inferring mutation from SECURITY DEFINER alone", async () => {
  const fn = `v13_readonly_${nonce}`;
  await admin.query(`grant select(schema_namespace) on public.driver_schemas to ${capabilityName};
    create function public.${fn}() returns text language sql security definer as $$
      select schema_namespace from public.driver_schemas limit 1 $$;
    alter function public.${fn}() owner to ${capabilityName}`);
  try {
    expect((await writer.query(`select public.${fn}() as value`)).rows[0].value).toEqual(expect.any(String));
    expect(await runGate()).toMatchObject({ status: "passed" });
  } finally {
    await admin.query(`drop function public.${fn}(); revoke select(schema_namespace) on public.driver_schemas from ${capabilityName}`);
  }
});

it("fails closed when a scoped relation is missing in the pre-retirement observation window", async () => {
  await admin.query("alter table public.driver_schema_versions rename to v13_temporarily_absent");
  try { await expectBlocked(); }
  finally { await admin.query("alter table public.v13_temporarily_absent rename to driver_schema_versions"); }
});

it("returns a typed blocking result when the actual read-only verifier gets 42501", async () => {
  expect((await admin.query(`select pg_catalog.has_table_privilege($1,'pg_catalog.pg_class','SELECT') as allowed`, [observerName])).rows)
    .toEqual([{ allowed: true }]);
  await admin.query("revoke select on pg_catalog.pg_class from public");
  try {
    await expect(verifier.query("select oid from pg_catalog.pg_class limit 1")).rejects.toMatchObject({ code: "42501" });
    await expectBlocked();
  } finally { await admin.query("grant select on pg_catalog.pg_class to public"); }
});

it("does not infer trusted builtin provenance for an executable definer in a system schema", async () => {
  const fn = `v13_system_${nonce}`;
  await admin.query(`create function pg_catalog.${fn}() returns void language plpgsql security definer as $$
    begin execute format('update %I.%I set schema_namespace=%L', 'public', 'driver_schemas', 'system-definer'); end $$`);
  try {
    expect((await admin.query(`select exists(select 1 from pg_catalog.pg_init_privs
      where classoid='pg_catalog.pg_proc'::regclass and objoid=$1::regprocedure and objsubid=0 and privtype='i') as initial`, [`pg_catalog.${fn}()`])).rows)
      .toEqual([{ initial: false }]);
    await writer.query(`select pg_catalog.${fn}()`);
    expect((await admin.query("select schema_namespace from public.driver_schemas where id='v13-driver'")).rows)
      .toEqual([{ schema_namespace: "system-definer" }]);
    await expectBlocked();
  } finally { await admin.query(`drop function pg_catalog.${fn}()`); }
});

it("blocks actual trigger dispatch from a writable unscoped table into a legacy relation", async () => {
  const table = `v13_dispatch_${nonce}`, fn = `v13_trigger_${nonce}`;
  await admin.query(`create table public.${table}(id integer);
    create function public.${fn}() returns trigger language plpgsql security definer as $$
      begin execute format('update %I.%I set schema_namespace=%L where id=%L',
        'public', 'driver_schemas', 'trigger-dispatched', 'v13-driver'); return new; end $$;
    create trigger dispatch after insert on public.${table} for each row execute function public.${fn}();
    revoke all on function public.${fn}() from public;
    grant insert on public.${table} to ${writerName}`);
  try {
    expect((await writer.query(`select pg_catalog.has_function_privilege(current_user,'public.${fn}()','EXECUTE') as allowed`)).rows)
      .toEqual([{ allowed: false }]);
    expect((await writer.query(`insert into public.${table}(id) values (1)`)).rowCount).toBe(1);
    expect((await admin.query("select schema_namespace from public.driver_schemas where id='v13-driver'")).rows)
      .toEqual([{ schema_namespace: "trigger-dispatched" }]);
    await expectBlocked();
  } finally {
    await admin.query(`drop table public.${table}; drop function public.${fn}()`);
  }
});

it.each(["read-only-owner", "disabled", "no-dispatch-grant"])("retains a passed submatrix for a %s trigger", async mode => {
  const table = `v13_safe_dispatch_${nonce}`, fn = `v13_safe_trigger_${nonce}`;
  await admin.query(`create table public.${table}(id integer);
    grant select on public.driver_schemas to ${capabilityName};
    create function public.${fn}() returns trigger language plpgsql security definer as $$
      begin perform 1 from public.driver_schemas limit 1; return new; end $$;
    create trigger dispatch after insert on public.${table} for each row execute function public.${fn}();
    revoke all on function public.${fn}() from public`);
  try {
    if (mode === "read-only-owner") await admin.query(`alter function public.${fn}() owner to ${capabilityName}`);
    if (mode === "disabled") await admin.query(`alter table public.${table} disable trigger dispatch`);
    if (mode !== "no-dispatch-grant") {
      await admin.query(`grant insert on public.${table} to ${writerName}`);
      expect((await writer.query(`insert into public.${table}(id) values (1)`)).rowCount).toBe(1);
    } else {
      await expect(writer.query(`insert into public.${table}(id) values (1)`)).rejects.toMatchObject({ code: "42501" });
    }
    expect(await runGate()).toMatchObject({ status: "passed" });
  } finally {
    await admin.query(`drop table public.${table}; drop function public.${fn}(); revoke select on public.driver_schemas from ${capabilityName}`);
  }
});

it("follows a dispatched restricted trigger owner to its private inner writer", async () => {
  const table = `v13_indirect_dispatch_${nonce}`, fn = `v13_indirect_trigger_${nonce}`, inner = `v13_trigger_inner_${nonce}`;
  await admin.query(`create table public.${table}(id integer);
    create function public.${inner}() returns void language plpgsql security definer as $$
      begin execute format('update %I.%I set schema_namespace=%L where id=%L',
        'public', 'driver_schemas', 'trigger-inner', 'v13-driver'); end $$;
    revoke all on function public.${inner}() from public;
    grant execute on function public.${inner}() to ${capabilityName};
    create function public.${fn}() returns trigger language plpgsql security definer as $$
      begin perform public.${inner}(); return new; end $$;
    alter function public.${fn}() owner to ${capabilityName};
    create trigger dispatch after insert on public.${table} for each row execute function public.${fn}();
    revoke all on function public.${fn}() from public;
    grant insert on public.${table} to ${writerName}`);
  try {
    expect((await writer.query(`select pg_catalog.has_function_privilege(current_user,'public.${inner}()','EXECUTE') as allowed`)).rows)
      .toEqual([{ allowed: false }]);
    expect((await writer.query(`insert into public.${table}(id) values (1)`)).rowCount).toBe(1);
    expect((await admin.query("select schema_namespace from public.driver_schemas where id='v13-driver'")).rows)
      .toEqual([{ schema_namespace: "trigger-inner" }]);
    await expectBlocked();
  } finally {
    await admin.query(`drop table public.${table}; drop function public.${fn}(); drop function public.${inner}()`);
  }
});

it("preserves the authenticated LOGIN replica setting after SET ROLE for trigger dispatch", async () => {
  const table = `v13_replica_dispatch_${nonce}`, fn = `v13_replica_trigger_${nonce}`;
  let session: pg.Client | undefined;
  await admin.query(`create table public.${table}(id integer);
    create function public.${fn}() returns trigger language plpgsql security definer as $$
      begin execute format('update %I.%I set schema_namespace=%L where id=%L',
        'public', 'driver_schemas', 'replica-set-role', 'v13-driver'); return new; end $$;
    create trigger dispatch after insert on public.${table} for each row execute function public.${fn}();
    alter table public.${table} enable replica trigger dispatch;
    revoke all on function public.${fn}() from public;
    grant insert on public.${table} to ${capabilityName};
    grant ${capabilityName} to ${writerName} with inherit false,set true,admin false;
    alter role ${writerName} set session_replication_role=replica`);
  try {
    const url = new URL(target.url); url.username = writerName; url.password = secret;
    session = new pg.Client({ connectionString: url.href }); session.on("error", () => {});
    await session.connect();
    await session.query(`set role ${capabilityName}`);
    expect((await session.query("select session_user<>current_user as switched,current_setting('session_replication_role') as mode")).rows)
      .toEqual([{ switched: true, mode: "replica" }]);
    expect((await session.query(`insert into public.${table}(id) values (1)`)).rowCount).toBe(1);
    expect((await admin.query("select schema_namespace from public.driver_schemas where id='v13-driver'")).rows)
      .toEqual([{ schema_namespace: "replica-set-role" }]);
    await expectBlocked();
  } finally {
    const closed = await Promise.allSettled([Promise.resolve().then(() => session?.end())]);
    const restored = await Promise.allSettled([admin.query(`alter role ${writerName} reset session_replication_role;
      revoke ${capabilityName} from ${writerName}; drop table public.${table}; drop function public.${fn}()`)]);
    if ([...closed, ...restored].some(result => result.status === "rejected")) throw new Error("v13-replica-fixture-cleanup-failed");
  }
});

it("detects a dispatch-table owner able to enable a replica-only definer trigger", async () => {
  const table = `v13_owner_dispatch_${nonce}`, fn = `v13_owner_trigger_${nonce}`;
  await admin.query(`create table public.${table}(id integer);
    create function public.${fn}() returns trigger language plpgsql security definer as $$
      begin execute format('update %I.%I set schema_namespace=%L where id=%L',
        'public', 'driver_schemas', 'owner-enabled', 'v13-driver'); return new; end $$;
    create trigger dispatch after insert on public.${table} for each row execute function public.${fn}();
    revoke all on function public.${fn}() from public;
    alter table public.${table} enable replica trigger dispatch;
    alter table public.${table} owner to ${writerName}`);
  try {
    expect((await writer.query("select pg_catalog.has_parameter_privilege(current_user,'session_replication_role','SET') as allowed")).rows)
      .toEqual([{ allowed: false }]);
    await writer.query(`alter table public.${table} enable trigger dispatch`);
    expect((await writer.query(`insert into public.${table}(id) values (1)`)).rowCount).toBe(1);
    expect((await admin.query("select schema_namespace from public.driver_schemas where id='v13-driver'")).rows)
      .toEqual([{ schema_namespace: "owner-enabled" }]);
    await writer.query(`alter table public.${table} enable replica trigger dispatch`);
    await expectBlocked();
  } finally {
    await admin.query(`drop table public.${table}; drop function public.${fn}()`);
  }
});

it("blocks native project deletion cascading into an actual legacy binding without its mutation grant", async () => {
  const organization = `v13_ri_org_${nonce}`, project = `v13_ri_project_${nonce}`, binding = `v13_ri_binding_${nonce}`, module = `v13_ri_module_${nonce}`;
  await admin.query(`insert into public.organizations(id,name) values ($1,'V13 RI fixture')`, [organization]);
  await admin.query(`insert into public.projects(id,organization_id,name,code) values ($1,$2,'V13 RI fixture','v13-ri')`, [project, organization]);
  await admin.query(`insert into public.parameter_modules(id,organization_id,name,path) values ($1,$2,'V13 RI fixture',$1)`, [module, organization]);
  await admin.query(`insert into public.project_parameter_bindings(id,organization_id,project_id,parameter_spec_id,module_id)
    values ($1,$2,$3,'v13-spec',$4)`, [binding, organization, project, module]);
  await admin.query(`grant delete,select(id) on public.projects to ${writerName}`);
  try {
    expect((await writer.query(`select pg_catalog.has_table_privilege(current_user,'public.project_parameter_bindings','DELETE')
      or pg_catalog.has_any_column_privilege(current_user,'public.project_parameter_bindings','UPDATE') as allowed`)).rows)
      .toEqual([{ allowed: false }]);
    expect((await admin.query(`select count(*)::integer as count from public.project_parameter_bindings where id=$1`, [binding])).rows)
      .toEqual([{ count: 1 }]);
    expect((await writer.query(`delete from public.projects where id=$1`, [project])).rowCount).toBe(1);
    expect((await admin.query(`select count(*)::integer as count from public.project_parameter_bindings where id=$1`, [binding])).rows)
      .toEqual([{ count: 0 }]);
    await expectBlocked();
  } finally {
    await admin.query(`revoke delete,select(id) on public.projects from ${writerName}`);
    await admin.query(`delete from public.projects where id=$1`, [project]);
    await admin.query(`delete from public.parameter_modules where id=$1`, [module]);
    await admin.query(`delete from public.organizations where id=$1`, [organization]);
  }
});

it("does not turn native cascade authority over unscoped children into their owner's arbitrary legacy rights", async () => {
  await admin.query(`grant delete on public.project_parameter_file_versions to ${writerName}`);
  try {
    expect((await writer.query(`delete from public.project_parameter_file_versions where false`)).rowCount).toBe(0);
    expect(await runGate()).toMatchObject({ status: "passed" });
  } finally { await admin.query(`revoke delete on public.project_parameter_file_versions from ${writerName}`); }
});

it("does not treat a non-key project column update as a cascading legacy mutation", async () => {
  await admin.query(`grant update(name) on public.projects to ${writerName}`);
  try {
    expect((await writer.query(`update public.projects set name='unchanged' where false`)).rowCount).toBe(0);
    expect(await runGate()).toMatchObject({ status: "passed" });
  } finally { await admin.query(`revoke update(name) on public.projects from ${writerName}`); }
});
