import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { assertOwnedUpgradeTestTarget } from "../../../../scripts/upgrade-test-target";
import { createPostgresDatabase } from "../../../shared/database/client";
import { applyMigrations } from "../../../shared/database/migrations";
import { readBindingDatabaseIdentity, type BindingDatabaseIdentity } from "../../parameter-bindings/cutoverImport/sourceBoundary";
import { applyBootstrapCredentialFence, inspectBootstrapCredentialFence, prepareBootstrapCredentialCustody } from "./bootstrapCredentialFence";
import { acquireObservedManagementClient } from "./managementCheckout";

// Exclusive parent-owned PG cluster only. These tests authenticate actual
// bootstrap sessions, not application startup or approved P12/P13 execution.
let admin: pg.PoolClient, pool: pg.Pool, target: BindingDatabaseIdentity, privateUrl: URL, maintenanceUrl: URL, directory: string;
beforeAll(async () => {
  assertOwnedUpgradeTestTarget();
  if (!process.env.TEST_DATABASE_URL || !process.env.UPG_TEST_TARGET_RECEIPT) throw new Error("owned-bootstrap-test-required");
  const receipt = JSON.parse(await readFile(process.env.UPG_TEST_TARGET_RECEIPT, "utf8"));
  if (receipt.url !== process.env.TEST_DATABASE_URL || receipt.profile !== "selfhost-postgres16-alpine-v1") throw new Error("owned-bootstrap-receipt-mismatch");
  maintenanceUrl = new URL(process.env.TEST_DATABASE_URL);
  const bootstrap = new pg.Pool({ connectionString: maintenanceUrl.href, max: 1, connectionTimeoutMillis: 2000, query_timeout: 5000 });
  bootstrap.on("error", () => {});
  const owner = await acquireObservedManagementClient(bootstrap, () => {});
  let businessOid: string;
  const businessName = `bootstrap_business_${randomBytes(8).toString("hex")}`;
  try {
    const identity = await readBindingDatabaseIdentity(owner);
    if (identity.systemIdentifier !== receipt.systemIdentifier || identity.databaseOid !== receipt.databaseOid || identity.databaseOid !== "5")
      throw new Error("owned-bootstrap-target-mismatch");
    await owner.query(`create database ${pg.escapeIdentifier(businessName)}`);
    businessOid = (await owner.query("select oid::text from pg_database where datname=$1", [businessName])).rows[0].oid;
  } finally { owner.release(true); await bootstrap.end(); }
  privateUrl = new URL(maintenanceUrl.href); privateUrl.pathname = `/${businessName}`;
  const database = createPostgresDatabase(privateUrl.href);
  try { await applyMigrations(database, path.resolve("server/migrations")); } finally { await database.close(); }
  pool = new pg.Pool({ connectionString: privateUrl.href, max: 1, connectionTimeoutMillis: 2000, query_timeout: 5000 });
  pool.on("error", () => {});
  admin = await acquireObservedManagementClient(pool, () => {});
  target = await readBindingDatabaseIdentity(admin);
  if (target.systemIdentifier !== receipt.systemIdentifier || target.databaseOid !== businessOid) throw new Error("owned-bootstrap-target-mismatch");
  await admin.query("select pg_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
  directory = await realpath(await mkdtemp(path.join(tmpdir(), "bootstrap-pg-private-")));
  await chmod(directory, 0o700);
});
afterAll(async () => { admin?.release(true); await pool?.end(); if (directory) await rm(directory, { recursive: true }); });

it.each(["wrong-target", "no-lock", "shared-lock", "active-session", "membership", "additional-database", "template-database", "maintenance-object", "maintenance-acl", "maintenance-session", "template-object", "template-acl", "transaction-sampling", "debug-parse", "replication-slot", "unsafe-search-path"])("refuses %s before any credential intent or role change", async fault => {
  const nonce = randomBytes(8).toString("hex"), runId = `rejected-${nonce}`;
  const custody = await prepareBootstrapCredentialCustody({ directory, custodianUid: process.getuid!(), oldSecret: decodeURIComponent(privateUrl.password) });
  let other: pg.Client | undefined;
  const roleName = `bootstrap_member_${nonce}`, dbName = `bootstrap_shared_${nonce}`;
  const role = (await admin.query("select to_jsonb(r) as value from pg_roles r where oid=10")).rows[0];
  try {
    if (fault === "no-lock" || fault === "shared-lock") await admin.query("select pg_advisory_unlock(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
    if (fault === "shared-lock") await admin.query("select pg_advisory_lock_shared(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
    if (fault === "active-session") { other = new pg.Client({ connectionString: privateUrl.href, connectionTimeoutMillis: 2000 }); other.on("error", () => {}); await other.connect(); }
    if (fault === "membership") { await admin.query(`create role ${roleName} nologin; grant ${pg.escapeIdentifier(decodeURIComponent(privateUrl.username))} to ${roleName}`); }
    if (fault === "additional-database" || fault === "template-database") await admin.query(`create database ${dbName}`);
    if (fault === "template-database") await admin.query(`alter database ${dbName} is_template true`);
    if (fault.startsWith("maintenance-") || fault === "template-object" || fault === "template-acl") {
      const faultUrl = new URL(maintenanceUrl.href); if (fault.startsWith("template-")) faultUrl.pathname = "/template1";
      other = new pg.Client({ connectionString: faultUrl.href, connectionTimeoutMillis: 2000 }); other.on("error", () => {}); await other.connect();
      if (fault.endsWith("-object")) await other.query(`create table public.${roleName}(id int)`);
      if (fault.endsWith("-acl")) await other.query("grant create on schema public to public");
      if (fault !== "maintenance-session") { await other.end(); other = undefined; }
    }
    if (fault === "transaction-sampling") await admin.query("set log_transaction_sample_rate=1");
    if (fault === "debug-parse") await admin.query("set debug_print_parse=on");
    if (fault === "replication-slot") await admin.query("select pg_create_physical_replication_slot($1)", [roleName]);
    if (fault === "unsafe-search-path") await admin.query("set search_path=public,pg_catalog");
    await expect(applyBootstrapCredentialFence({ client: admin, target: fault === "wrong-target" ? { ...target, databaseOid: "1" } : target,
      runId, attemptId: nonce, custody })).rejects.toThrow(fault === "wrong-target" ? "target-unproven" :
        fault === "transaction-sampling" || fault === "debug-parse" ? "logging-profile-unsupported" :
          fault === "replication-slot" ? "replication-profile-unsupported" :
            fault === "template-database" ? "maintenance-database-unsupported" :
              fault === "unsafe-search-path" ? "search-path-unsupported" : "bootstrap-");
    expect((await admin.query("select to_jsonb(r) as value from pg_roles r where oid=10")).rows[0]).toEqual(role);
    expect((await admin.query("select id from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$1", [runId])).rows).toEqual([]);
  } finally {
    await other?.end();
    if (fault === "transaction-sampling") await admin.query("reset log_transaction_sample_rate");
    if (fault === "debug-parse") await admin.query("reset debug_print_parse");
    if (fault === "replication-slot") await admin.query("select pg_drop_replication_slot($1)", [roleName]);
    if (fault === "unsafe-search-path") await admin.query("reset search_path");
    if (fault === "maintenance-object" || fault === "maintenance-acl" || fault === "template-object" || fault === "template-acl") {
      const faultUrl = new URL(maintenanceUrl.href); if (fault.startsWith("template-")) faultUrl.pathname = "/template1";
      const cleanup = new pg.Client({ connectionString: faultUrl.href, connectionTimeoutMillis: 2000 }); cleanup.on("error", () => {});
      try { await cleanup.connect(); await cleanup.query(fault.endsWith("-object") ? `drop table public.${roleName}` : "revoke create on schema public from public"); }
      finally { await cleanup.end(); }
    }
    if (fault === "membership") await admin.query(`revoke ${pg.escapeIdentifier(decodeURIComponent(privateUrl.username))} from ${roleName}; drop role ${roleName}`);
    if (fault === "template-database") await admin.query(`alter database ${dbName} is_template false`);
    if (fault === "additional-database" || fault === "template-database") await admin.query(`drop database ${dbName}`);
    if (fault === "shared-lock") await admin.query("select pg_advisory_unlock_shared(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
    if (fault === "no-lock" || fault === "shared-lock") await admin.query("select pg_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
    await custody.close();
  }
});

it("keeps the actual password statement invisible to an independently authenticated statistics reader", async () => {
  const nonce = randomBytes(8).toString("hex"), runId = `stats-${nonce}`, role = `stats_${nonce}`;
  const statsSecret = randomBytes(32).toString("hex");
  const custody = await prepareBootstrapCredentialCustody({ directory, custodianUid: process.getuid!(), oldSecret: decodeURIComponent(privateUrl.password) });
  const nextSecret = await readFile(path.join(directory, `${custody.receipt.version}.new`), "utf8");
  let observer: pg.Client | undefined, observed = false, secretAbsent = false;
  const originalQuery = admin.query;
  try {
    await admin.query(`create role ${role} login password ${pg.escapeLiteral(statsSecret)}; grant pg_read_all_stats to ${role}`);
    const observerUrl = new URL(privateUrl.href); observerUrl.username = role; observerUrl.password = statsSecret;
    observer = new pg.Client({ connectionString: observerUrl.href, connectionTimeoutMillis: 2000 });
    observer.on("error", () => {}); await observer.connect();
    expect((await observer.query(`select session_user=$1 as expected,not (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole)
      as restricted from pg_roles where rolname=session_user`, [role])).rows).toEqual([{ expected: true, restricted: true }]);
    const pid = (await admin.query("select pg_backend_pid() as pid")).rows[0].pid;
    await admin.query("select 'bootstrap-statistics-visible'::text");
    const baseline = (await observer.query("select query from pg_stat_activity where pid=$1", [pid])).rows;
    expect(baseline.length === 1 && baseline[0].query.includes("bootstrap-statistics-visible")).toBe(true);
    await admin.query(`insert into parameter_catalog.parameter_catalog_cutover_runs
      (id,source_snapshot_fingerprint,target_artifact_sha,target_catalog_release_digest,migration_contract_version,plan_digest,current_phase,state)
      values($1,$2,$3,$4,'component-pg16',$5,'P0','planned')`, [runId, nonce, "a".repeat(40), nonce, nonce]);
    // Await the real server acknowledgment, then inspect from a real restricted
    // LOGIN before another management query can replace its activity text.
    // This wrapper never substitutes a database result or stores query arguments.
    admin.query = new Proxy(originalQuery, { apply(query, receiver, args) {
      const result = Reflect.apply(query, receiver, args);
      if (typeof args[0] !== "string" || !args[0].startsWith("alter role ")) return result;
      return result.then(async (value: unknown) => {
        const rows = (await observer!.query("select query from pg_stat_activity where pid=$1", [pid])).rows;
        observed = rows.length === 1;
        secretAbsent = observed && typeof rows[0].query === "string" && !rows[0].query.includes(nextSecret);
        return value;
      });
    } });
    expect(await applyBootstrapCredentialFence({ client: admin, target, runId, attemptId: nonce, custody }))
      .toMatchObject({ outcome: "authentication-fenced-not-P13" });
    // Update only after the real effect's authentication postconditions succeed.
    privateUrl.password = nextSecret;
    expect(observed).toBe(true);
    expect(secretAbsent).toBe(true);
  } finally {
    admin.query = originalQuery;
    try { await observer?.end(); }
    finally { try { await admin.query(`drop role if exists ${role}`); } finally { await custody.close(); } }
  }
});

it("retires only the old TCP password, preserves bootstrap ownership/ACL/attributes, and reconciles the original private version", async () => {
  await admin.query("select pg_stat_clear_snapshot()");
  const bootstrapSessions = (await admin.query(`select backend_type,state,(application_name='') as unnamed,count(*)::int
    from pg_stat_activity where usesysid=10 and pid<>pg_backend_pid() group by backend_type,state,(application_name='')`)).rows;
  // This assertion exposes only session classes/counts; neither original
  // queries nor endpoints, users, credentials or backend PIDs are emitted.
  expect(bootstrapSessions).toEqual([{ backend_type: "logical replication launcher", state: null, unnamed: true, count: 1 }]);
  const nonce = randomBytes(8).toString("hex"), runId = `bootstrap-${nonce}`;
  // Register only a prepared run. No passing report, P12 checkpoint or P13
  // completion is invented to test this low-level management effect.
  await admin.query(`insert into parameter_catalog.parameter_catalog_cutover_runs
    (id,source_snapshot_fingerprint,target_artifact_sha,target_catalog_release_digest,migration_contract_version,plan_digest,current_phase,state)
    values($1,$2,$3,$4,'component-pg16',$5,'P0','planned')`, [runId, nonce, "a".repeat(40), nonce, nonce]);
  const table = `bootstrap_owner_${nonce}`;
  await admin.query(`create table public.${table}(id integer primary key); insert into public.${table} values(1); grant select on public.${table} to public`);
  const before = (await admin.query(`select c.oid::text,c.relowner::text,c.relacl::text,(select to_jsonb(r) from pg_roles r where r.oid=10) as role
    from pg_class c where c.oid=$1::regclass`, [`public.${table}`])).rows[0];
  const custody = await prepareBootstrapCredentialCustody({ directory, custodianUid: process.getuid!(), oldSecret: decodeURIComponent(privateUrl.password) });
  const command = { client: admin, target, runId, attemptId: `attempt-${nonce}`, custody };
  try {
    expect(await applyBootstrapCredentialFence(command)).toMatchObject({ outcome: "authentication-fenced-not-P13" });
    const after = (await admin.query(`select c.oid::text,c.relowner::text,c.relacl::text,(select to_jsonb(r) from pg_roles r where r.oid=10) as role
      from pg_class c where c.oid=$1::regclass`, [`public.${table}`])).rows[0];
    expect(after).toEqual(before);
    expect((await admin.query(`select id from public.${table}`)).rows).toEqual([{ id: 1 }]);
    expect(await inspectBootstrapCredentialFence(command)).toMatchObject({ outcome: "authentication-fenced-not-P13" });
    expect(await inspectBootstrapCredentialFence({ ...command, attemptId: "different-attempt" })).toEqual({ outcome: "unknown" });
    // The first real custody-file await yields. Mutating the caller's command
    // immediately afterwards must not replace the initially requested selection.
    const driftResults = [];
    for (const field of ["run", "attempt", "target"] as const) {
      const changed = { ...command, target: { ...target },
        runId: field === "run" ? "wrong-run" : runId,
        attemptId: field === "attempt" ? "wrong-attempt" : command.attemptId };
      if (field === "target") changed.target.databaseOid = "1";
      const pending = inspectBootstrapCredentialFence(changed);
      changed.runId = runId; changed.attemptId = command.attemptId; changed.target.databaseOid = target.databaseOid;
      driftResults.push(await pending);
    }
    expect(driftResults).toEqual([{ outcome: "unknown" }, { outcome: "unknown" }, { outcome: "unknown" }]);
    const evidence = (await admin.query("select payload::text from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$1", [runId])).rows;
    const newSecret = await readFile(path.join(directory, `${custody.receipt.version}.new`), "utf8");
    expect(JSON.stringify(evidence).includes(newSecret)).toBe(false);
    expect(JSON.stringify(evidence).includes(decodeURIComponent(privateUrl.password))).toBe(false);
    expect((await admin.query("select current_phase,state from parameter_catalog.parameter_catalog_cutover_runs where id=$1", [runId])).rows)
      .toEqual([{ current_phase: "P0", state: "planned" }]);
    expect((await admin.query("select phase from parameter_catalog.parameter_catalog_cutover_checkpoints where cutover_run_id=$1", [runId])).rows).toEqual([]);
  } finally { await custody.close(); }
});
