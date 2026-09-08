import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertOwnedUpgradeTestTarget } from "../../../scripts/upgrade-test-target";
import { createSelfHostedPg16Database } from "../../testing/selfHostedUpgrade/database";
import { openRuntimeDatabase } from "./runtimeConnection";
import { createPostgresDatabase, getRootPostgresPool } from "./client";
import { createPostgresCheckpointerSaver, setupXiaozeCheckpointerTables, verifyPostgresCheckpointerTables } from "../../modules/agent/xiaoze/durableCheckpointer";

// The mandatory parent lane owns the cluster and cleanup, on Desktop or Hosted.
// No opt-in skip and no ambient URL can authorize test collection.
assertOwnedUpgradeTestTarget();
describe("actual runtime login and checkpoint management separation", () => {
  const password = randomBytes(24).toString("hex");
  let fixture: Awaited<ReturnType<typeof createSelfHostedPg16Database>>;
  let admin: pg.Client;
  const url = (role: string) => {
    if (role === "postgres") return fixture.url;
    const connection = new URL(fixture.url);
    connection.username = role;
    connection.password = password;
    return connection.href;
  };
  beforeAll(async () => {
    fixture = await createSelfHostedPg16Database("runtimeidentity");
    admin = new pg.Client({ connectionString: fixture.url });
    await admin.connect();
    await admin.query(`create role runtime login password '${password}' nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
      create role parameter_governance_writer_role nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
      create role governance login password '${password}' nosuperuser nobypassrls nocreatedb nocreaterole inherit;
      grant parameter_governance_writer_role to governance;
      create role elevated login password '${password}' nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
      create role bridge nologin noinherit; create role forbidden nologin createdb;
      grant forbidden to bridge; grant bridge to elevated with inherit false;
      create table public.runtime_business(id integer primary key, value text);
      insert into public.runtime_business values (1,'synthetic');
      grant select on public.runtime_business to runtime;`);
  });
  afterAll(async () => {
    let failed = false;
    // End the management session before dropping only this fixture's exact DB.
    // A failed first close must not skip the owned database cleanup attempt.
    for (const close of [() => admin?.end(), () => fixture?.close()]) {
      try { await close(); } catch { failed = true; }
    }
    if (failed) throw new Error("runtime-identity-fixture-cleanup-failed");
  });
  it("keeps restricted-login business permissions distinct from Catalog startup approval", async () => {
    await expect(openRuntimeDatabase({ connectionString: url("runtime"), nodeEnv: "production" }))
      .rejects.toMatchObject({ code: "PCAT-RUNTIME-CATALOG-SCHEMA-MISSING" });
    // This is a direct permission probe, not a production startup success.
    const db = createPostgresDatabase(url("runtime"));
    try {
      expect((await db.query("select session_user as login, current_user as effective")).rows).toEqual([{ login: "runtime", effective: "runtime" }]);
      expect((await db.query("select * from public.runtime_business")).rows).toEqual([{ id: 1, value: "synthetic" }]);
      await expect(db.query("insert into public.runtime_business values (2, 'bad')")).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("set role forbidden")).rejects.toMatchObject({ code: "42501" });
    } finally { await db.close(); }
  });
  it("refuses actual superuser and NOINHERIT recursive management reachability", async () => {
    for (const role of ["postgres", "elevated"]) {
      await expect(openRuntimeDatabase({ connectionString: url(role), nodeEnv: "production" }))
        .rejects.toMatchObject({ code: "PCAT-RUNTIME-PRIVILEGED-LOGIN" });
    }
  });
  it("observes the actual restricted session for every root and raw-pool checkout", async () => {
    const observed: number[] = [];
    let reject = false;
    const refusal = new Error("PCAT-TARGET-IDENTITY-MISMATCH");
    const db = createPostgresDatabase(url("runtime"), { verifyCheckout: async session => {
      const row = (await session.query<{ pid: number; login: string }>("select pg_backend_pid() as pid, session_user as login")).rows[0];
      expect(row.login).toBe("runtime");
      observed.push(row.pid);
      if (reject) throw refusal;
    } });
    const statement = "select pg_backend_pid() as pid";
    try {
      expect((await db.query<{ pid: number }>(statement)).rows[0].pid).toBe(observed.at(-1));
      await db.transaction(async tx => {
        expect((await tx.query<{ pid: number }>(statement)).rows[0].pid).toBe(observed.at(-1));
      });
      const pool = getRootPostgresPool(db)!;
      const client = await pool.connect();
      try { expect((await client.query(statement)).rows[0].pid).toBe(observed.at(-1)); }
      finally { client.release(); }
      expect((await pool.query(statement)).rows[0].pid).toBe(observed.at(-1));
      expect(observed).toHaveLength(4);
      reject = true;
      await expect(pool.query(statement)).rejects.toBe(refusal);
      expect(observed).toHaveLength(5);
      let remaining = 1;
      for (let attempt = 0; attempt < 30 && remaining; attempt++) {
        remaining = (await admin.query("select count(*)::int as count from pg_stat_activity where pid=$1", [observed.at(-1)])).rows[0].count;
        if (remaining) await setTimeout(20);
      }
      expect(remaining).toBe(0);
    } finally { await db.close(); }
  });
  it("refuses a login able to assume the release verification writer role", async () => {
    await admin.query("create role catalog_verification_writer_role nologin noinherit; grant catalog_verification_writer_role to runtime with inherit false");
    try {
      const outcome = await openRuntimeDatabase({ connectionString: url("runtime"), nodeEnv: "production" })
        .then(async db => { await db.close(); return "allowed"; }, error => error.code);
      expect(outcome).toBe("PCAT-RUNTIME-MANAGEMENT-ROLE-REACHABLE");
    } finally { await admin.query("revoke catalog_verification_writer_role from runtime; drop role catalog_verification_writer_role"); }
  });
  it("rejects a real terminated backend during checkout without executing caller SQL", async () => {
    let signalStarted!: (pid: number) => void;
    const started = new Promise<number>(resolve => { signalStarted = resolve; });
    let proceed!: () => void;
    const wait = new Promise<void>(resolve => { proceed = resolve; });
    let lateProbe = false;
    const db = createPostgresDatabase(url("runtime"), { verifyCheckout: async session => {
      const pid = (await session.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
      signalStarted(pid);
      await wait;
      await session.query("select 1");
      lateProbe = true;
    } });
    try {
      const result = expect(getRootPostgresPool(db)!.query("select * from public.runtime_business"))
        .rejects.toThrow("PCAT-DATABASE-CHECKOUT-CONNECTION-FAILED");
      const pid = await started;
      expect((await admin.query("select pg_terminate_backend($1) as terminated", [pid])).rows).toEqual([{ terminated: true }]);
      await result;
      proceed(); await setTimeout(20);
      expect(lateProbe).toBe(false);
      expect(getRootPostgresPool(db)!.totalCount).toBe(0);
    } finally { proceed(); await db.close(); }
  });
  it("requires a separate actual governance login and refuses it as the application pool", async () => {
    await expect(openRuntimeDatabase({ connectionString: url("governance"), nodeEnv: "production" }))
      .rejects.toMatchObject({ code: "PCAT-RUNTIME-GOVERNANCE-CAPABILITY-IN-APPLICATION-POOL" });
    await expect(openRuntimeDatabase({ connectionString: url("runtime"), nodeEnv: "production", purpose: "catalog-governance-command" }))
      .rejects.toMatchObject({ code: "PCAT-RUNTIME-GOVERNANCE-CAPABILITY-MISSING" });
    const db = await openRuntimeDatabase({ connectionString: url("governance"), nodeEnv: "production", purpose: "catalog-governance-command" });
    try {
      expect((await db.query("select session_user as login, current_user as effective")).rows)
        .toEqual([{ login: "governance", effective: "governance" }]);
      await expect(db.query("set role forbidden")).rejects.toMatchObject({ code: "42501" });
    } finally { await db.close(); }
  });
  it.each(["server/index.ts", "server/modules/logs/workerRunner.ts"].flatMap(entry =>
    ["postgres", "runtime"].map(role => ({ entry, role }))))("$entry refuses $role before worker/server construction", ({ entry, role }) => {
    const result = spawnSync(process.execPath, ["--import", "tsx", path.resolve(entry)], {
      encoding: "utf8", timeout: 20000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production", DATABASE_URL: url(role),
        OBJECT_STORE_MODE: "s3", OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:1", OBJECT_STORAGE_BUCKET: "isolated-unused",
        OBJECT_STORAGE_ACCESS_KEY_ID: "synthetic-unused", OBJECT_STORAGE_SECRET_ACCESS_KEY: "synthetic-unused",
        AUTH_MODE: "production", AUTH_PROVIDER: "local", XIAOZE_CHECKPOINTER: "postgres",
        LOG_ANALYSIS_QUEUE_MODE: "durable", NOTIFICATION_QUEUE_MODE: "durable", REDIS_URL: "redis://127.0.0.1:1",
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(role === "postgres" ? "PCAT-RUNTIME-PRIVILEGED-LOGIN" : "PCAT-RUNTIME-CATALOG-SCHEMA-MISSING");
    const output = result.stdout + result.stderr;
    // Parent management and synthetic runtime credentials are now independent.
    // Boolean assertions do not echo a secret as the expected value on failure.
    expect(output.includes(password)).toBe(false);
    expect(output.includes(decodeURIComponent(new URL(fixture.url).password))).toBe(false);
    expect(result.stdout + result.stderr).not.toContain("ECONNREFUSED");
    expect(result.stdout).not.toContain("listening");
  });
  it("refuses missing checkpoint without creating tables, then reads independently managed schema", async () => {
    await expect(verifyPostgresCheckpointerTables(url("runtime"))).rejects.toThrow("PCAT-RUNTIME-CHECKPOINT-SCHEMA-UNVERIFIED");
    expect((await admin.query("select to_regclass('public.checkpoints') as relation")).rows[0].relation).toBeNull();
    await setupXiaozeCheckpointerTables({ mode: "postgres", connectionString: url("postgres") });
    await admin.query("grant select on public.checkpoint_migrations, public.checkpoints, public.checkpoint_blobs, public.checkpoint_writes to runtime");
    await admin.query("grant insert, update on public.checkpoints, public.checkpoint_blobs, public.checkpoint_writes to runtime");
    const handle = createPostgresCheckpointerSaver({ connectionString: url("runtime"), setupMode: "verify-only" });
    try {
      await handle.ensureSetup();
      await handle.saver.put({ configurable: { thread_id: "isolated-checkpoint" } }, {
        v: 4, id: "checkpoint-1", ts: "2026-09-06T00:00:00Z", channel_values: { value: "synthetic checkpoint" },
        channel_versions: { value: 1 }, versions_seen: {},
      }, { source: "input", step: 0, parents: {} }, { value: 1 });
      expect((await handle.saver.getTuple({ configurable: { thread_id: "isolated-checkpoint" } }))?.checkpoint.channel_values)
        .toEqual({ value: "synthetic checkpoint" });
    } finally { await handle.saver.end(); }
    expect((await admin.query("select v from public.checkpoint_migrations order by v")).rows).toEqual([0,1,2,3,4].map((v) => ({ v })));
    await admin.query("alter table public.checkpoints alter column metadata drop default; alter table public.checkpoints alter column metadata type text using metadata::text");
    await expect(verifyPostgresCheckpointerTables(url("runtime"))).rejects.toThrow("PCAT-RUNTIME-CHECKPOINT-SCHEMA-UNVERIFIED");
    await admin.query("alter table public.checkpoints alter column metadata type jsonb using metadata::jsonb; alter table public.checkpoints alter column metadata set default '{}'::jsonb; alter table public.checkpoints drop constraint checkpoints_pkey");
    await expect(verifyPostgresCheckpointerTables(url("runtime"))).rejects.toThrow("PCAT-RUNTIME-CHECKPOINT-SCHEMA-UNVERIFIED");
  });
});
