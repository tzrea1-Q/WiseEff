import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdtemp, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
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
  const label = "wiseeff.test";
  const volumeName = `${name}-data`;
  let networkId = "";
  let networkCreated = "";
  let volume: { name: string; created: string; mountpoint: string } | undefined;
  let imageId = "";
  let privateDirectory = "";
  let privateDirectoryIdentity: { dev: number; ino: number } | undefined;
  let privateFileIdentity: { dev: number; ino: number } | undefined;
  let port = "";
  let admin: pg.Client;
  const url = (role: string) => `postgres://${role}:${password}@127.0.0.1:${port}/postgres`;
  const containerConsumers = (args: string[]) => docker.command(["ps", "-a", "--no-trunc", ...args, "--format", "{{.ID}}"])
    .toString().trim().split("\n").filter(Boolean);
  const inspectNetwork = (allowedContainers: string[]) => {
    const actual = JSON.parse(docker.command(["network", "inspect", networkId]).toString())[0];
    if (!/^[a-f0-9]{64}$/.test(networkId) || !Number.isFinite(Date.parse(networkCreated))
      || actual?.Id !== networkId || actual.Name !== name || actual.Created !== networkCreated
      || actual.Labels?.[label] !== name || actual.Driver !== "bridge" || actual.Internal !== false
      || actual.Options?.["com.docker.network.bridge.enable_ip_masquerade"] !== "false"
      || Object.keys(actual.Containers ?? {}).some(container => !allowedContainers.includes(container))
      || containerConsumers(["--filter", `network=${networkId}`]).some(container => !allowedContainers.includes(container))) {
      throw new Error("owned runtime network identity mismatch");
    }
  };
  const inspectVolume = (allowedContainers: string[]) => {
    const actual = JSON.parse(docker.command(["volume", "inspect", volumeName]).toString())[0];
    if (!volume || !Number.isFinite(Date.parse(volume.created)) || typeof volume.mountpoint !== "string" || !path.posix.isAbsolute(volume.mountpoint)
      || actual?.Name !== volume.name || actual.CreatedAt !== volume.created || actual.Mountpoint !== volume.mountpoint
      || actual.Labels?.[label] !== name || actual.Driver !== "local" || actual.Scope !== "local"
      || Object.keys(actual.Options ?? {}).length !== 0
      || containerConsumers(["--filter", `volume=${volumeName}`]).some(container => !allowedContainers.includes(container))) {
      throw new Error("owned runtime volume identity mismatch");
    }
  };
  const inspectContainer = () => {
    const actual = docker.assertOwned(id, label, name);
    const networks = Object.values(actual.NetworkSettings?.Networks ?? {}) as { NetworkID: string }[];
    if (actual.Name !== `/${name}` || actual.Image !== imageId || actual.HostConfig?.NetworkMode !== networkId
      || networks.length !== 1 || networks[0].NetworkID !== networkId || actual.Mounts?.length !== 1
      || actual.Mounts[0].Type !== "volume" || actual.Mounts[0].Name !== volumeName || actual.Mounts[0].Source !== volume?.mountpoint
      || actual.Mounts[0].Destination !== "/var/lib/postgresql/data" || actual.Mounts[0].RW !== true) {
      throw new Error("owned runtime container resources mismatch");
    }
    inspectNetwork([id]); inspectVolume([id]);
    return actual;
  };
  const removePrivateConfiguration = async () => {
    if (!privateDirectoryIdentity) return;
    const directory = await lstat(privateDirectory);
    if (!directory.isDirectory() || directory.dev !== privateDirectoryIdentity.dev || directory.ino !== privateDirectoryIdentity.ino
      || (directory.mode & 0o777) !== 0o700 || directory.uid !== process.getuid?.()) throw new Error("runtime private directory identity mismatch");
    const entries = await readdir(privateDirectory);
    if (privateFileIdentity) {
      const file = await lstat(path.join(privateDirectory, "postgres.env"));
      if (!file.isFile() || file.nlink !== 1 || file.dev !== privateFileIdentity.dev || file.ino !== privateFileIdentity.ino
        || (file.mode & 0o777) !== 0o600 || file.uid !== directory.uid || entries.length !== 1 || entries[0] !== "postgres.env") {
        throw new Error("runtime private configuration identity mismatch");
      }
      await unlink(path.join(privateDirectory, "postgres.env"));
    } else if (entries.length) throw new Error("runtime private configuration outcome unknown");
    await rmdir(privateDirectory);
  };
  beforeAll(async () => {
    docker = createIsolatedUpgradeDocker();
    const expected = process.env.UPG_RUNTIME_DOCKER_DAEMON_ID;
    if (docker.command(["info", "--format", "{{.ID}}|{{.Name}}|{{.OperatingSystem}}"] ).toString().trim() !== `${expected}|docker-desktop|Docker Desktop`) {
      throw new Error("explicit development daemon identity mismatch");
    }
    // Refuse collisions before creation; a prefix or a local daemon is not an
    // ownership proof. Every removal below rechecks the actual created resource.
    if (docker.command(["ps", "-a", "--format", "{{.Names}}"] ).toString().trim().split("\n").includes(name)
      || docker.command(["network", "ls", "--format", "{{.Name}}"] ).toString().trim().split("\n").includes(name)
      || docker.command(["volume", "ls", "--format", "{{.Name}}"] ).toString().trim().split("\n").includes(volumeName)) {
      throw new Error("runtime resource name collision");
    }
    imageId = JSON.parse(docker.command(["image", "inspect", "postgres:16-alpine"]).toString())[0]?.Id;
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("runtime source image identity missing");
    privateDirectory = await mkdtemp(path.join(os.tmpdir(), "wiseeff-runtime-private-"));
    await chmod(privateDirectory, 0o700);
    privateDirectoryIdentity = await lstat(privateDirectory);
    const environmentFile = path.join(privateDirectory, "postgres.env");
    await writeFile(environmentFile, `POSTGRES_PASSWORD=${password}\n`, { flag: "wx", mode: 0o600 });
    privateFileIdentity = await lstat(environmentFile);
    networkId = docker.command(["network", "create", "--driver", "bridge", "--label", `${label}=${name}`,
      "--opt", "com.docker.network.bridge.enable_ip_masquerade=false", name]).toString().trim();
    networkCreated = JSON.parse(docker.command(["network", "inspect", networkId]).toString())[0]?.Created;
    inspectNetwork([]);
    if (docker.command(["volume", "create", "--driver", "local", "--label", `${label}=${name}`, volumeName]).toString().trim() !== volumeName) {
      throw new Error("runtime volume creation outcome unknown");
    }
    const createdVolume = JSON.parse(docker.command(["volume", "inspect", volumeName]).toString())[0];
    volume = { name: volumeName, created: createdVolume.CreatedAt, mountpoint: createdVolume.Mountpoint };
    inspectVolume([]);
    id = docker.command(["run", "-d", "--name", name, "--label", `${label}=${name}`, "--network", networkId,
      "--mount", `type=volume,src=${volumeName},dst=/var/lib/postgresql/data`, "--env-file", environmentFile,
      "-p", "127.0.0.1::5432", imageId]).toString().trim();
    const actual = inspectContainer();
    const bindings = actual.NetworkSettings.Ports?.["5432/tcp"];
    if (!actual.State.Running || bindings?.length !== 1 || bindings[0].HostIp !== "127.0.0.1"
      || Object.entries(actual.NetworkSettings.Ports).some(([key, value]) => key !== "5432/tcp" && Boolean(value))) {
      throw new Error("runtime published endpoint mismatch");
    }
    port = bindings[0].HostPort;
    if (!/^[1-9][0-9]*$/.test(port) || Number(port) > 65535) throw new Error("runtime published port invalid");
    for (let attempt = 0; attempt < 30; attempt++) {
      const client = new pg.Client({ connectionString: url("postgres") });
      try { await client.connect(); admin = client; break; }
      catch { await client.end().catch(() => undefined); await setTimeout(200); }
    }
    if (!admin) throw new Error("owned development cluster unavailable");
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
    try {
      await admin?.end();
      if (id) { inspectContainer(); docker.command(["rm", "-f", id]); id = ""; }
      if (volume) { inspectVolume([]); docker.command(["volume", "rm", volume.name]); volume = undefined; }
      if (networkId) { inspectNetwork([]); docker.command(["network", "rm", networkId]); networkId = ""; }
    } finally { await removePrivateConfiguration(); }
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
  it("refuses a login able to assume the release verification writer role", async () => {
    await admin.query("create role catalog_verification_writer_role nologin noinherit; grant catalog_verification_writer_role to runtime with inherit false");
    try {
      const outcome = await openRuntimeDatabase({ connectionString: url("runtime"), nodeEnv: "production" })
        .then(async db => { await db.close(); return "allowed"; }, error => error.code);
      expect(outcome).toBe("PCAT-RUNTIME-MANAGEMENT-ROLE-REACHABLE");
    } finally { await admin.query("revoke catalog_verification_writer_role from runtime; drop role catalog_verification_writer_role"); }
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
    await admin.query("alter table public.checkpoints alter column metadata drop default; alter table public.checkpoints alter column metadata type text using metadata::text");
    await expect(verifyPostgresCheckpointerTables(url("runtime"))).rejects.toThrow("PCAT-RUNTIME-CHECKPOINT-SCHEMA-UNVERIFIED");
    await admin.query("alter table public.checkpoints alter column metadata type jsonb using metadata::jsonb; alter table public.checkpoints alter column metadata set default '{}'::jsonb; alter table public.checkpoints drop constraint checkpoints_pkey");
    await expect(verifyPostgresCheckpointerTables(url("runtime"))).rejects.toThrow("PCAT-RUNTIME-CHECKPOINT-SCHEMA-UNVERIFIED");
  });
});
