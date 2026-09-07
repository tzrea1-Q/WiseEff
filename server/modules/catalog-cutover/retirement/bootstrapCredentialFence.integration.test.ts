import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { connect, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
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

it.each([1, 2] as const)("reconciles the original version after actual commit %s acknowledgment loss and process exit", async ordinal => {
  await closeInitialManager();
  const nonce = randomBytes(8).toString("hex"), runId = `fault-${nonce}`, attemptId = `attempt-${nonce}`;
  const before = await withFreshManager(async client => {
    await client.query(`insert into parameter_catalog.parameter_catalog_cutover_runs
      (id,source_snapshot_fingerprint,target_artifact_sha,target_catalog_release_digest,migration_contract_version,plan_digest,current_phase,state)
      values($1,$2,$3,$4,'component-pg16',$5,'P0','planned')`, [runId, nonce, "a".repeat(40), nonce, nonce]);
    return (await client.query("select to_jsonb(r) as value from pg_roles r where oid=10")).rows[0];
  });
  const custody = await prepareBootstrapCredentialCustody({ directory, custodianUid: process.getuid!(), oldSecret: decodeURIComponent(privateUrl.password) });
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
    await withFreshManager(async client => {
      const command = { client, target, runId, attemptId, custody };
      expect(await inspectBootstrapCredentialFence(command)).toMatchObject({ outcome: ordinal === 1 ? "not-applied" : "authentication-fenced-not-P13" });
      expect(await inspectBootstrapCredentialFence({ ...command, attemptId: "different" })).toEqual({ outcome: "unknown" });
      const rows = (await client.query("select event_kind from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$1 order by sequence_number", [runId])).rows;
      expect(rows).toEqual((ordinal === 1 ? ["bootstrap-authentication-fence-intent"] :
        ["bootstrap-authentication-fence-intent", "bootstrap-authentication-fence-applied"]).map(event_kind => ({ event_kind })));
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
});
