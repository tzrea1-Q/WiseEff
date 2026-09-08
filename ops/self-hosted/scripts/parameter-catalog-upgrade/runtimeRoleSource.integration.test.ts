import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { assertOwnedUpgradeTestTarget } from "../../../../scripts/upgrade-test-target";
import { createIsolatedUpgradeDocker } from "../../../../scripts/isolated-upgrade-docker";
import { createMigratedSelfHostedPg16Database } from "../../../../server/testing/selfHostedUpgrade/database";
import { createPostgresDatabase, type RootDatabase } from "../../../../server/shared/database/client";
import { canonicalJson, sha256Prefixed } from "./journal";
import { withHostOperationLock, type HandoffPlan } from "./handoff";
import { assertRuntimeRoleSourceManagementSession, observeRuntimeRoles, openRuntimeRoleSource, RuntimeRoleSourceError, type RuntimeRoleSource } from "./runtimeRoleSource";

// These are actual LOGIN/config/session proofs on a parent-owned cluster. The
// scoped handoff fixture is not prepareHandoff/P12/report/startup approval.
let target: Awaited<ReturnType<typeof createMigratedSelfHostedPg16Database>>;
let admin: RootDatabase;
let receipt: { id: string; imageId: string; daemonId: string; dataVolume: { name: string } };
const suffix = randomBytes(8).toString("hex");
const roles = { manager: `role_source_manager_${suffix}`, api: `role_source_api_${suffix}`,
  worker: `role_source_worker_${suffix}`, governance: `role_source_governance_${suffix}` };
const secrets = Object.fromEntries(Object.keys(roles).map(key => [key, randomBytes(24).toString("hex")]));
const connection = (key: keyof typeof roles) => {
  const url = new URL(target.url); url.username = roles[key]; url.password = secrets[key]; return url.href;
};
beforeAll(async () => {
  assertOwnedUpgradeTestTarget();
  try {
    receipt = JSON.parse(await readFile(process.env.UPG_TEST_TARGET_RECEIPT!, "utf8"));
    target = await createMigratedSelfHostedPg16Database("runtime_roles");
    admin = createPostgresDatabase(target.url);
    for (const [key, name] of Object.entries(roles)) await admin.query(`create role ${pg.escapeIdentifier(name)} login noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication password '${secrets[key]}'`);
    await admin.query(`grant catalog_migration_owner to ${pg.escapeIdentifier(roles.manager)} with inherit false, set true, admin false`);
    for (const name of [roles.api, roles.worker]) await admin.query(`grant catalog_runtime_reader_role to ${pg.escapeIdentifier(name)} with inherit true, set false, admin false`);
    await admin.query(`grant parameter_governance_writer_role to ${pg.escapeIdentifier(roles.governance)} with inherit true, set false, admin false`);
  } catch { throw new Error("runtime-role-fixture-setup-failed"); }
}, 60_000);
afterAll(async () => {
  const results = await Promise.allSettled([(async () => { await admin?.close(); })()]);
  try { await target?.close(); } catch { results.push({ status: "rejected", reason: undefined }); }
  if (results.some(result => result.status === "rejected")) throw new Error("runtime-role-fixture-cleanup-failed");
});

async function fixture(options: { api?: string; worker?: string; management?: string; governance?: boolean } = {}) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "runtime-roles-pg-")));
  const contents = {
    main: `WISEEFF_API_ENV_FILE=${directory}/api\nWISEEFF_WORKER_ENV_FILE=${directory}/worker\nWISEEFF_MANAGEMENT_ENV_FILE=${directory}/management\n`,
    api: `NODE_ENV=production\nDATABASE_URL=${options.api ?? connection("api")}\n${options.governance ? `CATALOG_GOVERNANCE_DATABASE_URL=${connection("governance")}\n` : ""}`,
    worker: `NODE_ENV=production\nDATABASE_URL=${options.worker ?? connection("worker")}\n`, management: `DATABASE_URL=${options.management ?? connection("manager")}\n`,
  };
  const pins: Record<string, { path: string; device: string; inode: string; digest: string }> = {};
  for (const [name, bytes] of Object.entries(contents)) {
    const filename = path.join(directory, name);
    await writeFile(filename, bytes, { mode: 0o600, flag: "wx" });
    const stat = await lstat(filename);
    pins[name] = { path: filename, device: String(stat.dev), inode: String(stat.ino), digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
  }
  const docker = createIsolatedUpgradeDocker();
  const actual = JSON.parse(docker.command(["inspect", receipt.id]).toString())[0];
  const mount = actual.Mounts.find((entry: { Name?: string }) => entry.Name === receipt.dataVolume.name);
  if (!mount) throw new Error("runtime-role-fixture-target-failed");
  const body = { format: "wiseeff-fixed-entry-handoff-v1", inputs: { runId: `roles_${suffix}`,
    expectedDaemonId: receipt.daemonId, privateConfigPath: pins.main.path, lockRoot: directory, journalPath: path.join(directory, "journal.json"),
    source: { applications: [], stores: [{ service: "postgres", containerId: receipt.id, volumeName: receipt.dataVolume.name, destination: mount.Destination }] } },
  observation: { privateConfigurations: { main: pins.main, runtime: { WISEEFF_API_ENV_FILE: pins.api, WISEEFF_WORKER_ENV_FILE: pins.worker, WISEEFF_MANAGEMENT_ENV_FILE: pins.management } },
    stores: [{ service: "postgres", id: receipt.id, imageId: receipt.imageId }] } };
  const plan = { ...body, digest: sha256Prefixed(canonicalJson(body)) } as unknown as HandoffPlan;
  return { directory, plan };
}
async function within(options: Parameters<typeof fixture>[0], run: (f: Awaited<ReturnType<typeof fixture>>, lock: Parameters<Parameters<typeof withHostOperationLock>[1]>[0]) => Promise<void>) {
  const f = await fixture(options);
  try { await withHostOperationLock(f.directory, lock => run(f, lock)); }
  finally { await rm(f.directory, { recursive: true }); }
}

it("observes actual application and optional governance LOGIN OIDs without startup admission", async () => {
  const client = new pg.Client({ connectionString: connection("manager") });
  client.on("error", () => {});
  try {
    await client.connect();
    const result = await client.query(`select pg_catalog.current_schemas(true) as native,
      pg_catalog.current_schemas(true)::text[] as normalized`);
    const shape = { nativeType: typeof result.rows[0].native, nativeArray: Array.isArray(result.rows[0].native),
      nativeOid: result.fields[0].dataTypeID, normalizedType: typeof result.rows[0].normalized,
      normalizedArray: Array.isArray(result.rows[0].normalized), normalizedOid: result.fields[1].dataTypeID,
      catalogFirst: result.rows[0].normalized?.[0] === "pg_catalog" };
    // Only public protocol types/OIDs and a boolean; never schema values or URL.
    console.info(JSON.stringify({ evidence: "runtime-role-schema-wire-shape", ...shape }));
    expect(shape).toEqual({ nativeType: "string", nativeArray: false, nativeOid: 1003,
      normalizedType: "object", normalizedArray: true, normalizedOid: 1009, catalogFirst: true });
  } finally { await client.end(); }
  await within({ governance: true }, async (f, lock) => {
    const source = await openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock });
    try {
      const observation = await observeRuntimeRoles(source);
      expect(observation.scope).toBe("management-time-configured-logins-only");
      const actual = await admin.query<{ oid: string; name: string }>("select oid::text,rolname as name from pg_catalog.pg_roles where rolname=any($1::text[])", [[roles.api, roles.worker, roles.governance]]);
      expect(observation.roles).toEqual([
        { service: "api", purpose: "application", ...actual.rows.find(row => row.name === roles.api) },
        { service: "worker", purpose: "application", ...actual.rows.find(row => row.name === roles.worker) },
        { service: "api", purpose: "catalog-governance-command", ...actual.rows.find(row => row.name === roles.governance) },
      ]);
      const text = JSON.stringify(observation);
      expect(Object.values(secrets).some(secret => text.includes(secret))).toBe(false);
    } finally { await source.close(); }
    await expect(observeRuntimeRoles(source)).rejects.toThrow("CLOSED-OR-LOST");
  });
});

it("proves a checked-out manager session through the private source endpoint and releases its challenge lock", async () => {
  await within({}, async (f, lock) => {
    const source = await openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock });
    const candidatePool = new pg.Pool({ connectionString: target.url, max: 1 });
    candidatePool.on("error", () => {});
    const candidate = await candidatePool.connect();
    candidate.on("error", () => {});
    try {
      const pid = (await candidate.query<{ pid: number }>("select pg_catalog.pg_backend_pid() as pid")).rows[0].pid;
      await expect(assertRuntimeRoleSourceManagementSession(source, candidate)).resolves.toBeUndefined();
      const locks = await admin.query<{ count: number }>(`select count(*)::int as count from pg_catalog.pg_locks
        where pid=$1 and locktype='advisory' and granted and classid=824018::oid`, [pid]);
      expect(locks.rows[0]?.count).toBe(0);
    } finally {
      candidate.release(true);
      await candidatePool.end();
      await source.close();
    }
  });
});

it("refuses a manager-source assertion after the source manager dies and releases every source lease", async () => {
  const observed = observePools();
  try {
    await within({}, async (f, lock) => {
      const source = await openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock });
      const candidatePool = new pg.Pool({ connectionString: target.url, max: 1 });
      candidatePool.on("error", () => {});
      const candidate = await candidatePool.connect();
      candidate.on("error", () => {});
      try {
        expect((await terminateLogin("manager")).rows).toEqual([{ terminated: true }]);
        await expect(assertRuntimeRoleSourceManagementSession(source, candidate)).rejects.toMatchObject({
          code: expect.stringMatching(/^(CLOSED-OR-LOST|SESSION-ENDPOINT-MISMATCH|MANAGEMENT-SESSION-UNAVAILABLE)$/),
        });
      } finally {
        candidate.release(true);
        await candidatePool.end();
        await source.close();
      }
      await assertReleased(observed);
    });
  } finally { await observed.cleanup(); }
});

it.each(["false", "reject", "primary+reject"] as const)("destroys the checked-out manager lease after an unlock %s and redacts the cleanup driver error", async mode => {
  const observed = observePools();
  try {
    await within({}, async (f, lock) => {
      const source = await openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock });
      const candidatePool = new pg.Pool({ connectionString: target.url, max: 1 });
      candidatePool.on("error", () => {});
      const candidate = await candidatePool.connect();
      candidate.on("error", () => {});
      const pid = (await candidate.query<{ pid: number }>("select pg_catalog.pg_backend_pid() as pid")).rows[0].pid;
      const realQuery = candidate.query.bind(candidate);
      vi.spyOn(candidate, "query").mockImplementation((async (...args: never[]) => {
        const text = typeof args[0] === "string" ? args[0] : String((args[0] as { text?: string }).text);
        if (text.includes("pg_advisory_lock(824018")) {
          if (mode === "primary+reject") return { rows: [], rowCount: 0 } as never;
          return realQuery(args[0] as never, args[1] as never);
        }
        if (text.includes("pg_advisory_unlock(824018")) {
          if (mode !== "false") throw new Error("private-unlock-postgres://secret");
          return { rows: [{ unlocked: false }], rowCount: 1 } as never;
        }
        return realQuery(args[0] as never, args[1] as never);
      }) as never);
      try {
        const rejected = await assertRuntimeRoleSourceManagementSession(source, candidate).then(() => undefined, error => error);
        expect(rejected).toMatchObject({ code: mode === "primary+reject" ? "MANAGEMENT-SESSION-CHALLENGE-FAILED" : "MANAGEMENT-SESSION-CLEANUP-UNKNOWN" });
        expect((rejected as { cleanupCode?: string }).cleanupCode).toBe(mode === "primary+reject" ? "MANAGEMENT-SESSION-CLEANUP-UNKNOWN" : undefined);
        expect(String(rejected)).not.toContain("private-unlock");
      } finally {
        // The source cannot own this caller lease; uncertain unlock always
        // takes the caller's destroy path instead of returning it to the pool.
        candidate.release(true);
        await candidatePool.end();
        await source.close();
      }
      const sessions = await admin.query<{ count: number }>(`select count(*)::int as count from pg_catalog.pg_stat_activity
        where pid=$1 and backend_type='client backend'`, [pid]);
      expect(sessions.rows[0]?.count).toBe(0);
      await assertReleased(observed);
    });
  } finally { await observed.cleanup(); }
});

it("rejects a same-endpoint manager client connected to the wrong database", async () => {
  const f = await fixture();
  try {
    await withHostOperationLock(f.directory, async lock => {
      const source = await openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock });
      const wrongDatabase = new URL(target.url); wrongDatabase.pathname = "/postgres";
      const candidatePool = new pg.Pool({ connectionString: wrongDatabase.href, max: 1 });
      candidatePool.on("error", () => {});
      const candidate = await candidatePool.connect();
      candidate.on("error", () => {});
      try {
        await expect(assertRuntimeRoleSourceManagementSession(source, candidate)).rejects.toMatchObject({
          code: "MANAGEMENT-SESSION-IDENTITY-MISMATCH",
        });
        await expect(observeRuntimeRoles(source)).resolves.toMatchObject({ scope: "management-time-configured-logins-only" });
      } finally {
        candidate.release(true);
        await candidatePool.end();
        await source.close();
      }
    });
  } finally { await rm(f.directory, { recursive: true }); }
});

it("refuses the actual bootstrap LOGIN hidden by the old V13 postgres exclusion", async () => {
  // Independently prove this URL authenticates as the actual bootstrap identity.
  expect((await admin.query("select oid::text,rolsuper from pg_catalog.pg_roles where rolname=session_user")).rows)
    .toEqual([{ oid: "10", rolsuper: true }]);
  await within({ api: target.url }, async (f, lock) => {
    await expect(openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock }))
      .rejects.toMatchObject({ code: "PCAT-RUNTIME-PRIVILEGED-LOGIN" });
  });
});

it.each([
  ["manager", "PCAT-RUNTIME-MANAGEMENT-ROLE-REACHABLE"],
  ["governance", "PCAT-RUNTIME-GOVERNANCE-CAPABILITY-IN-APPLICATION-POOL"],
] as const)("rejects actual %s credentials used in an application configuration", async (key, code) => {
  await within({ api: connection(key) }, async (f, lock) => {
    await expect(openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock })).rejects.toMatchObject({ code });
  });
});

it("still refuses an actual session whose search path precedes pg_catalog", async () => {
  await admin.query(`alter role ${pg.escapeIdentifier(roles.manager)} set search_path=public,pg_catalog`);
  try {
    await within({}, async (f, lock) => {
      await expect(openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock }))
        .rejects.toMatchObject({ code: "RESOLUTION-UNSAFE" });
    });
  } finally { await admin.query(`alter role ${pg.escapeIdentifier(roles.manager)} reset search_path`); }
});

it("refuses an unproven endpoint before authenticating a retargeted URL", async () => {
  const wrong = new URL(connection("api")); wrong.port = wrong.port === "1" ? "2" : "1";
  await within({ api: wrong.href }, async (f, lock) => {
    await expect(openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock })).rejects.toThrow("TARGET-ENDPOINT-MISMATCH");
  });
});

it("refuses replacement of the pinned file after actual LOGIN authentication", async () => {
  await within({}, async (f, lock) => {
    const source = await openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock });
    try {
      const filename = path.join(f.directory, "api"), original = await readFile(filename);
      await rename(filename, `${filename}.original`); await writeFile(filename, original, { mode: 0o600 });
      await expect(observeRuntimeRoles(source)).rejects.toThrow("OBSERVATION-UNAVAILABLE");
    } finally { await source.close(); }
  });
});

it("observes a runtime privilege change after issuance instead of trusting cached identity", async () => {
  await within({}, async (f, lock) => {
    const source = await openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock });
    try {
      await admin.query(`alter role ${pg.escapeIdentifier(roles.worker)} createdb`);
      await expect(observeRuntimeRoles(source)).rejects.toMatchObject({ code: "PCAT-RUNTIME-PRIVILEGED-LOGIN" });
    } finally {
      await source.close(); await admin.query(`alter role ${pg.escapeIdentifier(roles.worker)} nocreatedb`);
    }
  });
});

// This observer delegates the unmodified public Pool.connect call to actual pg.
// It observes real acquire events and can request a real administrative backend
// termination. It never supplies a fake client, query result or admission.
function observePools(onAcquire?: (kind: keyof typeof roles) => void) {
  const pools = new Map<pg.Pool, keyof typeof roles>();
  const acquired = new Set<keyof typeof roles>();
  const clients = new Map<pg.PoolClient, { kind: keyof typeof roles; pid: number; ended: boolean }>();
  const original = pg.Pool.prototype.connect;
  const observer = vi.spyOn(pg.Pool.prototype, "connect").mockImplementation(function(this: pg.Pool, callback) {
    const value = this.options.connectionString;
    const kind = value ? (Object.keys(roles) as (keyof typeof roles)[]).find(key => new URL(value).username === roles[key]) : undefined;
    if (kind && !pools.has(this)) {
      pools.set(this, kind);
      this.on("acquire", (client: pg.PoolClient) => {
        acquired.add(kind);
        if (!clients.has(client)) {
          const row = { kind, pid: (client as pg.PoolClient & { processID: number }).processID, ended: false };
          clients.set(client, row);
          client.once("end", () => { row.ended = true; });
        }
        onAcquire?.(kind);
      });
    }
    return original.call(this, callback);
  });
  return { pools, acquired, clients, async cleanup() {
    observer.mockRestore();
    // Regression failure must not strand the observed real pool. Assertions
    // below run before this fallback and cannot mistake it for module cleanup.
    const results = await Promise.allSettled([...pools.keys()].filter(pool => !pool.ended).map(pool => pool.end()));
    if (results.some(result => result.status === "rejected")) throw new Error("runtime-role-observer-cleanup-failed");
  } };
}
async function assertReleased(observed: ReturnType<typeof observePools>) {
  expect([...observed.pools.keys()].every(pool => pool.ended && pool.totalCount === 0 && pool.waitingCount === 0)).toBe(true);
  const atReturn = [...observed.clients.values()].map(row => ({ ...row }));
  const sessions = await admin.query<{ pid: number; state: string }>(`select pid,state from pg_catalog.pg_stat_activity
    where datname=current_database() and usename=any($1::text[]) and backend_type='client backend'`, [Object.values(roles)]);
  console.info(JSON.stringify({ evidence: "runtime-role-close-pids", atReturn,
    server: sessions.rows.map(row => ({ pid: row.pid, observed: atReturn.some(client => client.pid === row.pid),
      idle: row.state === "idle", active: row.state === "active" })) }));
  expect(atReturn.every(row => Number.isSafeInteger(row.pid) && row.pid > 0 && row.ended)).toBe(true);
  expect(sessions.rows).toHaveLength(0);
}
async function staticFailure(action: () => Promise<unknown>, extraSecret?: string) {
  let rejected = false, typed = false, code: string | undefined, leaked = false;
  let value: unknown;
  try { value = await action(); }
  catch (error) {
    rejected = true; typed = error instanceof RuntimeRoleSourceError;
    if (error instanceof RuntimeRoleSourceError) code = error.code;
    const text = String(error);
    leaked = [...Object.values(secrets), ...(extraSecret ? [extraSecret] : [])].some(secret => text.includes(secret)) || text.includes("postgres://") || text.includes("postgresql://");
  }
  if (value && typeof value === "object" && "close" in value && typeof value.close === "function") await value.close();
  // Never print the original Error, client or an expected/actual secret.
  expect(rejected).toBe(true); expect(typed).toBe(true); expect(leaked).toBe(false);
  return code;
}
const terminateLogin = (kind: keyof typeof roles) => admin.query<{ terminated: boolean }>(`select pg_catalog.pg_terminate_backend(pid) as terminated
  from pg_catalog.pg_stat_activity where datname=current_database() and usename=$1 and backend_type='client backend'`, [roles[kind]]);

it.each(["manager", "worker"] as const)("rejects the actual wrong %s password and releases every prior pool", async kind => {
  const wrong = new URL(connection(kind)); const badPassword = randomBytes(24).toString("hex"); wrong.password = badPassword;
  const probe = new pg.Client({ connectionString: wrong.href }); probe.on("error", () => {});
  let actualCode: string | undefined;
  try { await probe.connect(); }
  catch (error) { if (error && typeof error === "object" && "code" in error && typeof error.code === "string") actualCode = error.code; }
  finally { await probe.end(); }
  expect(actualCode).toBe("28P01");
  const observed = observePools();
  try {
    await within(kind === "manager" ? { management: wrong.href } : { worker: wrong.href }, async (f, lock) => {
      expect(await staticFailure(() => openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock }), badPassword))
        .toBe("CONNECTION-UNAVAILABLE");
      expect([...observed.acquired].sort()).toEqual(kind === "manager" ? [] : ["api", "manager"]);
      expect(observed.pools.size).toBe(kind === "manager" ? 1 : 3);
      await assertReleased(observed);
    });
  } finally { await observed.cleanup(); }
});

it.each(["manager", "worker"] as const)("refuses an issued observation after actual %s backend termination and closes all pools", async kind => {
  const observed = observePools();
  try {
    await within({}, async (f, lock) => {
      const source = await openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock });
      try {
        expect((await observeRuntimeRoles(source)).roles.length).toBe(2);
        expect([...observed.acquired].sort()).toEqual(["api", "manager", "worker"]);
        const terminated = await terminateLogin(kind);
        expect(terminated.rows).toEqual([{ terminated: true }]);
        const code = await staticFailure(() => observeRuntimeRoles(source));
        expect(["CLOSED-OR-LOST", "SESSION-ENDPOINT-MISMATCH", "OBSERVATION-UNAVAILABLE"]).toContain(code);
      } finally { await source.close(); }
      await assertReleased(observed);
      await source.close(); await assertReleased(observed);
    });
  } finally { await observed.cleanup(); }
});

it("settles initialization and releases pools when the actual management backend is terminated at checkout", async () => {
  let termination: ReturnType<typeof terminateLogin> | undefined;
  const observed = observePools(kind => {
    if (kind === "manager" && !termination) {
      termination = terminateLogin(kind);
      // Keep any administration failure handled until the explicit assertion.
      void termination.catch(() => undefined);
    }
  });
  try {
    await within({}, async (f, lock) => {
      let unexpected: RuntimeRoleSource | undefined;
      try {
        const code = await staticFailure(async () => { unexpected = await openRuntimeRoleSource({ handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock }); });
        expect(["CONNECTION-LOST", "OPEN-UNAVAILABLE", "SESSION-ENDPOINT-MISMATCH", "OBSERVATION-UNAVAILABLE"]).toContain(code);
      } finally { await unexpected?.close(); }
      expect(termination !== undefined).toBe(true);
      expect((await termination)?.rows).toEqual([{ terminated: true }]);
      expect(observed.acquired.has("manager")).toBe(true);
      await assertReleased(observed);
    });
  } finally { await observed.cleanup(); }
});
