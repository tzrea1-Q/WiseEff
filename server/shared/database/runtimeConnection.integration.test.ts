import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedUpgradeDocker } from "../../../scripts/isolated-upgrade-docker";
import { openRuntimeDatabase } from "./runtimeConnection";
import { createPostgresCheckpointerSaver, setupXiaozeCheckpointerTables, verifyPostgresCheckpointerTables } from "../../modules/agent/xiaoze/durableCheckpointer";

describe.skipIf(!process.env.UPG_RUNTIME_DOCKER_DAEMON_ID)("actual runtime login and checkpoint management separation", () => {
  const name = `wiseeff-upg-runtime-${randomBytes(6).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  let docker: ReturnType<typeof createIsolatedUpgradeDocker>;
  let id = "";
  let port = "";
  let admin: pg.Client;
  const url = (role: string) => `postgres://${role}:${password}@127.0.0.1:${port}/postgres`;
  beforeAll(async () => {
    docker = createIsolatedUpgradeDocker();
    const expected = process.env.UPG_RUNTIME_DOCKER_DAEMON_ID;
    if (docker.command(["info", "--format", "{{.ID}}|{{.Name}}|{{.OperatingSystem}}"] ).toString().trim() !== `${expected}|docker-desktop|Docker Desktop`) {
      throw new Error("explicit development daemon identity mismatch");
    }
    id = docker.command(["run", "-d", "--name", name, "--label", `wiseeff.test=${name}`, "-e", `POSTGRES_PASSWORD=${password}`, "-p", "127.0.0.1::5432", "postgres:16-alpine"]).toString().trim();
    docker.assertOwned(id, "wiseeff.test", name);
    port = docker.command(["inspect", "--format", '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}', id]).toString().trim();
    for (let attempt = 0; attempt < 30; attempt++) {
      const client = new pg.Client({ connectionString: url("postgres") });
      try { await client.connect(); admin = client; break; }
      catch { await client.end().catch(() => undefined); await setTimeout(200); }
    }
    if (!admin) throw new Error("owned development cluster unavailable");
    await admin.query(`create role runtime login password '${password}' nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
      create role elevated login password '${password}' nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
      create role bridge nologin noinherit; create role forbidden nologin createdb;
      grant forbidden to bridge; grant bridge to elevated with inherit false;
      create table public.runtime_business(id integer primary key, value text);
      insert into public.runtime_business values (1,'synthetic');
      grant select on public.runtime_business to runtime;`);
  });
  afterAll(async () => {
    await admin?.end();
    if (id) { docker.assertOwned(id, "wiseeff.test", name); docker.command(["rm", "-f", "-v", id]); }
  });
  it("uses the actual restricted login pool for reads and rejects direct writes and elevation", async () => {
    const db = await openRuntimeDatabase({ connectionString: url("runtime"), nodeEnv: "production" });
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
  it.each(["server/index.ts", "server/modules/logs/workerRunner.ts"])("%s refuses privileged login before worker/server construction", (entry) => {
    const result = spawnSync(process.execPath, ["--import", "tsx", path.resolve(entry)], {
      encoding: "utf8", timeout: 20000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production", DATABASE_URL: url("postgres"),
        OBJECT_STORE_MODE: "s3", OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:1", OBJECT_STORAGE_BUCKET: "isolated-unused",
        OBJECT_STORAGE_ACCESS_KEY_ID: "synthetic-unused", OBJECT_STORAGE_SECRET_ACCESS_KEY: "synthetic-unused",
        AUTH_MODE: "production", AUTH_PROVIDER: "local", XIAOZE_CHECKPOINTER: "postgres",
        LOG_ANALYSIS_QUEUE_MODE: "durable", NOTIFICATION_QUEUE_MODE: "durable", REDIS_URL: "redis://127.0.0.1:1",
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("PCAT-RUNTIME-PRIVILEGED-LOGIN");
    expect(result.stdout + result.stderr).not.toContain(password);
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
  });
});
