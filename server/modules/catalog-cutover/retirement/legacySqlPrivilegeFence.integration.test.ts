import { randomBytes } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterEach, beforeEach, expect, it } from "vitest";
import { assertOwnedUpgradeTestTarget } from "../../../../scripts/upgrade-test-target";
import { createMigratedSelfHostedPg16Database, createSelfHostedPg16Database } from "../../../testing/selfHostedUpgrade/database";
import { LEGACY_STRUCTURAL_TABLES } from "../../catalog-kernel/security/catalogRoleManifest";
import { readBindingDatabaseIdentity } from "../../parameter-bindings/cutoverImport/sourceBoundary";
import { digestOf } from "../../release-verification/core/digest";
import { prepareUnapprovedBootstrapTransportBinding } from "./bootstrapCredentialFence.fixture";
import { acquireObservedManagementClient } from "./managementCheckout";
import { applyLegacySqlPrivilegeFence, inspectLegacySqlPrivilegeFence, type LegacySqlPrivilegeIntent } from "./legacySqlPrivilegeFence";

// Actual SQL effect only. P0–P10 and P12 storage are real, but the existing
// fixture's references are unapproved. No full root approval is fabricated.
// The manifest's second relation is the residual-spec fixture's source table.
// Its real specification_key UPDATE avoids the distinct active-DTS lifecycle
// trigger's extra read prerequisites; no trigger is disabled or grant added.
const table = LEGACY_STRUCTURAL_TABLES[1];
let database: Awaited<ReturnType<typeof createMigratedSelfHostedPg16Database>> | undefined;
let pool: pg.Pool | undefined, manager: pg.PoolClient | undefined, writer: pg.Client | undefined;
let directory: string | undefined, role: string, capability: string;
let command: Parameters<typeof applyLegacySqlPrivilegeFence>[0], intents: LegacySqlPrivilegeIntent[];
let ownsRole = false, ownsCapability = false;

beforeEach(async () => {
  assertOwnedUpgradeTestTarget();
  database = await createMigratedSelfHostedPg16Database("legacy_sql_privileges");
  pool = new pg.Pool({ connectionString: database.url, max: 2, connectionTimeoutMillis: 2000, query_timeout: 5000 });
  pool.on("error", () => {});
  directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "sql-fence-component-")));
  manager = await acquireObservedManagementClient(pool, () => {});
  const target = await readBindingDatabaseIdentity(manager);
  manager.release(true); manager = undefined;
  const binding = await prepareUnapprovedBootstrapTransportBinding({ pool, target, directory });
  manager = await acquireObservedManagementClient(pool, () => {});
  await manager.query("select pg_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
  const nonce = randomBytes(8).toString("hex"), secret = randomBytes(24).toString("hex");
  role = `sql_candidate_${nonce}`; capability = `sql_capability_${nonce}`;
  await manager.query(`create role ${pg.escapeIdentifier(role)} login noinherit password ${pg.escapeLiteral(secret)}`); ownsRole = true;
  await manager.query(`create role ${pg.escapeIdentifier(capability)} nologin`); ownsCapability = true;
  const url = new URL(database.url); url.username = role; url.password = secret;
  writer = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 2000, query_timeout: 5000 });
  writer.on("error", () => {}); await writer.connect();
  const oid = (await writer.query("select oid::text from pg_roles where rolname=session_user")).rows[0].oid;
  intents = [];
  command = { client: manager, selection: { runId: binding.intent.runId, attemptId: `sql-${nonce}`, target,
    activationBindingDigest: binding.bindingDigest, rootRequestDigest: digestOf("unapproved-component-root"), recoveryPackageDigest: digestOf("component-not-a-recovery-package").slice(7) },
    runtimeRoles: [{ oid, name: role }], recoveryRoles: [
      { name: role, login: true, inherit: false, members: [] }, { name: capability, login: false, inherit: true, members: [] },
    ], beforeEffect: async () => {
      expect((await manager!.query("select pg_backend_pid() as pid")).rows[0].pid).toBeGreaterThan(0);
    }, persistHostIntent: async intent => { intents.push(structuredClone(intent)); }, persistHostStep: async () => {},
  };
}, 30_000);

afterEach(async () => {
  const failures: unknown[] = [];
  const attempt = async (body: () => Promise<unknown>) => { try { await body(); } catch { failures.push("cleanup-failed"); } };
  await attempt(async () => { await writer?.end(); }); writer = undefined;
  await attempt(async () => { await manager?.query("rollback"); await manager?.query("reset role"); });
  // Cleanup uses an independent connection to the same owned database. A dead
  // tested lease must not skip role cleanup or fall back to an ambient target.
  const cleanup = database ? new pg.Client({ connectionString: database.url, connectionTimeoutMillis: 2000, query_timeout: 5000 }) : undefined;
  cleanup?.on("error", () => {});
  await attempt(async () => { await cleanup?.connect(); });
  if (ownsRole) await attempt(async () => {
    if (!cleanup) throw new Error("cleanup-client-missing");
    await cleanup.query(`alter table public.${pg.escapeIdentifier(table)} owner to current_user`);
  });
  for (const [name, owned] of [[role, ownsRole], [capability, ownsCapability]] as const) if (owned) {
    await attempt(async () => { if (!cleanup) throw new Error("cleanup-client-missing");
      await cleanup.query(`drop owned by ${pg.escapeIdentifier(name)}; drop role ${pg.escapeIdentifier(name)}`); });
  }
  await attempt(async () => { await cleanup?.end(); });
  ownsRole = false; ownsCapability = false;
  await attempt(async () => { manager?.release(true); }); manager = undefined;
  await attempt(async () => { await pool?.end(); }); pool = undefined;
  await attempt(async () => { await database?.close(); }); database = undefined;
  await attempt(async () => { if (directory) await rm(directory, { recursive: true }); }); directory = undefined;
  if (failures.length) throw new Error("legacy-sql-fixture-cleanup-failed");
});

it.each(["direct", "column", "public", "inherit", "set"] as const)("retires an actual %s grant without removing SELECT, owners or unrelated business privileges", async mode => {
  let grantee = pg.escapeIdentifier(role);
  if (mode === "public") grantee = "PUBLIC";
  if (mode === "inherit" || mode === "set") {
    await manager!.query(`grant ${pg.escapeIdentifier(capability)} to ${pg.escapeIdentifier(role)} with inherit ${mode === "inherit"},set ${mode === "set"},admin false`);
    if (mode === "inherit") await manager!.query(`alter role ${pg.escapeIdentifier(role)} inherit`);
    grantee = pg.escapeIdentifier(capability);
  }
  await manager!.query(`grant select on public.${pg.escapeIdentifier(table)} to ${grantee};
    grant update${mode === "column" ? " (specification_key)" : ""} on public.${pg.escapeIdentifier(table)} to ${grantee};
    create table public.sql_fence_unrelated(value integer); grant select,insert on public.sql_fence_unrelated to ${pg.escapeIdentifier(role)}`);
  if (mode === "set") await writer!.query(`set role ${pg.escapeIdentifier(capability)}`);
  const changed = await writer!.query(`update public.${pg.escapeIdentifier(table)} set specification_key=specification_key`);
  expect(changed.rowCount).toBe(1);
  const owner = (await manager!.query("select relowner::text from pg_class where oid=$1::regclass", [`public.${table}`])).rows[0].relowner;
  expect(await applyLegacySqlPrivilegeFence(command)).toMatchObject({ outcome: "legacy-sql-privileges-fenced-not-P13" });
  expect(intents).toHaveLength(1);
  await expect(writer!.query(`update public.${pg.escapeIdentifier(table)} set specification_key=specification_key`)).rejects.toMatchObject({ code: "42501" });
  expect((await writer!.query(`select id from public.${pg.escapeIdentifier(table)}`)).rowCount).toBe(1);
  if (mode === "set") await writer!.query("reset role");
  expect((await writer!.query("insert into public.sql_fence_unrelated values (1)")).rowCount).toBe(1);
  expect((await manager!.query("select relowner::text from pg_class where oid=$1::regclass", [`public.${table}`])).rows[0].relowner).toBe(owner);
  expect((await manager!.query("select count(*)::int as count from parameter_catalog.parameter_catalog_cutover_checkpoints where cutover_run_id=$1 and phase='P13'", [command.selection.runId])).rows[0].count).toBe(0);
  await expect(applyLegacySqlPrivilegeFence(command)).rejects.toMatchObject({ code: "ATTEMPT-REQUIRES-INSPECTION" });
});

it("does not dispatch REVOKE when the root's host intent persistence fails", async () => {
  await manager!.query(`grant select,update on public.${pg.escapeIdentifier(table)} to ${pg.escapeIdentifier(role)}`);
  await expect(applyLegacySqlPrivilegeFence({ ...command, persistHostIntent: async () => { throw new Error("private-fsync-failure"); } }))
    .rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect((await writer!.query(`update public.${pg.escapeIdentifier(table)} set specification_key=specification_key`)).rowCount).toBe(1);
  expect((await manager!.query("select count(*)::int as count from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$1 and event_kind='legacy-sql-privileges-intent'", [command.selection.runId])).rows[0].count).toBe(0);
});

it("rejects an existing caller transaction without committing or ending it", async () => {
  await manager!.query("begin");
  await expect(applyLegacySqlPrivilegeFence(command)).rejects.toMatchObject({ code: "EXTERNAL-TRANSACTION" });
  expect((await manager!.query("select current_setting('transaction_isolation') as isolation")).rows[0].isolation).toBe("read committed");
  await manager!.query("rollback"); expect(intents).toHaveLength(0);
});

it.each([
  ["owner", "RUNTIME-OWNER"], ["super", "PRIVILEGED-RUNTIME"], ["recovery", "ROLE-RECOVERY-UNSUPPORTED"],
  ["shared", "SHARED-ROLE-USE"], ["references", "CAPABILITY-OUTSIDE-EFFECT"], ["grant-option", "GRANT-CHAIN-UNSUPPORTED"],
] as const)("refuses unsupported %s scope before persisting intent or revoking", async (mode, code) => {
  await manager!.query(`grant select,update on public.${pg.escapeIdentifier(table)} to ${pg.escapeIdentifier(role)}`);
  if (mode === "owner") await manager!.query(`alter table public.${pg.escapeIdentifier(table)} owner to ${pg.escapeIdentifier(role)}`);
  if (mode === "super") await manager!.query(`alter role ${pg.escapeIdentifier(role)} superuser`);
  if (mode === "shared") await manager!.query(`grant ${pg.escapeIdentifier(role)} to ${pg.escapeIdentifier(capability)} with admin false`);
  if (mode === "references") await manager!.query(`grant references on public.${pg.escapeIdentifier(table)} to ${pg.escapeIdentifier(role)}`);
  if (mode === "grant-option") await manager!.query(`grant update on public.${pg.escapeIdentifier(table)} to ${pg.escapeIdentifier(role)} with grant option`);
  await expect(applyLegacySqlPrivilegeFence({ ...command, ...(mode === "recovery" ? { recoveryRoles: [] } : {}) })).rejects.toMatchObject({ code });
  expect(intents).toHaveLength(0);
  expect((await writer!.query(`update public.${pg.escapeIdentifier(table)} set specification_key=specification_key`)).rowCount).toBe(1);
});

it("does not fall back when the actual management session has changed role", async () => {
  await manager!.query(`set role ${pg.escapeIdentifier(role)}`);
  try { await expect(applyLegacySqlPrivilegeFence(command)).rejects.toMatchObject({ code: "MANAGEMENT-LOCK-REQUIRED" }); }
  finally { await manager!.query("reset role"); }
  expect(intents).toHaveLength(0);
});

it("refuses an unsafe actual management search path before identity observation or effect", async () => {
  await manager!.query("set search_path=public,pg_catalog");
  try {
    expect((await manager!.query("select pg_catalog.current_schemas(true)::text[] as schemas")).rows[0].schemas[0]).toBe("public");
    await expect(applyLegacySqlPrivilegeFence(command)).rejects.toMatchObject({ code: "RESOLUTION-UNSAFE" });
    expect(await inspectLegacySqlPrivilegeFence({ client: manager!, selection: command.selection,
      intentDigest: digestOf("absent-component-intent"), beforeEffect: command.beforeEffect })).toEqual({ outcome: "unknown" });
    expect(intents).toHaveLength(0);
  } finally { await manager!.query("reset search_path"); }
});

it("refuses the actual seventh-table competing lock before intent", async () => {
  const other = await pool!.connect();
  try {
    await other.query("begin"); await other.query("lock table public.dts_property_specs in row exclusive mode");
    await expect(applyLegacySqlPrivilegeFence(command)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(intents).toHaveLength(0);
  } finally { try { await other.query("rollback"); } finally { other.release(true); } }
});

it("keeps the actual committed effect inspectable after host acknowledgment failure and never replays it", async () => {
  await manager!.query(`grant select,update on public.${pg.escapeIdentifier(table)} to ${pg.escapeIdentifier(role)}`);
  await expect(applyLegacySqlPrivilegeFence({ ...command, persistHostStep: async () => { throw new Error("private-host-write-failure"); } }))
    .rejects.toMatchObject({ code: "OUTCOME-UNKNOWN" });
  expect(intents).toHaveLength(1);
  await expect(writer!.query(`update public.${pg.escapeIdentifier(table)} set specification_key=specification_key`)).rejects.toMatchObject({ code: "42501" });
  await expect(applyLegacySqlPrivilegeFence(command)).rejects.toMatchObject({ code: "ATTEMPT-REQUIRES-INSPECTION" });
  const inspect = { client: manager!, selection: command.selection, intentDigest: intents[0].intentDigest, beforeEffect: command.beforeEffect };
  expect(await inspectLegacySqlPrivilegeFence(inspect)).toEqual({ outcome: "legacy-sql-privileges-fenced-not-P13", intentDigest: intents[0].intentDigest });
  expect(await inspectLegacySqlPrivilegeFence({ ...inspect, selection: { ...inspect.selection, attemptId: "another-attempt" } })).toEqual({ outcome: "unknown" });
  await manager!.query(`grant update on public.${pg.escapeIdentifier(table)} to ${pg.escapeIdentifier(role)}`);
  expect(await inspectLegacySqlPrivilegeFence(inspect)).toEqual({ outcome: "unknown" });
});

it("freezes actual role membership until the final host acknowledgment and releases that lock afterwards", async () => {
  await manager!.query(`grant select,update on public.${pg.escapeIdentifier(table)} to ${pg.escapeIdentifier(role)}`);
  const other = await pool!.connect(); let grantCode = "not-attempted";
  try {
    await other.query("set lock_timeout='100ms'");
    const observed = await applyLegacySqlPrivilegeFence({ ...command, persistHostStep: async () => {
      try { await other.query(`grant pg_write_all_data to ${pg.escapeIdentifier(role)} with inherit true,set true,admin false`); grantCode = "succeeded"; }
      catch (error) { grantCode = typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "unknown"; }
    } });
    let writerChanged = false;
    try { writerChanged = (await writer!.query(`update public.${pg.escapeIdentifier(table)} set specification_key=specification_key`)).rowCount === 1; }
    catch (error) { expect((error as { code?: string }).code).toBe("42501"); }
    expect(observed.outcome).toBe("legacy-sql-privileges-fenced-not-P13");
    expect({ grantCode, writerChanged }).toEqual({ grantCode: "55P03", writerChanged: false });
    // The module has released its transaction locks; this same real grant is
    // now possible. This is test-owned restoration of a capability, not P13.
    await other.query(`grant pg_write_all_data to ${pg.escapeIdentifier(role)} with inherit true,set true,admin false`);
    expect((await writer!.query(`update public.${pg.escapeIdentifier(table)} set specification_key=specification_key`)).rowCount).toBe(1);
  } finally {
    try { await other.query(`revoke pg_write_all_data from ${pg.escapeIdentifier(role)}`); }
    finally { other.release(true); }
  }
});

it("freezes cross-database ACL dependencies until acknowledgment without touching the other database's grants", async () => {
  const second = await createSelfHostedPg16Database("sql_shared_dependency");
  const otherPool = new pg.Pool({ connectionString: second.url, max: 1, connectionTimeoutMillis: 2000, query_timeout: 5000 });
  otherPool.on("error", () => {});
  let other: pg.PoolClient | undefined, operationError: unknown, cleanupFailed = false;
  try {
    other = await acquireObservedManagementClient(otherPool, () => {});
    const identity = await readBindingDatabaseIdentity(other);
    expect(identity.systemIdentifier).toBe(command.selection.target.systemIdentifier);
    expect(identity.databaseOid).not.toBe(command.selection.target.databaseOid);
    await other.query("create table public.other_business(value integer); set lock_timeout='100ms'");
    await manager!.query(`grant select,update on public.${pg.escapeIdentifier(table)} to ${pg.escapeIdentifier(role)}`);
    let grantCode = "not-attempted";
    await applyLegacySqlPrivilegeFence({ ...command, persistHostStep: async () => {
      try { await other!.query(`grant select on public.other_business to ${pg.escapeIdentifier(role)}`); grantCode = "succeeded"; }
      catch (error) { grantCode = typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "unknown"; }
    } });
    const dependency = async () => (await manager!.query<{ present: boolean }>(`select exists(select 1 from pg_catalog.pg_shdepend
      where refclassid='pg_catalog.pg_authid'::regclass and refobjid=$1::oid and dbid=$2::oid) as present`,
    [command.runtimeRoles[0].oid, identity.databaseOid])).rows[0].present;
    expect({ grantCode, dependency: await dependency() }).toEqual({ grantCode: "55P03", dependency: false });
    // The same independent owned-DB grant succeeds after our locks end. It is
    // not revoked by the production effect; its owner cleans up this fixture.
    await other.query(`grant select on public.other_business to ${pg.escapeIdentifier(role)}`);
    expect(await dependency()).toBe(true);
  } catch (error) { operationError = error; throw error; }
  finally {
    for (const close of [() => other?.release(true), () => otherPool.end(), () => second.close()]) {
      try { await close(); } catch { cleanupFailed = true; }
    }
    if (cleanupFailed) {
      const cleanupError = new Error("sql-dependency-cleanup-failed");
      if (operationError) throw new AggregateError([operationError, cleanupError], "sql-dependency-operation-and-cleanup-failed");
      throw cleanupError;
    }
  }
});
