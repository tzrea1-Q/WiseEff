import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { createHttpObjectStorageTransport } from "../server/modules/logs/s3ObjectStore";
import { createIsolatedUpgradeDocker } from "./isolated-upgrade-docker";

const images = { postgres: "postgres:16-alpine", redis: "redis:7-alpine", objects: "minio/minio:RELEASE.2025-04-22T22-12-26Z", objectClient: "minio/mc:RELEASE.2024-11-21T17-21-54Z" };
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const label = "wiseeff.synthetic-recovery-run";

export function ownsRecoveryContainer(inspect: { Id: string; Config?: { Labels?: Record<string, string> } }, id: string, run: string) {
  return inspect.Id === id && inspect.Config?.Labels?.[label] === run;
}

/** No external targets, backups, image overrides, production configuration, or SQL inputs. */
export async function rehearseSyntheticRecovery() {
  const run = randomBytes(12).toString("hex");
  const password = randomBytes(24).toString("hex");
  const ids: string[] = [];
  const pinnedImages = new Map<string, string>();
  const result = {
    schemaVersion: "synthetic-three-store-recovery-v1", evidence: "synthetic sentinel only",
    releaseReady: false, fullBusinessVerification: false, status: "blocked",
    backupExists: false, backupRetained: false, checksumVerified: false, restoreExecuted: false, businessVerified: false,
    ownerAclVerified: false, cleanupVerified: false, objectCount: 0,
    reason: "not-started", imageIdentities: {} as Record<string, string>, manifestDigest: "",
  };
  let directory: string | undefined;
  let interrupted = false;
  let cleaning = false;
  let transport: ReturnType<typeof createIsolatedUpgradeDocker>;
  const onInterrupt = () => { interrupted = true; };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);
  const docker = (args: string[], input?: Buffer): Buffer => {
    if (interrupted && !cleaning) throw new Error("synthetic-drill-interrupted");
    return transport.command(args, input);
  };
  const owned = (id: string) => {
    const info = JSON.parse(docker(["inspect", id]).toString())[0];
    if (!ownsRecoveryContainer(info, id, run)) throw new Error("container-identity-mismatch");
    return info;
  };
  const execute = (id: string, args: string[], input?: Buffer) => {
    owned(id);
    return docker(["exec", "-i", id, ...args], input);
  };
  const create = (image: string, port: string, extra: string[], command: string[]) => {
    const id = docker(["create", "--label", `${label}=${run}`, "--name", `upg-recovery-${run}-${ids.length}`,
      "-p", `127.0.0.1::${port}`, ...extra, pinnedImages.get(image)!, ...command]).toString().trim();
    ids.push(id); owned(id); return id;
  };
  const start = (id: string) => { owned(id); docker(["start", id]); };
  const endpoint = (id: string, port: string) => `127.0.0.1:${owned(id).NetworkSettings.Ports[`${port}/tcp`][0].HostPort}`;
  const wait = async (probe: () => Promise<unknown>) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      try { await probe(); return; } catch { await setTimeout(150); }
    }
    throw new Error("store-startup-failed");
  };
  try {
    result.reason = "isolated-local-docker-required";
    transport = createIsolatedUpgradeDocker();
    result.reason = "required-local-image-unavailable";
    for (const [kind, image] of Object.entries(images)) {
      result.imageIdentities[kind] = docker(["image", "inspect", image, "--format", "{{.Id}} {{.Os}}/{{.Architecture}}"])
        .toString().trim();
      pinnedImages.set(image, result.imageIdentities[kind].split(" ")[0]!);
    }
    directory = await mkdtemp(path.join(os.tmpdir(), "wiseeff-synthetic-recovery-"));
    result.reason = "source-preparation-failed";
    const sourcePg = create(images.postgres, "5432", ["-e", `POSTGRES_PASSWORD=${password}`], []);
    const sourceRedis = create(images.redis, "6379", [], ["redis-server", "--appendonly", "no", "--save", ""]);
    const sourceObjects = create(images.objects, "9000", ["-e", "MINIO_ROOT_USER=synthetic", "-e", `MINIO_ROOT_PASSWORD=${password}`], ["server", "/data"]);
    for (const id of ids) start(id);
    await wait(async () => execute(sourcePg, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres"]));
    await wait(async () => execute(sourceRedis, ["redis-cli", "PING"]));
    const storage = (id: string) => createHttpObjectStorageTransport({ endpoint: `http://${endpoint(id, "9000")}`,
      accessKeyId: "synthetic", secretAccessKey: password });
    const sourceStore = storage(sourceObjects);
    const bucket = "synthetic-recovery";
    const objectClient = create(images.objectClient, "9001", ["--entrypoint", "/bin/sh"], ["-c", "sleep 300"]);
    start(objectClient);
    const mc = (id: string, args: string[]) => {
      const ip = owned(id).NetworkSettings.Networks.bridge?.IPAddress;
      if (!ip) throw new Error("object-store-container-network-unavailable");
      owned(objectClient);
      return docker(["exec", "-e", `MC_HOST_synthetic=http://synthetic:${password}@${ip}:9000`, objectClient, "mc", ...args]);
    };
    result.reason = "source-object-store-preparation-failed";
    await wait(async () => mc(sourceObjects, ["mb", `synthetic/${bucket}`]));
    result.reason = "source-synthetic-seed-failed";
    const roles = `create role sentinel_owner nologin; create role sentinel_reader login password '${password}' nosuperuser nobypassrls nocreatedb nocreaterole;`;
    execute(sourcePg, ["psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], Buffer.from(roles + `
      create table public.sentinel(id integer primary key, value text not null);
      alter table public.sentinel owner to sentinel_owner;
      insert into public.sentinel values (1,'synthetic-value');
      grant select on public.sentinel to sentinel_reader;
    `));
    const objectData = Buffer.from("synthetic object payload\n");
    await sourceStore.put({ bucket, key: "sentinel", bytes: objectData, contentType: "text/plain", metadata: { synthetic: "true" } });
    execute(sourceRedis, ["redis-cli", "SET", "synthetic:sentinel", "synthetic-redis-value"]);
    // No application processes or external writers exist in this synthetic boundary.
    result.reason = "backup-failed";
    const dump = execute(sourcePg, ["pg_dump", "-U", "postgres", "-d", "postgres", "--format=custom"]);
    await writeFile(path.join(directory, "postgres.dump"), dump, { mode: 0o600 });
    execute(sourceRedis, ["redis-cli", "SAVE"]);
    owned(sourceRedis); docker(["cp", `${sourceRedis}:/data/dump.rdb`, path.join(directory, "dump.rdb")]);
    const objectBackup = await sourceStore.get({ bucket, key: "sentinel" });
    if (mc(sourceObjects, ["ls", "--json", `synthetic/${bucket}`]).toString().trim().split("\n").length !== 1) throw new Error("source-object-count-mismatch");
    await writeFile(path.join(directory, "object.bin"), objectBackup, { mode: 0o600 });
    const redisBackup = await readFile(path.join(directory, "dump.rdb"));
    result.backupExists = true;
    if (hash(objectBackup) !== hash(objectData)) throw new Error("object-checksum-mismatch");
    for (const [name, bytes] of [["postgres.dump", dump], ["object.bin", objectBackup], ["dump.rdb", redisBackup]] as const) {
      if (hash(await readFile(path.join(directory, name))) !== hash(bytes)) throw new Error("backup-checksum-mismatch");
    }
    result.manifestDigest = hash(Buffer.from(JSON.stringify([hash(dump), hash(objectBackup), hash(redisBackup)])));
    result.checksumVerified = true;
    result.reason = "restore-failed";
    const targetPg = create(images.postgres, "5432", ["-e", `POSTGRES_PASSWORD=${password}`], []);
    const targetRedis = create(images.redis, "6379", [], ["redis-server", "--appendonly", "no", "--save", ""]);
    const targetObjects = create(images.objects, "9000", ["-e", "MINIO_ROOT_USER=synthetic", "-e", `MINIO_ROOT_PASSWORD=${password}`], ["server", "/data"]);
    owned(targetRedis); docker(["cp", path.join(directory, "dump.rdb"), `${targetRedis}:/data/dump.rdb`]);
    start(targetPg); start(targetRedis); start(targetObjects);
    await wait(async () => execute(targetPg, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres"]));
    execute(targetPg, ["psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], Buffer.from(roles));
    execute(targetPg, ["pg_restore", "-U", "postgres", "-d", "postgres", "--exit-on-error"], dump);
    const targetStore = storage(targetObjects);
    await wait(async () => mc(targetObjects, ["mb", `synthetic/${bucket}`]));
    await targetStore.put({ bucket, key: "sentinel", bytes: objectBackup, contentType: "text/plain", metadata: { synthetic: "true" } });
    result.restoreExecuted = true;
    result.reason = "restored-verification-failed";
    const login = new pg.Client({ connectionString: `postgres://sentinel_reader:${password}@${endpoint(targetPg, "5432")}/postgres` });
    await login.connect();
    try {
      const rows = await login.query("select * from public.sentinel order by id");
      if (JSON.stringify(rows.rows) !== JSON.stringify([{ id: 1, value: "synthetic-value" }])) throw new Error("database-value-mismatch");
      const acl = await login.query(`select pg_get_userbyid(relowner) = 'sentinel_owner' as owner_ok,
        has_table_privilege(current_user,oid,'SELECT') as can_read,
        has_table_privilege(current_user,oid,'INSERT') as can_write from pg_class where oid='public.sentinel'::regclass`);
      if (JSON.stringify(acl.rows[0]) !== JSON.stringify({ owner_ok: true, can_read: true, can_write: false })) throw new Error("owner-acl-mismatch");
      result.ownerAclVerified = true;
    } finally { await login.end(); }
    if (hash(await targetStore.get({ bucket, key: "sentinel" })) !== hash(objectData)) throw new Error("restored-object-mismatch");
    const metadata = await targetStore.head({ bucket, key: "sentinel" });
    if (!metadata || metadata.metadata?.synthetic !== "true") throw new Error("restored-object-metadata-mismatch");
    const listing = mc(targetObjects, ["ls", "--json", `synthetic/${bucket}`]).toString();
    result.objectCount = listing.trim().split("\n").filter(Boolean).length;
    if (result.objectCount !== 1) throw new Error("object-count-mismatch");
    await wait(async () => {
      if (execute(targetRedis, ["redis-cli", "GET", "synthetic:sentinel"]).toString().trim() !== "synthetic-redis-value") throw new Error("redis-value-mismatch");
    });
    result.businessVerified = true; // Only the explicitly labeled synthetic sentinel behavior.
    result.status = "passed"; result.reason = "synthetic-sentinels-restored";
  } catch {
    result.status = "blocked"; // Keep the static stage, never driver output or private material.
  } finally {
    cleaning = true;
    let cleaned = true;
    for (const id of [...ids].reverse()) {
      try { owned(id); docker(["rm", "-f", "-v", id]); } catch { cleaned = false; }
    }
    if (directory) await rm(directory, { recursive: true, force: true });
    result.cleanupVerified = cleaned;
    if (!cleaned) { result.status = "blocked"; result.reason = "owned-resource-cleanup-failed"; }
    if (interrupted) { result.status = "blocked"; result.reason = "synthetic-drill-interrupted"; }
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).join(" ") !== "--synthetic-only") {
    console.log(JSON.stringify({ status: "blocked", reason: "explicit-synthetic-only-required-no-other-arguments" }));
    process.exitCode = 2;
  } else {
    const result = await rehearseSyntheticRecovery();
    console.log(JSON.stringify(result)); process.exitCode = result.status === "passed" ? 0 : 1;
  }
}
