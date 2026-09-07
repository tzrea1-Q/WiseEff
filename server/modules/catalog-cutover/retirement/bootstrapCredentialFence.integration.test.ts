import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { connect, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { assertOwnedUpgradeTestTarget } from "../../../../scripts/upgrade-test-target";
import { createPostgresDatabase } from "../../../shared/database/client";
import { applyMigrations } from "../../../shared/database/migrations";
import { readBindingDatabaseIdentity, type BindingDatabaseIdentity } from "../../parameter-bindings/cutoverImport/sourceBoundary";
import { applyBootstrapCredentialFence, inspectBootstrapCredentialFence, prepareBootstrapCredentialCustody, reopenBootstrapCredentialCustody } from "./bootstrapCredentialFence";
import { acquireObservedManagementClient } from "./managementCheckout";
import { acquireBootstrapInventoryGuard } from "../../../../ops/self-hosted/scripts/parameter-catalog-upgrade/legacyWriterRetirement";
import { assertHostOperationLockForJournal, withHostOperationLock } from "../../../../ops/self-hosted/scripts/parameter-catalog-upgrade/handoff";
import { prepareUnapprovedBootstrapTransportBinding } from "./bootstrapCredentialFence.fixture";
import { digestOf } from "../../release-verification/core/digest";
import type { BootstrapRootBinding } from "./bootstrapCredentialFence";
import { applyLegacySqlPrivilegeFence } from "./legacySqlPrivilegeFence";
import { LEGACY_STRUCTURAL_TABLES } from "../../catalog-kernel/security/catalogRoleManifest";
import { openUpgradeJournal, commitJournalTransition, canonicalJson, sha256Prefixed } from "../../../../ops/self-hosted/scripts/parameter-catalog-upgrade/journal";

// Exclusive parent-owned PG cluster only. These tests authenticate actual
// bootstrap sessions, not application startup or approved P12/P13 execution.
let admin: pg.PoolClient, pool: pg.Pool, target: BindingDatabaseIdentity, privateUrl: URL, maintenanceUrl: URL, directory: string;
let initialManagerClosed = false;
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
async function closeInitialManager() {
  if (initialManagerClosed) return;
  initialManagerClosed = true; admin?.release(true); await pool?.end();
}
afterAll(async () => { await closeInitialManager(); if (directory) await rm(directory, { recursive: true }); });

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
    // Later fault cases use this actual current credential, never a presumed
    // successful rotation or a regenerated secret version.
    privateUrl.password = newSecret;
  } finally { await custody.close(); }
});

async function withFreshManager<T>(body: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const fresh = new pg.Pool({ connectionString: privateUrl.href, max: 1, connectionTimeoutMillis: 2000, query_timeout: 5000 });
  fresh.on("error", () => {});
  let client: pg.PoolClient | undefined;
  try {
    client = await acquireObservedManagementClient(fresh, () => {});
    expect(await readBindingDatabaseIdentity(client)).toEqual(target);
    await client.query("select pg_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
    return await body(client);
  } finally { client?.release(true); await fresh.end(); }
}

/** Fault transport only: its upstream is the already receipt-verified owned
 * database. Nothing is parsed from caller SQL, and no wire bytes are logged.
 * The first connection belongs to the child manager; authentication/read-only
 * probe connections retain their real unmodified PostgreSQL responses. */
async function commitFaultProxy(ordinal: 1 | 2) {
  const sockets = new Set<Socket>();
  let first = true, observed = false, closed = false;
  let notify!: () => void;
  const reached = new Promise<void>(resolve => { notify = resolve; });
  const server = createServer(downstream => {
    const manager = first; first = false;
    const upstream = connect({ host: privateUrl.hostname, port: Number(privateUrl.port) });
    let packets: Buffer = Buffer.alloc(0), commits = 0, held = false;
    for (const socket of [downstream, upstream]) {
      socket.setNoDelay(true);
      sockets.add(socket);
      socket.on("error", () => { downstream.destroy(); upstream.destroy(); });
      socket.on("close", () => { sockets.delete(socket); downstream.destroy(); upstream.destroy(); });
    }
    downstream.pipe(upstream);
    upstream.on("data", chunk => {
      if (held) return;
      packets = Buffer.concat([packets, chunk]);
      while (packets.length >= 5) {
        const size = packets.readUInt32BE(1) + 1;
        if (size < 5 || size > 8 * 1024 * 1024) { downstream.destroy(); upstream.destroy(); return; }
        if (packets.length < size) return;
        const message = packets.subarray(0, size); packets = packets.subarray(size);
        if (manager && message[0] === 67 && message.subarray(5).equals(Buffer.from("COMMIT\0")) && ++commits === ordinal) {
          // CommandComplete is emitted by the real server after commit. Hold
          // it before forwarding; ordinal 2 drops the actual live transport.
          held = true; packets = Buffer.alloc(0); observed = true; notify();
          if (ordinal === 2) { downstream.destroy(); upstream.destroy(); }
          return;
        }
        downstream.write(message);
      }
    });
  });
  // Keep an error observer throughout the owned server lifetime. The startup
  // promise also refuses bind errors, without forwarding OS endpoint details.
  server.on("error", () => { for (const socket of sockets) socket.destroy(); });
  try { await new Promise<void>((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  }); } catch {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    throw new Error("bootstrap-fault-proxy-unavailable");
  }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bootstrap-fault-proxy-unavailable");
  return { port: address.port, reached, get observed() { return observed; }, async close() {
    if (closed) return; closed = true;
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}

const bootstrapFaultChild = `
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
let pool, client, custody;
try {
  const input = JSON.parse(await readFile(process.argv[1], 'utf8'));
  const effects = await import(input.effectModule);
  const checkout = await import(input.checkoutModule);
  custody = await effects.reopenBootstrapCredentialCustody(input.custody);
  const password = await readFile(path.join(input.custody.directory, input.custody.receipt.version + '.old'), 'utf8');
  pool = new pg.Pool({ ...input.database, password, max: 1, connectionTimeoutMillis: 2000, query_timeout: 5000 });
  pool.on('error', () => {});
  client = await checkout.acquireObservedManagementClient(pool, () => {});
  await client.query("select pg_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
  await effects.applyBootstrapCredentialFence({ client, target: input.target, runId: input.runId, attemptId: input.attemptId, custody });
  process.exitCode = 22;
} catch (error) {
  process.exitCode = error instanceof Error && error.message === 'bootstrap-authentication-fence-outcome-unknown-inspect-original-version' ? 23 : 24;
  process.stderr.write('bootstrap-fault-child-refused\\n');
} finally {
  try { client?.release(true); await pool?.end(); await custody?.close(); }
  catch { process.exitCode = 25; }
}`;

const bootstrapInspectionChild = `
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { reopenBootstrapCredentialCustody, inspectBootstrapCredentialFence } from './server/modules/catalog-cutover/retirement/bootstrapCredentialFence.ts';
import { acquireObservedManagementClient } from './server/modules/catalog-cutover/retirement/managementCheckout.ts';
let pool, client, custody, result;
try {
  const input = JSON.parse(await readFile(process.argv[1], 'utf8'));
  custody = await reopenBootstrapCredentialCustody(input.custody);
  if (input.credentialFile !== 'old' && input.credentialFile !== 'new') throw new Error('invalid-selection');
  const password = await readFile(path.join(input.custody.directory, input.custody.receipt.version + '.' + input.credentialFile), 'utf8');
  pool = new pg.Pool({ ...input.database, password, max: 1, connectionTimeoutMillis: 2000, query_timeout: 5000 });
  pool.on('error', () => {});
  client = await acquireObservedManagementClient(pool, () => {});
  await client.query("select pg_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
  result = await inspectBootstrapCredentialFence({ client, target: input.target, runId: input.runId, attemptId: input.attemptId, custody });
} catch {
  process.exitCode = 30;
  process.stderr.write('bootstrap-independent-inspection-refused\\n');
} finally {
  try { client?.release(true); } catch { process.exitCode = 31; }
  const closed = await Promise.allSettled([pool?.end(), custody?.close()]);
  if (closed.some(item => item.status === 'rejected')) process.exitCode = 31;
}
if (!process.exitCode && result) process.stdout.write(JSON.stringify(result) + '\\n');
`;

async function inspectInIndependentProcess(inputPath: string, code = bootstrapInspectionChild,
  boundary?: () => Promise<void>): Promise<{ outcome: string; intentDigest?: string }> {
  const started = performance.now();
  // Fixed imports and code, inherited supervisor group, no credential argv/env.
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, inputPath],
    { cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let stdout = "", stderr = "", failed = false, timer: ReturnType<typeof setTimeout> | undefined;
  child.on("error", () => { failed = true; });
  let boundaryWork: Promise<void> | undefined;
  child.on("message", message => {
    if (typeof message === "string" && ["imports-ready", "manager-ready", "inspection-complete"].includes(message)) {
      console.info(JSON.stringify({ scope: "bootstrap-custody-timing", stage: message, elapsedMs: Math.round(performance.now() - started) }));
      return;
    }
    if (message !== "final-boundary" || !boundary || boundaryWork) { failed = true; child.kill("SIGKILL"); return; }
    boundaryWork = boundary().then(() => { child.send("boundary-complete"); }, () => { failed = true; child.kill("SIGKILL"); });
  });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  child.stdout!.on("data", chunk => {
    stdout = (stdout + chunk.toString()).slice(0, 4097);
    if (stdout.length > 4096) { failed = true; child.kill("SIGKILL"); }
  });
  child.stderr!.on("data", chunk => {
    stderr = (stderr + chunk.toString()).slice(0, 4097);
    if (stderr.length > 4096) { failed = true; child.kill("SIGKILL"); }
  });
  try {
    const exited = await Promise.race([closed, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("bootstrap-independent-inspection-timeout")), 1500);
    })]);
    if (failed || exited.code !== 0 || exited.signal || stderr.length) throw new Error("bootstrap-independent-inspection-failed");
    let result: { outcome?: unknown; intentDigest?: unknown };
    try { result = JSON.parse(stdout); } catch { throw new Error("bootstrap-independent-inspection-result-invalid"); }
    if (!result || typeof result !== "object" || Array.isArray(result) ||
        Object.keys(result).some(key => key !== "outcome" && key !== "intentDigest") ||
        !["not-applied", "authentication-fenced-not-P13", "unknown"].includes(String(result.outcome)) ||
        (result.intentDigest !== undefined && (typeof result.intentDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(result.intentDigest))))
      throw new Error("bootstrap-independent-inspection-result-invalid");
    return result as { outcome: string; intentDigest?: string };
  } finally {
    clearTimeout(timer); child.kill("SIGKILL"); await closed; await boundaryWork;
    console.info(JSON.stringify({ scope: "bootstrap-custody-timing", stage: "child-settled", elapsedMs: Math.round(performance.now() - started) }));
  }
}

// Static child code. Input contains a restricted management transport and the
// root's complete non-secret selection, never a bootstrap password or receipt.
const custodyTransportInspectionChild = `
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createPostgresDatabase } from './server/shared/database/client.ts';
import { acquireObservedManagementClient } from './server/modules/catalog-cutover/retirement/managementCheckout.ts';
import { inspectBootstrapCredentialFenceFromCustodyTransport } from './server/modules/catalog-cutover/retirement/bootstrapCredentialFence.ts';
import { withHostOperationLock, assertHostOperationLock } from './ops/self-hosted/scripts/parameter-catalog-upgrade/handoff.ts';
let pool, client, reports, result, ended = false, boundaryCalls = 0;
process.send('imports-ready');
try {
  const input = JSON.parse(await readFile(process.argv[1], 'utf8'));
  pool = new pg.Pool({ connectionString: input.guardUrl, max: 1, connectionTimeoutMillis: 2000, query_timeout: 5000 });
  pool.on('error', () => {});
  client = await acquireObservedManagementClient(pool, () => {});
  process.send('manager-ready');
  reports = createPostgresDatabase(input.guardUrl);
  const unavailable = async () => { throw new Error('unapproved-storage-only'); };
  result = await withHostOperationLock(input.expectedRootBinding.custodyDirectory, async lock => {
    const activation = { managementPool: pool, reports, target: input.expectedRootBinding.target,
      boundary: { withLockedBoundary: unavailable, observe: unavailable,
        verify: async () => {
          boundaryCalls++;
          await assertHostOperationLock(lock, input.expectedRootBinding.custodyDirectory);
          if (input.fault === 'final-boundary' && boundaryCalls === 6) {
            await new Promise((resolve, reject) => {
              process.once('message', message => message === 'boundary-complete' ? resolve() : reject(new Error('boundary-refused')));
              process.send('final-boundary');
            });
          }
          // This real activation boundary is reached only after the facade's
          // private OID10 connected. A graceful borrowed-session end must
          // cancel that live inspection, just as an error does.
          if (input.fault === 'guard-ended' && !ended) { ended = true; await client.end(); }
        } },
      journal: { pending: unavailable, committed: unavailable, unknown: unavailable } };
    const selected = await inspectBootstrapCredentialFenceFromCustodyTransport({ managementClient: client,
      expectedRootBinding: input.expectedRootBinding, activation,
      ...(input.sqlSuccessor ? { sqlSuccessor: { ...input.sqlSuccessor, lock } } : {}) });
    // The facade borrows the lease and must restore its role/transaction state.
    if (input.fault === 'guard-ended') {
      if (!ended || selected.outcome !== 'unknown') throw new Error('ended-guard-was-not-observed');
    } else {
      const stillOwned = (await client.query("select session_user=current_user as same, pg_current_xact_id_if_assigned() is null as idle")).rows[0];
      if (!stillOwned.same || !stillOwned.idle) throw new Error('borrowed-management-state-changed');
    }
    return selected;
  });
  process.send('inspection-complete');
} catch { process.exitCode = 30; process.stderr.write('custody-transport-inspection-refused\\n'); }
finally {
  const released = await Promise.allSettled([Promise.resolve().then(() => client?.release(true))]);
  const closed = await Promise.allSettled([Promise.resolve().then(() => pool?.end()), Promise.resolve().then(() => reports?.close())]);
  if ([...released, ...closed].some(r => r.status === 'rejected')) process.exitCode = 31;
}
if (!process.exitCode && result) process.stdout.write(JSON.stringify(result) + '\\n');
`;

type AuthenticationMode = "exact" | "cross-run" | "package-drift" | "guard-ended";
type SuccessorMode = "baseline" | "missing-host" | "wrong-host-run" | "extra-acl" | "new-relation" | "host-association" | "final-boundary";

async function failCustodyPreparation(error: unknown, stage: string, cleanup: () => Promise<void>): Promise<never> {
  await cleanup();
  throw error;
}

it("preserves safe preparation and cleanup reasons when both fail", async () => {
  const primary = Object.assign(new Error("private-primary-material"), { code: "42501" });
  let attempts = 0;
  const failure = await failCustodyPreparation(primary, "storage-binding", async () => {
    attempts += 1;
    throw new Error("private-cleanup-material");
  }).catch(error => error);
  expect(attempts).toBe(1);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.errors.map((error: Error) => error.message)).toEqual([
    "bootstrap-transport-setup-failed:storage-binding:42501", "bootstrap-transport-cleanup-failed",
  ]);
  expect(JSON.stringify(failure, Object.getOwnPropertyNames(failure))).not.toContain("private-");
});

it("keeps the original preparation failure after successful cleanup", async () => {
  const primary = new Error("bootstrap-transport-source-identity-mismatch");
  let attempts = 0;
  await expect(failCustodyPreparation(primary, "storage-binding", async () => { attempts += 1; })).rejects.toBe(primary);
  expect(attempts).toBe(1);
});

describe("independent custody transport lifecycle", () => {
  let fixture: Awaited<ReturnType<typeof prepareCustodyTransport>>;
  let inFlight: Promise<void> | undefined;
  const run = (work: () => Promise<void>) => {
    if (inFlight) throw new Error("bootstrap-transport-overlapping-case");
    inFlight = Promise.resolve().then(work);
    return inFlight;
  };
  const drain = async () => {
    // Vitest timeout does not cancel its callback. Keep the owning hook waiting
    // for actual child/DB cleanup before allowing another case to enter.
    const current = inFlight;
    await Promise.allSettled(current ? [current] : []);
    if (inFlight === current) inFlight = undefined;
  };
  beforeAll(async () => {
    await run(async () => { fixture = await prepareCustodyTransport(); });
    await drain();
  });
  afterEach(drain);
  afterAll(async () => { await drain(); await fixture?.close(); });
  it.each<AuthenticationMode>(["exact", "cross-run", "package-drift", "guard-ended"])(
    "checks original authentication selection %s in one independent process", mode => run(() => fixture.authentication(mode)));
  describe("recorded SQL successor", () => {
    beforeAll(async () => { await run(() => fixture.prepareSuccessor()); await drain(); });
    it.each<SuccessorMode>(["baseline", "missing-host", "wrong-host-run", "extra-acl", "new-relation", "host-association", "final-boundary"])(
      "checks successor selection %s with original custody and real locks", mode => run(() => fixture.successor(mode)));
  });
});

async function prepareCustodyTransport() {
  const preparedAt = performance.now();
  await closeInitialManager();
  const nonce = randomBytes(8).toString("hex"), role = `transport_guard_${nonce}`, writerRole = `transport_writer_${nonce}`;
  const managers = new pg.Pool({ connectionString: privateUrl.href, max: 3, connectionTimeoutMillis: 2000, query_timeout: 5000 });
  managers.on("error", () => {});
  let client: pg.PoolClient | undefined, custody: Awaited<ReturnType<typeof prepareBootstrapCredentialCustody>> | undefined;
  let created = false, writerCreated = false, failed = false, ending: Promise<void> | undefined;
  const endManagers = () => ending ??= managers.end();
  const cleanup = async () => {
    const first = await Promise.allSettled([Promise.resolve().then(() => client?.release(true))]);
    const second = await Promise.allSettled([Promise.resolve().then(endManagers), Promise.resolve().then(() => custody?.close())]);
    const settings = await Promise.allSettled([Promise.resolve().then(() => withFreshManager(cleanup =>
      cleanup.query(`alter role ${pg.escapeIdentifier(decodeURIComponent(privateUrl.username))} reset application_name`)))]);
    const third = await Promise.allSettled([Promise.resolve().then(async () => {
      if (created) { await withFreshManager(cleanup => cleanup.query(`drop role ${role}`)); created = false; }
    }), Promise.resolve().then(async () => {
      if (writerCreated) { await withFreshManager(cleanup => cleanup.query(`drop owned by ${writerRole}; drop role ${writerRole}`)); writerCreated = false; }
    })]);
    if ([...first, ...second, ...settings, ...third].some(r => r.status === "rejected"))
      throw new Error(failed ? "bootstrap-transport-operation-and-cleanup-failed" : "bootstrap-transport-cleanup-failed");
  };
  try {
    // Actual S7 P0–P10, mapping inventory and storage binding. No report or
    // approved P12 is generated; this is not whole-root retirement acceptance.
    const binding = await prepareUnapprovedBootstrapTransportBinding({ pool: managers, target, directory });
    client = await acquireObservedManagementClient(managers, () => {});
    const guardUrl = new URL(privateUrl.href); guardUrl.username = role; guardUrl.password = randomBytes(32).toString("hex");
    await client.query(`create role ${role} login noinherit password ${pg.escapeLiteral(decodeURIComponent(guardUrl.password))}`);
    created = true;
    await client.query(`grant catalog_migration_owner to ${role} with inherit false, set true, admin false`);
    // The future SQL successor's exact preimage already exists when the
    // authentication owner captures its immutable baseline. No extra grant is
    // smuggled in between authentication and successor inspection.
    await client.query(`create role ${writerRole} login noinherit password ${pg.escapeLiteral(randomBytes(32).toString("hex"))}`);
    writerCreated = true;
    const writerOid = (await client.query("select oid::text from pg_catalog.pg_roles where rolname=$1", [writerRole])).rows[0].oid;
    const legacyTables = [...LEGACY_STRUCTURAL_TABLES, "driver_schemas", "driver_schema_versions", "dts_property_specs"];
    await client.query(`grant select,update on ${legacyTables.map(name => `public.${pg.escapeIdentifier(name)}`).join(",")} to ${writerRole}`);
    await client.query("select pg_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
    custody = await prepareBootstrapCredentialCustody({ directory, custodianUid: process.getuid!(), oldSecret: decodeURIComponent(privateUrl.password) });
    const expectedRootBinding: BootstrapRootBinding = {
      contract: "pcat-bootstrap-application-authentication-v1", runId: binding.intent.runId,
      attemptId: `transport-${nonce}`, activationIntent: binding.intent, activationBindingDigest: binding.bindingDigest,
      handoffDigest: digestOf("unapproved-component-handoff"), recoveryPackageDigest: digestOf("unapproved-component-package").slice(7),
      recoveryPointDigest: digestOf("unapproved-component-recovery-point"), target,
      roleName: decodeURIComponent(privateUrl.username), custodyDirectory: directory,
    };
    const request = { ...expectedRootBinding, credentials: custody.receipt };
    await client.query(`insert into parameter_catalog.parameter_catalog_cutover_events(id,cutover_run_id,sequence_number,phase,event_kind,payload)
      select $1,$2,coalesce(max(sequence_number),0)+1,'P13','bootstrap-application-authentication-intent',$3::jsonb
      from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$2`,
    [nonce, binding.intent.runId, JSON.stringify({ request, requestDigest: digestOf(request) })]);
    const fenced = await applyBootstrapCredentialFence({ client, target, runId: binding.intent.runId,
      attemptId: expectedRootBinding.attemptId, custody });
    const oldUrl = privateUrl.href;
    privateUrl.password = await readFile(path.join(directory, `${custody.receipt.version}.new`), "utf8");
    await custody.close(); custody = undefined;
    client.release(true); client = undefined; await endManagers();
    const old = new pg.Client({ connectionString: oldUrl, connectionTimeoutMillis: 2000 }); old.on("error", () => {});
    try { await expect(old.connect()).rejects.toMatchObject({ code: "28P01" }); } finally { await old.end(); }
    console.info(JSON.stringify({ scope: "bootstrap-custody-timing", stage: "authentication-setup", elapsedMs: Math.round(performance.now() - preparedAt) }));
    const authentication = async (selectedMode: AuthenticationMode) => {
      const selected = { ...structuredClone(expectedRootBinding) };
      if (selectedMode === "cross-run") selected.runId = `wrong-${nonce}`;
      if (selectedMode === "package-drift") selected.recoveryPackageDigest = digestOf("different-package").slice(7);
      const inputPath = path.join(directory, `${nonce}-${selectedMode}.transport-input`);
      await writeFile(inputPath, JSON.stringify({ guardUrl: guardUrl.href, expectedRootBinding: selected, fault: selectedMode }), { mode: 0o600, flag: "wx" });
      expect(await inspectInIndependentProcess(inputPath, custodyTransportInspectionChild))
        .toEqual(selectedMode === "exact" ? fenced : { outcome: "unknown" });
    };
    // Real successor effect and host persistence, followed by another OS
    // process using only the original restricted transport/custody selection.
    // This remains storage-linked component evidence, not approved root P12.
    const journalPath = path.join(directory, `${nonce}.successor-journal.json`), hostRunId = `host-${nonce}`;
    const prepareSuccessor = async () => {
    const sqlAt = performance.now();
    await withHostOperationLock(directory, async lock => {
      const opened = openUpgradeJournal({ journalPath, runId: hostRunId });
      if (!opened.ok) throw new Error("bootstrap-successor-journal-unavailable");
      const journal = opened.value;
      // Typed storage records select the existing component request. They are
      // not an actual captured package, approved P12 or whole-root fixture.
      const save = (draft: Parameters<typeof commitJournalTransition>[1]) => {
        const saved = commitJournalTransition(journal, draft);
        if (!saved.ok || saved.value.replayed) throw new Error("bootstrap-successor-fixture-record-refused");
      };
      save({ action: "bind-cutover", inputDigest: "component-binding", cutoverRunId: binding.intent.runId,
        planDigest: binding.intent.planDigest, toState: "idle", nextAction: "plan" });
      const identity = await stat(directory);
      const source = { deploymentId: "component", hostFingerprint: "component", postgresIdentity: "component", objectStoreIdentity: "component", redisIdentity: "component" };
      const pending = { runId: hostRunId, attemptId: `capture-${nonce}`, outcome: "pending" as const, source,
        directory: { path: directory, device: String(identity.dev), inode: String(identity.ino) } };
      const capture = { runId: hostRunId, packageDigest: expectedRootBinding.recoveryPackageDigest,
        recoveryPointDigest: expectedRootBinding.recoveryPointDigest, source, boundaryDigest: "c".repeat(64) };
      const captureDigest = sha256Prefixed(canonicalJson(capture));
      for (const event of [pending, { ...pending, outcome: "committed" as const, capture }])
        save({ action: event.outcome === "pending" ? "recovery-capture-pending" : "recovery-package-captured",
          inputDigest: sha256Prefixed(canonicalJson(event.outcome === "pending" ? event : capture)),
          toState: "idle", nextAction: "plan", outcome: event.outcome === "pending" ? "crashed" : "committed", recoveryCapture: event });
      const retirementIntent = { hostRunId, rootBinding: expectedRootBinding, captureDigest,
        rootRequestDigest: digestOf(request), credentialVersion: request.credentials.version };
      for (const event of [{ intent: retirementIntent, outcome: "pending" as const },
        { intent: retirementIntent, outcome: "credential-step" as const, credentialIntentDigest: fenced.intentDigest }])
        save({ action: `bootstrap-retirement-${event.outcome}`, inputDigest: sha256Prefixed(canonicalJson(event)),
          toState: "idle", nextAction: "plan", outcome: event.outcome === "pending" ? "crashed" : "committed", bootstrapRetirement: event });
      const append = async (outcome: "pending" | "applied", intentDigest: string) => {
        await assertHostOperationLockForJournal(lock, journalPath);
        const saved = commitJournalTransition(journal, { action: `legacy-sql-privileges-${outcome}`,
          inputDigest: intentDigest, toState: journal.record.state, nextAction: journal.record.nextAction,
          outcome: outcome === "applied" ? "committed" : "crashed" });
        if (!saved.ok || saved.value.replayed) throw new Error("bootstrap-successor-journal-refused");
      };
      await withFreshManager(async fresh => {
        const result = await applyLegacySqlPrivilegeFence({ client: fresh,
          selection: { runId: binding.intent.runId, attemptId: expectedRootBinding.attemptId, target,
            activationBindingDigest: binding.bindingDigest, rootRequestDigest: digestOf(request),
            recoveryPackageDigest: expectedRootBinding.recoveryPackageDigest },
          runtimeRoles: [{ oid: writerOid, name: writerRole }],
          recoveryRoles: [{ name: writerRole, login: true, inherit: false, members: [] }],
          beforeEffect: () => assertHostOperationLockForJournal(lock, journalPath),
          persistHostIntent: intent => append("pending", intent.intentDigest),
          persistHostStep: intentDigest => append("applied", intentDigest),
        });
        expect(result.outcome).toBe("legacy-sql-privileges-fenced-not-P13");
        expect((await fresh.query(`select count(*)::int as count from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
          and c.relname=any($1::text[]) and pg_catalog.has_table_privilege($2,c.oid,'UPDATE')`, [legacyTables, writerRole])).rows)
          .toEqual([{ count: 0 }]);
      });
    });
    console.info(JSON.stringify({ scope: "bootstrap-custody-timing", stage: "sql-successor-setup", elapsedMs: Math.round(performance.now() - sqlAt) }));
    };
    const successor = async (mode: SuccessorMode) => {
    const successorInput = path.join(directory, `${nonce}.${mode}.successor-input`);
    if (mode === "host-association") {
      await withHostOperationLock(directory, async lock => {
        const original = openUpgradeJournal({ journalPath, runId: hostRunId });
        if (!original.ok) throw new Error("host-association-fixture-unavailable");
        for (const selectedRun of [binding.intent.runId, `different-${nonce}`]) {
          const copiedPath = path.join(directory, `${selectedRun}.copied-journal`);
          const copy = openUpgradeJournal({ journalPath: copiedPath, runId: hostRunId });
          if (!copy.ok) throw new Error("host-association-fixture-unavailable");
          for (const entry of original.value.record.entries.filter(entry => entry.action.startsWith("legacy-sql-privileges-"))) {
            await assertHostOperationLockForJournal(lock, copiedPath);
            if (!commitJournalTransition(copy.value, { action: entry.action, inputDigest: entry.inputDigest,
              outcome: entry.outcome, cutoverRunId: selectedRun, planDigest: binding.intent.planDigest,
              toState: "idle", nextAction: "plan" }).ok) throw new Error("host-association-copy-refused");
          }
        }
      });
      for (const selectedRun of [binding.intent.runId, `different-${nonce}`]) {
        const file = path.join(directory, `${selectedRun}.copied-input`);
        await writeFile(file, JSON.stringify({ guardUrl: guardUrl.href, expectedRootBinding,
          sqlSuccessor: { journalPath: path.join(directory, `${selectedRun}.copied-journal`), hostRunId } }), { mode: 0o600, flag: "wx" });
        expect(await inspectInIndependentProcess(file, custodyTransportInspectionChild)).toEqual({ outcome: "unknown" });
      }
      return;
    }
    if (mode === "extra-acl" || mode === "new-relation") {
      const alteredTable = `transport_unrecorded_${nonce}`;
      await withFreshManager(fresh => fresh.query(mode === "extra-acl"
        ? `grant delete on public.${pg.escapeIdentifier(LEGACY_STRUCTURAL_TABLES[1])} to ${writerRole}`
        : `create table public.${alteredTable}(id integer)`));
      try {
        await writeFile(successorInput, JSON.stringify({ guardUrl: guardUrl.href, expectedRootBinding,
          fault: mode, sqlSuccessor: { journalPath, hostRunId } }), { mode: 0o600, flag: "wx" });
        expect(await inspectInIndependentProcess(successorInput, custodyTransportInspectionChild)).toEqual({ outcome: "unknown" });
      } finally {
        await withFreshManager(fresh => fresh.query(mode === "extra-acl"
          ? `revoke delete on public.${pg.escapeIdentifier(LEGACY_STRUCTURAL_TABLES[1])} from ${writerRole}`
          : `drop table public.${alteredTable}`));
      }
      return;
    }
    await writeFile(successorInput, JSON.stringify({ guardUrl: guardUrl.href, expectedRootBinding,
      fault: mode, ...(mode === "missing-host" ? {} : { sqlSuccessor: { journalPath, hostRunId: mode === "wrong-host-run" ? "wrong-host-run" : hostRunId } }) }),
    { mode: 0o600, flag: "wx" });
    const blockedGrants: string[] = [];
    const grantCommands = [
      `grant update on public.${pg.escapeIdentifier(LEGACY_STRUCTURAL_TABLES[1])} to ${writerRole}`,
      `grant update(specification_key) on public.${pg.escapeIdentifier(LEGACY_STRUCTURAL_TABLES[1])} to ${writerRole}`,
      `create function public.successor_metadata_${nonce}() returns integer language sql as 'select 1'`,
      `alter role ${pg.escapeIdentifier(expectedRootBinding.roleName)} set application_name='successor-setting'`,
    ];
    const observed = await inspectInIndependentProcess(successorInput, custodyTransportInspectionChild, mode === "final-boundary" ? async () => {
      // A real second management session, opened only in this boundary window
      // and closed before auth's session inventory is checked again. No S7.
      const other = new pg.Client({ connectionString: privateUrl.href, connectionTimeoutMillis: 2000 }); other.on("error", () => {});
      try {
        await other.connect(); await other.query("set lock_timeout='50ms'");
        for (const sql of grantCommands) {
          try { await other.query(sql); }
          catch (error) { if ((error as { code?: string }).code !== "55P03") throw new Error("successor-boundary-unexpected-failure"); blockedGrants.push(sql); }
        }
      } finally { await other.end(); }
    } : undefined);
    expect(observed).toEqual(mode === "missing-host" || mode === "wrong-host-run" ? { outcome: "unknown" } : fenced);
    if (mode === "final-boundary") {
      expect(blockedGrants).toEqual(grantCommands);
      await withFreshManager(async fresh => {
        expect((await fresh.query(`select pg_catalog.has_table_privilege($1,$2,'UPDATE') as relation,
          pg_catalog.has_column_privilege($1,$2,'specification_key','UPDATE') as attribute`,
        [writerRole, `public.${LEGACY_STRUCTURAL_TABLES[1]}`])).rows).toEqual([{ relation: false, attribute: false }]);
        // Both real GRANTs work after the inspection transaction ends. The
        // denial above was held metadata locks, not missing management rights.
        try {
          for (const sql of grantCommands) await fresh.query(sql);
          expect((await fresh.query(`select pg_catalog.has_table_privilege($1,$2,'UPDATE') as relation,
            pg_catalog.has_column_privilege($1,$2,'specification_key','UPDATE') as attribute`,
          [writerRole, `public.${LEGACY_STRUCTURAL_TABLES[1]}`])).rows).toEqual([{ relation: true, attribute: true }]);
        } finally {
          await fresh.query(`revoke update,update(specification_key) on public.${pg.escapeIdentifier(LEGACY_STRUCTURAL_TABLES[1])} from ${writerRole}`);
          await fresh.query(`drop function if exists public.successor_metadata_${nonce}()`);
          await fresh.query(`alter role ${pg.escapeIdentifier(expectedRootBinding.roleName)} reset application_name`);
        }
      });
      return;
    }
    };
    return { authentication, prepareSuccessor, successor, close: cleanup };
  } catch (error) { failed = true; return failCustodyPreparation(error, "storage-binding", cleanup); }
}

async function exerciseCommitFault(ordinal: 1 | 2, independentInspection: boolean) {
  await closeInitialManager();
  const nonce = randomBytes(8).toString("hex"), runId = `fault-${nonce}`, attemptId = `attempt-${nonce}`;
  const before = await withFreshManager(async client => {
    await client.query(`insert into parameter_catalog.parameter_catalog_cutover_runs
      (id,source_snapshot_fingerprint,target_artifact_sha,target_catalog_release_digest,migration_contract_version,plan_digest,current_phase,state)
      values($1,$2,$3,$4,'component-pg16',$5,'P0','planned')`, [runId, nonce, "a".repeat(40), nonce, nonce]);
    return (await client.query("select to_jsonb(r) as value from pg_roles r where oid=10")).rows[0];
  });
  let custody = await prepareBootstrapCredentialCustody({ directory, custodianUid: process.getuid!(), oldSecret: decodeURIComponent(privateUrl.password) });
  const proxy = await commitFaultProxy(ordinal).catch(async () => {
    await custody.close(); throw new Error("bootstrap-fault-proxy-unavailable");
  });
  let child: ReturnType<typeof spawn> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
  let diagnostics = "";
  try {
    const inputPath = path.join(directory, `${nonce}.child-input`);
    await writeFile(inputPath, JSON.stringify({ database: { host: "127.0.0.1", port: proxy.port,
      database: decodeURIComponent(privateUrl.pathname.slice(1)), user: decodeURIComponent(privateUrl.username) },
    target, runId, attemptId, custody: { directory, custodianUid: process.getuid!(), receipt: custody.receipt },
    effectModule: pathToFileURL(path.resolve("server/modules/catalog-cutover/retirement/bootstrapCredentialFence.ts")).href,
    checkoutModule: pathToFileURL(path.resolve("server/modules/catalog-cutover/retirement/managementCheckout.ts")).href }), { mode: 0o600, flag: "wx" });
    // No detached process: the existing parent supervisor also owns this child
    // if Vitest is forcibly stopped. Credentials stay in private custody files.
    child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", bootstrapFaultChild, inputPath],
      { cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ["ignore", "pipe", "pipe"] });
    closed = new Promise(resolve => { child!.once("error", () => resolve({ code: -1, signal: null }));
      child!.once("close", (code, signal) => resolve({ code, signal })); });
    for (const output of [child.stdout!, child.stderr!]) output.on("data", chunk => {
      diagnostics = (diagnostics + chunk.toString()).slice(0, 4097); if (diagnostics.length > 4096) child!.kill("SIGKILL");
    });
    await Promise.race([proxy.reached, closed.then(() => { if (!proxy.observed) throw new Error("bootstrap-child-ended-before-fault"); }), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("bootstrap-fault-commit-not-observed")), 2000);
    })]);
    clearTimeout(timer);
    if (ordinal === 1) child.kill("SIGTERM");
    const exited = await Promise.race([closed, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("bootstrap-fault-child-did-not-close")), 1000);
    })]);
    clearTimeout(timer);
    expect(exited).toEqual(ordinal === 1 ? { code: null, signal: "SIGTERM" } : { code: 23, signal: null });
    expect(proxy.observed).toBe(true);
    await proxy.close();
    const oldSecret = await readFile(path.join(directory, `${custody.receipt.version}.old`), "utf8");
    const newSecret = await readFile(path.join(directory, `${custody.receipt.version}.new`), "utf8");
    expect(diagnostics.includes(oldSecret) || diagnostics.includes(newSecret)).toBe(false);
    if (ordinal === 2) privateUrl.password = newSecret;
    let independentResult: Awaited<ReturnType<typeof inspectInIndependentProcess>> | undefined;
    if (independentInspection) {
      const receipt = custody.receipt;
      await custody.close();
      // All original parent FDs are closed before the second process starts.
      // Its only state comes from these existing private files and the original
      // receipt/target; no password, observed outcome, or passed flag is supplied.
      const inspectionInput = path.join(directory, `${nonce}.inspection-input`);
      await writeFile(inspectionInput, JSON.stringify({ database: { host: privateUrl.hostname, port: Number(privateUrl.port),
        database: decodeURIComponent(privateUrl.pathname.slice(1)), user: decodeURIComponent(privateUrl.username) },
      target, runId, attemptId, credentialFile: ordinal === 1 ? "old" : "new",
      custody: { directory, custodianUid: process.getuid!(), receipt } }), { mode: 0o600, flag: "wx" });
      independentResult = await inspectInIndependentProcess(inspectionInput);
      expect(independentResult.outcome).toBe(ordinal === 1 ? "not-applied" : "authentication-fenced-not-P13");
      // Subsequent parent-side counterexamples also use newly opened custody,
      // never the closed instance from preparation or either child process.
      custody = await reopenBootstrapCredentialCustody({ directory, custodianUid: process.getuid!(), receipt });
    }
    await withFreshManager(async client => {
      const command = { client, target, runId, attemptId, custody };
      expect(await inspectBootstrapCredentialFence(command)).toMatchObject({ outcome: ordinal === 1 ? "not-applied" : "authentication-fenced-not-P13" });
      expect(await inspectBootstrapCredentialFence({ ...command, attemptId: "different" })).toEqual({ outcome: "unknown" });
      const rows = (await client.query("select event_kind from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$1 order by sequence_number", [runId])).rows;
      expect(rows).toEqual((ordinal === 1 ? ["bootstrap-authentication-fence-intent"] :
        ["bootstrap-authentication-fence-intent", "bootstrap-authentication-fence-applied"]).map(event_kind => ({ event_kind })));
      if (independentResult) {
        const actualIntent = (await client.query("select payload->>'digest' as digest from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$1 and event_kind='bootstrap-authentication-fence-intent'", [runId])).rows;
        expect(actualIntent).toHaveLength(1);
        expect(independentResult.intentDigest).toBe(actualIntent[0].digest);
      }
      expect((await client.query("select to_jsonb(r) as value from pg_roles r where oid=10")).rows[0]).toEqual(before);
      const count = rows.length;
      await expect(applyBootstrapCredentialFence(command)).rejects.toThrow("bootstrap-authentication-fence-");
      expect((await client.query("select id from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$1", [runId])).rowCount).toBe(count);
      expect((await client.query("select phase from parameter_catalog.parameter_catalog_cutover_checkpoints where cutover_run_id=$1", [runId])).rows).toEqual([]);
    });
  } finally {
    clearTimeout(timer); child?.kill("SIGKILL"); await closed?.catch(() => undefined);
    const cleanup = await Promise.allSettled([proxy.close(), custody.close()]);
    if (cleanup.some(result => result.status === "rejected")) throw new Error("bootstrap-fault-cleanup-failed");
  }
}

it.each([1, 2] as const)("reconciles the original version after actual commit %s acknowledgment loss and process exit",
  ordinal => exerciseCommitFault(ordinal, false));
it.each([1, 2] as const)("reopens only original private custody in a second process after actual commit %s acknowledgment loss",
  ordinal => exerciseCommitFault(ordinal, true));

/** Executes the root's actual guard implementation, not a copied lock query.
 * It deliberately has only a prepared run, without fake P12/report approval. */
async function withRootGuardFixture(body: (f: {
  client: pg.PoolClient; guards: pg.Pool; role: string; runId: string;
  custody: Awaited<ReturnType<typeof prepareBootstrapCredentialCustody>>;
  acquire(): ReturnType<typeof acquireBootstrapInventoryGuard>;
}) => Promise<void>) {
  await closeInitialManager();
  const nonce = randomBytes(8).toString("hex"), role = `bootstrap_guard_${nonce}`, runId = `guard-${nonce}`;
  const managers = new pg.Pool({ connectionString: privateUrl.href, max: 1, connectionTimeoutMillis: 2000, query_timeout: 5000 });
  managers.on("error", () => {});
  let client: pg.PoolClient | undefined, guards: pg.Pool | undefined;
  let guard: Awaited<ReturnType<typeof acquireBootstrapInventoryGuard>> | undefined;
  let custody: Awaited<ReturnType<typeof prepareBootstrapCredentialCustody>> | undefined;
  let released = false, created = false, failed = false;
  try {
    client = await acquireObservedManagementClient(managers, () => {});
    expect(await readBindingDatabaseIdentity(client)).toEqual(target);
    const guardUrl = new URL(privateUrl.href); guardUrl.username = role; guardUrl.password = randomBytes(32).toString("hex");
    await client.query(`create role ${role} login noinherit password ${pg.escapeLiteral(decodeURIComponent(guardUrl.password))}`);
    created = true;
    await client.query(`grant catalog_migration_owner to ${role} with inherit false, set true, admin false`);
    await client.query(`insert into parameter_catalog.parameter_catalog_cutover_runs
      (id,source_snapshot_fingerprint,target_artifact_sha,target_catalog_release_digest,migration_contract_version,plan_digest,current_phase,state)
      values($1,$2,$3,$4,'component-pg16',$5,'P0','planned')`, [runId, nonce, "a".repeat(40), nonce, nonce]);
    guards = new pg.Pool({ connectionString: guardUrl.href, max: 2, connectionTimeoutMillis: 2000, query_timeout: 5000 });
    guards.on("error", () => {});
    custody = await prepareBootstrapCredentialCustody({ directory, custodianUid: process.getuid!(), oldSecret: decodeURIComponent(privateUrl.password) });
    await body({ client, guards, role, runId, custody, async acquire() {
      guard = await acquireBootstrapInventoryGuard({ managementPool: guards!, mutator: client!, target,
        onMutatorReleased: () => { released = true; } });
      return guard;
    } });
  } catch (error) { failed = true; throw error; }
  finally {
    // Pool closure must finish before role cleanup. Even synchronous failures
    // cannot prevent the remaining resources from being attempted.
    const first = await Promise.allSettled([
      Promise.resolve().then(() => guard?.close()),
      Promise.resolve().then(() => { if (client && !released) { released = true; client.release(true); } }),
    ]);
    const second = await Promise.allSettled([
      Promise.resolve().then(() => guards?.end()), Promise.resolve().then(() => managers.end()),
      Promise.resolve().then(() => custody?.close()),
    ]);
    const third = await Promise.allSettled([Promise.resolve().then(async () => {
      if (created) await withFreshManager(cleanup => cleanup.query(`drop role ${role}`));
    })]);
    if ([...first, ...second, ...third].some(result => result.status === "rejected")) {
      if (failed) throw new Error("bootstrap-root-guard-operation-and-cleanup-failed");
      throw new Error("bootstrap-root-guard-cleanup-failed");
    }
  }
}

it("holds the actual restricted root inventory guard across both authentication commits and readback", async () => {
  await withRootGuardFixture(async f => {
    const beforeCapability = (await f.client.query(`select proacl::text as acl,
      has_function_privilege($1,oid,'EXECUTE') as executable from pg_proc where oid='pg_catalog.pg_control_system()'::regprocedure`, [f.role])).rows;
    const guard = await f.acquire();
    const observer = await acquireObservedManagementClient(f.guards, () => {});
    try {
      expect((await observer.query(`select session_user=$1 and not (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolinherit)
        as restricted from pg_roles where rolname=session_user`, [f.role])).rows).toEqual([{ restricted: true }]);
      // The PostgreSQL image's existing PUBLIC/default permission is observed,
      // not presumed negative. Root guard acquisition must not alter its ACL or
      // this actual restricted LOGIN's effective capability.
      expect((await observer.query(`select proacl::text as acl,
        has_function_privilege(session_user,oid,'EXECUTE') as executable from pg_proc where oid='pg_catalog.pg_control_system()'::regprocedure`)).rows)
        .toEqual(beforeCapability);
      expect(beforeCapability).toHaveLength(1);
    } finally { observer.release(true); }
    let commits = 0;
    const original = f.client.query;
    f.client.query = new Proxy(original, { apply(query, receiver, args) {
      const result = Reflect.apply(query, receiver, args);
      if (args[0] !== "commit") return result;
      return result.then(async (value: unknown) => { commits++; await guard.verify(); return value; });
    } });
    try {
      const result = await applyBootstrapCredentialFence({ client: f.client, target, runId: f.runId, attemptId: "guarded", custody: f.custody });
      privateUrl.password = await readFile(path.join(directory, `${f.custody.receipt.version}.new`), "utf8");
      expect(result.outcome).toBe("authentication-fenced-not-P13");
      expect(commits).toBe(2);
      expect(await inspectBootstrapCredentialFence({ client: f.client, target, runId: f.runId, attemptId: "guarded", custody: f.custody }))
        .toMatchObject({ outcome: "authentication-fenced-not-P13", intentDigest: result.intentDigest });
      await guard.verify();
      expect((await f.client.query("select phase from parameter_catalog.parameter_catalog_cutover_checkpoints where cutover_run_id=$1", [f.runId])).rows).toEqual([]);
    } finally { f.client.query = original; }
  });
});

it.each(["inherit", "set-disabled"])("rejects the actual root guard %s capability before authentication intent", async fault => {
  await withRootGuardFixture(async f => {
    if (fault === "inherit") await f.client.query(`alter role ${f.role} inherit`);
    else await f.client.query(`grant catalog_migration_owner to ${f.role} with set false`);
    await expect(f.acquire()).rejects.toThrow("PCAT-UPG-LEGACY-LOGIN-GUARD-UNAVAILABLE");
    expect((await f.client.query("select event_kind from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$1", [f.runId])).rows).toEqual([]);
    expect(await inspectBootstrapCredentialFence({ client: f.client, target, runId: f.runId, attemptId: "guarded", custody: f.custody }))
      .toMatchObject({ outcome: "unknown" });
  });
});

it("destroys the actual mutator after root guard termination and reconciles the same committed intent", async () => {
  await withRootGuardFixture(async f => {
    const guard = await f.acquire();
    const observer = await acquireObservedManagementClient(f.guards, () => {});
    const original = f.client.query;
    let committed = false;
    const ended = new Promise<void>(resolve => f.client.once("end", resolve));
    f.client.query = new Proxy(original, { apply(query, receiver, args) {
      const result = Reflect.apply(query, receiver, args);
      if (args[0] !== "commit") return result;
      return result.then(async (value: unknown) => {
        committed = true;
        const killed = await observer.query(`select pg_terminate_backend(pid) as killed from pg_stat_activity
          where usename=$1 and pid<>pg_backend_pid()`, [f.role]);
        expect(killed.rows).toEqual([{ killed: true }]);
        await ended;
        return value;
      });
    } });
    try {
      await expect(applyBootstrapCredentialFence({ client: f.client, target, runId: f.runId, attemptId: "guard-lost", custody: f.custody }))
        .rejects.toThrow("outcome-unknown");
      expect(committed).toBe(true);
      await expect(guard.verify()).rejects.toThrow("GUARD-CONNECTION-LOST");
    } finally { f.client.query = original; observer.release(true); }
    await withFreshManager(async fresh => {
      expect(await inspectBootstrapCredentialFence({ client: fresh, target, runId: f.runId, attemptId: "guard-lost", custody: f.custody }))
        .toMatchObject({ outcome: "not-applied" });
      expect((await fresh.query("select event_kind from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$1", [f.runId])).rows)
        .toEqual([{ event_kind: "bootstrap-authentication-fence-intent" }]);
    });
  });
});

it("refuses any password write after the actual issued host-lock holder exits following the first commit", async () => {
  await withRootGuardFixture(async f => {
    const guard = await f.acquire(), lockRoot = await realpath(await mkdtemp(path.join(directory, "host-boundary-")));
    await chmod(lockRoot, 0o700);
    let firstCommit = false, passwordDispatched = false, fenceError: unknown, holderError: unknown;
    const original = f.client.query;
    try {
      await withHostOperationLock(lockRoot, async lock => {
        const journalPath = path.join(lockRoot, "journal.json");
        await assertHostOperationLockForJournal(lock, journalPath);
        const owner = await readFile(path.join(lockRoot, ".operation.lock.owner"), "utf8")
          .catch(() => readFile(path.join(lockRoot, ".operation.lock.d", "owner"), "utf8"));
        const pid = /^pid=([0-9]+)$/m.exec(owner)?.[1];
        if (!pid || !owner.includes("operation=catalog-handoff\n")) throw new Error("bootstrap-owned-host-lock-unavailable");
        f.client.query = new Proxy(original, { apply(query, receiver, args) {
          if (typeof args[0] === "string" && args[0].startsWith("alter role ")) passwordDispatched = true;
          const result = Reflect.apply(query, receiver, args);
          if (args[0] !== "commit" || firstCommit) return result;
          return result.then(async (value: unknown) => {
            firstCommit = true;
            process.kill(Number(pid), "SIGTERM");
            // A real failed holder acknowledgment, without a timing sleep or
            // caller boolean, establishes the loss before the next effect.
            await assertHostOperationLockForJournal(lock, journalPath).then(
              () => { throw new Error("bootstrap-host-lock-loss-not-observed"); }, () => undefined);
            return value;
          });
        } });
        const command = { client: f.client, target, runId: f.runId, attemptId: "host-lost", custody: f.custody,
          beforeEffect: async () => { await assertHostOperationLockForJournal(lock, journalPath); await guard.verify(); } };
        try {
          await applyBootstrapCredentialFence(command);
          // Preserve the real credential if the old implementation incorrectly
          // rotates it, so the Red case can still close its owned fixture.
          privateUrl.password = await readFile(path.join(directory, `${f.custody.receipt.version}.new`), "utf8");
        } catch (error) { fenceError = error; }
      }).catch(error => { holderError = error; });
      expect(firstCommit).toBe(true);
      expect(holderError).toBeInstanceOf(Error);
      expect(fenceError).toMatchObject({ message: expect.stringContaining("outcome-unknown") });
      expect(passwordDispatched).toBe(false);
      expect((await f.client.query("select event_kind from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$1", [f.runId])).rows)
        .toEqual([{ event_kind: "bootstrap-authentication-fence-intent" }]);
      expect(await inspectBootstrapCredentialFence({ client: f.client, target, runId: f.runId, attemptId: "host-lost", custody: f.custody }))
        .toMatchObject({ outcome: "not-applied" });
    } finally { f.client.query = original; await rm(lockRoot, { recursive: true }); }
  });
});
