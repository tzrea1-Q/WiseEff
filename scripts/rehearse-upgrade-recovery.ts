import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { createHttpObjectStorageTransport } from "../server/modules/logs/s3ObjectStore";
import { createIsolatedUpgradeDocker } from "./isolated-upgrade-docker";
import { captureRecoveryPackage, hasUnsupportedNonDumpCapabilities, RECOVERY_NON_DUMP_CAPABILITY_INVENTORY_SQL, restoreRecoveryPackage, type RecoveryRole } from "../ops/self-hosted/storage/recoveryPackage";

const images = { postgres: "postgres:16-alpine", redis: "redis:7-alpine", objects: "minio/minio:RELEASE.2024-12-18T13-15-44Z", objectClient: "minio/mc:RELEASE.2024-11-21T17-21-54Z" };
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const label = "wiseeff.synthetic-recovery-run";
const nonDumpFaults = {
  "database-acl": "grant create on database postgres to sentinel_reader",
  "other-database-acl": "grant create on database template1 to sentinel_reader",
  "tablespace-acl": "grant create on tablespace pg_default to sentinel_reader",
  "parameter-acl": "grant alter system on parameter work_mem to sentinel_reader",
  "builtin-function-acl": "revoke execute on function pg_catalog.pg_control_system() from public",
} as const;
type SyntheticFault = "stale-target-aof" | "missing-object" | "wrong-target" | keyof typeof nonDumpFaults;

type RestoreChild = {
  run: string; daemonId: string; directory: string; digest: string; password: string;
  pg: string; redis: string; objects: string; objectClient: string; network: string;
};

/** Private subprocess adapter: stdin carries ephemeral target credentials. No source
 * connection, source container, fixture role SQL or object metadata is accepted. */
async function restoreSyntheticPackage(config: RestoreChild) {
  const transport = createIsolatedUpgradeDocker();
  if (transport.daemonId !== config.daemonId || !/^[a-f0-9]{24}$/.test(config.run)) throw new Error("synthetic-target-binding-invalid");
  const owned = (id: string) => transport.assertOwned(id, label, config.run);
  const exec = (id: string, args: string[], input?: Buffer) => { owned(id); return transport.command(["exec", "-i", id, ...args], input); };
  const target = { deploymentId: `restore-${config.run}`, hostFingerprint: config.daemonId, postgresIdentity: config.pg, objectStoreIdentity: config.objects, redisIdentity: config.redis };
  const endpoint = (id: string, port: string) => `127.0.0.1:${owned(id).NetworkSettings.Ports[`${port}/tcp`][0].HostPort}`;
  await restoreRecoveryPackage(config.directory, config.digest, {
    target, journalPath: path.join(config.directory, "restore-journal.json"),
    async authorize(binding) {
      // Synthetic scope only. Production must supply the real controller approval adapter.
      if (binding.runId !== config.run || binding.packageDigest !== config.digest || binding.source.hostFingerprint !== config.daemonId) throw new Error("synthetic-package-binding-invalid");
    },
    async assertEmptyAndIsolated() {
      const networkInfo = JSON.parse(transport.command(["network", "inspect", config.network]).toString())[0];
      if (networkInfo.Labels?.[label] !== config.run) throw new Error("synthetic-network-ownership-mismatch");
      for (const id of [config.pg, config.redis, config.objects, config.objectClient]) {
        const info = owned(id);
        if (!info.NetworkSettings.Networks[config.network]) throw new Error("synthetic-network-mismatch");
      }
      if (owned(config.redis).State.Running) throw new Error("redis-restore-requires-stopped-empty-target");
      if (exec(config.pg, ["psql", "-U", "postgres", "-Atc", "select count(*) from pg_tables where schemaname='public'"]).toString().trim() !== "0") throw new Error("database-target-not-empty");
      const inspection = await mkdtemp(path.join(os.tmpdir(), "upg-empty-redis-"));
      try {
        transport.command(["cp", `${config.redis}:/data/.`, inspection]);
        if ((await readdir(inspection)).length) throw new Error("redis-target-has-existing-persistence");
      } finally { await rm(inspection, { recursive: true, force: true }); }
      const ip = owned(config.objects).NetworkSettings.Networks[config.network].IPAddress;
      const buckets = transport.command(["exec", "-e", `MC_HOST_synthetic=http://synthetic:${config.password}@${ip}:9000`, config.objectClient, "mc", "ls", "--json", "synthetic"]).toString().trim();
      if (buckets) throw new Error("object-target-not-empty");
    },
    async restore(backup) {
      // Structured nonprivileged role restore; secrets come only from this process stdin.
      const roles = backup.roles.map(role => `create role "${role.name}" ${role.login ? `login password '${config.password}'` : "nologin"} ${role.inherit ? "inherit" : "noinherit"} nosuperuser nobypassrls nocreatedb nocreaterole noreplication;`).join("\n");
      const members = backup.roles.flatMap(role => role.members.flatMap(member => [
        `grant "${role.name}" to "${member.name}" with admin false;`,
        `grant "${role.name}" to "${member.name}" with inherit ${member.inherit ? "true" : "false"};`,
        `grant "${role.name}" to "${member.name}" with set ${member.set ? "true" : "false"};`,
      ])).join("\n");
      exec(config.pg, ["psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], Buffer.from(`begin;\n${roles}\n${members}\ncommit;`));
      exec(config.pg, ["pg_restore", "-U", "postgres", "-d", "postgres", "--exit-on-error"], backup.postgres);
      const targetStore = createHttpObjectStorageTransport({ endpoint: `http://${endpoint(config.objects, "9000")}`, accessKeyId: "synthetic", secretAccessKey: config.password });
      const ip = owned(config.objects).NetworkSettings.Networks[config.network].IPAddress;
      owned(config.objectClient);
      transport.command(["exec", "-e", `MC_HOST_synthetic=http://synthetic:${config.password}@${ip}:9000`, config.objectClient, "mc", "mb", "synthetic/synthetic-recovery"]);
      for (const object of backup.objects) await targetStore.put({ bucket: "synthetic-recovery", ...object });
      const redisDirectory = path.join(config.directory, "verified-redis-import");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(redisDirectory, { mode: 0o700 });
      for (const file of backup.redis.files) await writeFile(path.join(redisDirectory, file.name), file.bytes, { flag: "wx", mode: 0o600 });
      owned(config.redis);
      transport.command(["cp", redisDirectory, `${config.redis}:/data/appendonlydir`]);
      transport.command(["start", config.redis]);
    },
  });
}

export function ownsRecoveryContainer(inspect: { Id: string; Config?: { Labels?: Record<string, string> } }, id: string, run: string) {
  return inspect.Id === id && inspect.Config?.Labels?.[label] === run;
}

/** No external targets, backups, image overrides, production configuration, or SQL inputs. */
export async function rehearseSyntheticRecovery(options: { fault?: SyntheticFault } = {}) {
  if (Object.keys(options).some(key => key !== "fault") || (options.fault && !["stale-target-aof", "missing-object", "wrong-target", ...Object.keys(nonDumpFaults)].includes(options.fault))) throw new Error("unknown-synthetic-fault");
  const run = randomBytes(12).toString("hex");
  const password = randomBytes(24).toString("hex");
  const targetPassword = randomBytes(24).toString("hex");
  const ids: string[] = [];
  let networkId = "";
  const network = `upg-recovery-${run}`;
  const pinnedImages = new Map<string, string>();
  const result = {
    schemaVersion: "synthetic-three-store-recovery-v3", evidence: "synthetic package only",
    releaseReady: false, fullBusinessVerification: false, status: "blocked",
    backupExists: false, backupRetained: false, checksumVerified: false, restoreExecuted: false, businessVerified: false,
    ownerAclVerified: false, roleCapabilitiesVerified: false, cleanupVerified: false, objectCount: 0,
    reason: "not-started", imageIdentities: {} as Record<string, string>, manifestDigest: "",
    sourceStoppedBeforeRestore: false, separateRestoreProcess: false, redisPersistence: "AOF", daemonIdentity: "",
    nonDumpCapabilitiesVerified: false, sourcePreservedBeforeCleanup: false,
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
      "--network", network, "-p", `127.0.0.1::${port}`, ...extra, pinnedImages.get(image)!, ...command]).toString().trim();
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
    result.daemonIdentity = transport.daemonId;
    result.reason = "required-local-image-unavailable";
    for (const [kind, image] of Object.entries(images)) {
      result.imageIdentities[kind] = docker(["image", "inspect", image, "--format", "{{.Id}} {{.Os}}/{{.Architecture}}"])
        .toString().trim();
      pinnedImages.set(image, result.imageIdentities[kind].split(" ")[0]!);
    }
    directory = await mkdtemp(path.join(os.tmpdir(), "wiseeff-synthetic-recovery-"));
    networkId = docker(["network", "create", "--opt", "com.docker.network.bridge.enable_ip_masquerade=false", "--label", `${label}=${run}`, network]).toString().trim();
    result.reason = "source-preparation-failed";
    const sourcePg = create(images.postgres, "5432", ["-e", `POSTGRES_PASSWORD=${password}`], []);
    result.reason = "source-redis-create-failed";
    const sourceRedis = create(images.redis, "6379", [], ["redis-server", "--appendonly", "yes", "--appendfsync", "always"]);
    result.reason = "source-objects-create-failed";
    const sourceObjects = create(images.objects, "9000", ["-e", "MINIO_ROOT_USER=synthetic", "-e", `MINIO_ROOT_PASSWORD=${password}`], ["server", "/data"]);
    result.reason = "source-start-failed";
    for (const id of ids) start(id);
    result.reason = "source-postgres-ready-failed";
    await wait(async () => execute(sourcePg, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres"]));
    result.reason = "source-redis-ready-failed";
    await wait(async () => execute(sourceRedis, ["redis-cli", "PING"]));
    const storage = (id: string, secret = password) => createHttpObjectStorageTransport({ endpoint: `http://${endpoint(id, "9000")}`,
      accessKeyId: "synthetic", secretAccessKey: secret });
    const sourceStore = storage(sourceObjects);
    const bucket = "synthetic-recovery";
    const objectClient = create(images.objectClient, "9001", ["--entrypoint", "/bin/sh"], ["-c", "sleep 300"]);
    start(objectClient);
    const mc = (id: string, args: string[], secret = password) => {
      const ip = owned(id).NetworkSettings.Networks[network]?.IPAddress;
      if (!ip) throw new Error("object-store-container-network-unavailable");
      owned(objectClient);
      return docker(["exec", "-e", `MC_HOST_synthetic=http://synthetic:${secret}@${ip}:9000`, objectClient, "mc", ...args]);
    };
    result.reason = "source-object-store-preparation-failed";
    await wait(async () => mc(sourceObjects, ["mb", `synthetic/${bucket}`]));
    result.reason = "source-synthetic-seed-failed";
    const roles = `create role sentinel_owner nologin noinherit;
      create role sentinel_read_capability nologin noinherit;
      create role sentinel_explicit_capability nologin noinherit;
      create role pgapp_recovery nologin noinherit;
      create role sentinel_reader login inherit password '${password}' nosuperuser nobypassrls nocreatedb nocreaterole;
      grant sentinel_read_capability to sentinel_reader with inherit true;
      grant sentinel_read_capability to sentinel_reader with set false;
      grant sentinel_explicit_capability to sentinel_reader with inherit false;
      grant sentinel_explicit_capability to sentinel_reader with set true;`;
    execute(sourcePg, ["psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], Buffer.from(roles + `
      create table public.sentinel(id integer primary key, value text not null);
      alter table public.sentinel owner to sentinel_owner;
      insert into public.sentinel values (1,'synthetic-value');
      grant select on public.sentinel to sentinel_read_capability;
      create table public.explicit_sentinel(id integer primary key, value text not null);
      alter table public.explicit_sentinel owner to sentinel_owner;
      insert into public.explicit_sentinel values (2,'synthetic-explicit');
      grant select on public.explicit_sentinel to sentinel_explicit_capability;
    `));
    const objectOracle = [
      { key: "evidence/alpha.json", bytes: Buffer.from('{"value":null}'), contentType: "application/json", metadata: { source: "alpha", revision: "2" } },
      { key: "reports/beta.txt", bytes: Buffer.from("different payload\n"), contentType: "text/plain", metadata: { source: "beta", revision: "9" } },
    ];
    for (const object of objectOracle) await sourceStore.put({ bucket, ...object });
    execute(sourceRedis, ["redis-cli", "LPUSH", "bull:synthetic:wait", "job-2", "job-1"]);
    execute(sourceRedis, ["redis-cli", "HSET", "bull:synthetic:meta", "paused", "1"]);
    // Only these seeded stores exist; no API, worker, proxy or external writer has this private network/credentials.
    result.reason = "non-dump-capability-inventory-unavailable";
    if (options.fault && Object.hasOwn(nonDumpFaults, options.fault)) {
      execute(sourcePg, ["psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], Buffer.from(nonDumpFaults[options.fault as keyof typeof nonDumpFaults]));
    }
    const readNonDumpInventory = () => JSON.parse(execute(sourcePg, ["psql", "-U", "postgres", "-Atc", RECOVERY_NON_DUMP_CAPABILITY_INVENTORY_SQL]).toString()) as unknown;
    const nonDumpInventory = readNonDumpInventory();
    if (hasUnsupportedNonDumpCapabilities(nonDumpInventory)) {
      result.reason = "non-dump-capability-unsupported";
      // Refusal performs no cleanup or corrective SQL. Only the fixture's final
      // owned-resource cleanup disposes of this synthetic source after evidence.
      const unchangedInventory = JSON.stringify(readNonDumpInventory()) === JSON.stringify(nonDumpInventory);
      const unchangedRows = execute(sourcePg, ["psql", "-U", "postgres", "-Atc", "select (select count(*) from public.sentinel where id=1 and value='synthetic-value') + (select count(*) from public.explicit_sentinel where id=2 and value='synthetic-explicit')"]).toString().trim() === "2";
      const unchangedObjects = (await Promise.all(objectOracle.map(async object => Boolean(await sourceStore.head({ bucket, key: object.key })) && hash(await sourceStore.get({ bucket, key: object.key })) === hash(object.bytes)))).every(Boolean);
      const unchangedQueue = execute(sourceRedis, ["redis-cli", "LRANGE", "bull:synthetic:wait", "0", "-1"]).toString().trim() === "job-1\njob-2" && execute(sourceRedis, ["redis-cli", "HGET", "bull:synthetic:meta", "paused"]).toString().trim() === "1";
      result.sourcePreservedBeforeCleanup = unchangedInventory && unchangedRows && unchangedObjects && unchangedQueue;
      throw new Error("non-dump-capability-unsupported");
    }
    result.nonDumpCapabilitiesVerified = true;
    result.reason = "backup-failed";
    const dump = execute(sourcePg, ["pg_dump", "-U", "postgres", "-d", "postgres", "--format=custom"]);
    const unsupportedRoles = execute(sourcePg, ["psql", "-U", "postgres", "-Atc", `select count(*) from pg_roles where rolname !~ '^pg_' and rolname <> 'postgres' and (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication or rolconnlimit <> -1 or rolvaliduntil is not null or rolconfig is not null)`]).toString().trim();
    // This profile preserves only package-contained, non-administrative edges
    // granted by the controlled source bootstrap identity. No pg_* membership
    // or alternate grantor is silently discarded or reconstructed with more power.
    const unsupportedMembership = execute(sourcePg, ["psql", "-U", "postgres", "-Atc", `select count(*) from pg_auth_members a
      join pg_roles member on member.oid=a.member join pg_roles granted on granted.oid=a.roleid
      join pg_roles grantor on grantor.oid=a.grantor
      where (member.rolname !~ '^pg_' and member.rolname <> 'postgres'
        or granted.rolname !~ '^pg_' and granted.rolname <> 'postgres')
      and (a.admin_option or grantor.rolname <> 'postgres'
        or member.rolname ~ '^pg_' or member.rolname='postgres'
        or granted.rolname ~ '^pg_' or granted.rolname='postgres')`]).toString().trim();
    const unsupportedRoleSettings = execute(sourcePg, ["psql", "-U", "postgres", "-Atc", `select count(*) from pg_db_role_setting s join pg_roles r on r.oid=s.setrole where r.rolname !~ '^pg_' and r.rolname <> 'postgres'`]).toString().trim();
    if (unsupportedRoles !== "0" || unsupportedMembership !== "0" || unsupportedRoleSettings !== "0") throw new Error("role-manifest-capability-unsupported");
    const roleManifest = JSON.parse(execute(sourcePg, ["psql", "-U", "postgres", "-Atc", `select coalesce(json_agg(json_build_object('name',rolname,'login',rolcanlogin,'inherit',rolinherit,'members',
      (select coalesce(json_agg(json_build_object('name',member.rolname,'inherit',am.inherit_option,'set',am.set_option) order by member.rolname),'[]')
       from pg_auth_members am join pg_roles member on member.oid=am.member where am.roleid=r.oid)) order by rolname),'[]')
      from pg_roles r where rolname !~ '^pg_' and rolname <> 'postgres'`]).toString()) as RecoveryRole[];
    const listing = mc(sourceObjects, ["ls", "--recursive", "--json", `synthetic/${bucket}`]).toString().trim().split("\n").map(line => JSON.parse(line));
    const objects = [];
    for (const entry of listing) {
      const key = entry.key as string;
      const head = await sourceStore.head({ bucket, key });
      const stat = JSON.parse(mc(sourceObjects, ["stat", "--json", `synthetic/${bucket}/${key}`]).toString());
      const contentType = stat.metadata?.["Content-Type"];
      if (typeof contentType !== "string") throw new Error("object-content-type-not-exported");
      objects.push({ key, bytes: await sourceStore.get({ bucket, key }), contentType, metadata: head?.metadata ?? {} });
    }
    for (const id of [sourcePg, sourceRedis, sourceObjects]) { owned(id); docker(["stop", id]); }
    result.sourceStoppedBeforeRestore = true;
    const redisExport = path.join(directory, "redis-export");
    owned(sourceRedis); docker(["cp", `${sourceRedis}:/data/appendonlydir`, redisExport]);
    const redisFiles = await Promise.all((await readdir(redisExport)).sort().map(async name => ({ name, bytes: await readFile(path.join(redisExport, name)) })));
    result.manifestDigest = await captureRecoveryPackage(directory, {
      runId: run, target: { deploymentId: `source-${run}`, hostFingerprint: transport.daemonId, postgresIdentity: sourcePg, objectStoreIdentity: sourceObjects, redisIdentity: sourceRedis },
      quiescence: { status: "quiesced", writersFenced: true, queueDrained: true, proxyStopped: true, observedAt: new Date().toISOString() },
      postgres: dump, roles: roleManifest, objects, redis: { appendonly: true, files: redisFiles },
    });
    result.backupExists = true;
    result.checksumVerified = true;
    result.reason = "restore-failed";
    const targetPg = create(images.postgres, "5432", ["-e", `POSTGRES_PASSWORD=${targetPassword}`], []);
    const targetRedis = create(images.redis, "6379", [], ["redis-server", "--appendonly", "yes", "--appendfsync", "always"]);
    const targetObjects = create(images.objects, "9000", ["-e", "MINIO_ROOT_USER=synthetic", "-e", `MINIO_ROOT_PASSWORD=${targetPassword}`], ["server", "/data"]);
    start(targetPg); start(targetObjects);
    if (options.fault === "stale-target-aof") {
      start(targetRedis);
      await wait(async () => execute(targetRedis, ["redis-cli", "PING"]));
      execute(targetRedis, ["redis-cli", "SET", "old-target-only", "must-not-replay"]);
      owned(targetRedis); docker(["stop", targetRedis]);
    }
    await wait(async () => execute(targetPg, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres"]));
    const targetStore = storage(targetObjects, targetPassword);
    await wait(async () => mc(targetObjects, ["ready", "synthetic"], targetPassword));
    if (options.fault === "missing-object") await rm(path.join(directory, "payload-1.bin"));
    const child = spawnSync(process.execPath, ["--import", "tsx", new URL(import.meta.url).pathname, "--synthetic-package-child"], {
      input: JSON.stringify({ run: options.fault === "wrong-target" ? "0".repeat(24) : run, daemonId: transport.daemonId, directory, digest: result.manifestDigest, password: targetPassword, pg: targetPg, redis: targetRedis, objects: targetObjects, objectClient, network } satisfies RestoreChild),
      encoding: "utf8", timeout: 60000, env: { PATH: process.env.PATH, HOME: os.homedir() },
    });
    if (child.status !== 0) throw new Error("separate-package-restore-failed");
    result.separateRestoreProcess = true;
    result.restoreExecuted = true;
    result.reason = "restored-verification-failed";
    const login = new pg.Client({ connectionString: `postgres://sentinel_reader:${targetPassword}@${endpoint(targetPg, "5432")}/postgres` });
    await login.connect();
    try {
      const rows = await login.query("select * from public.sentinel order by id");
      if (JSON.stringify(rows.rows) !== JSON.stringify([{ id: 1, value: "synthetic-value" }])) throw new Error("database-value-mismatch");
      const acl = await login.query(`select pg_get_userbyid(relowner) = 'sentinel_owner' as owner_ok,
        has_table_privilege(current_user,oid,'SELECT') as can_read,
        has_table_privilege(current_user,oid,'INSERT') as can_write from pg_class where oid='public.sentinel'::regclass`);
      if (JSON.stringify(acl.rows[0]) !== JSON.stringify({ owner_ok: true, can_read: true, can_write: false })) throw new Error("owner-acl-mismatch");
      result.ownerAclVerified = true;
      const expectDenied = async (sql: string) => {
        try { await login.query(sql); } catch (error) {
          if ((error as { code?: string }).code === "42501") return;
          throw error;
        }
        throw new Error("restored-role-allowed-forbidden-operation");
      };
      await expectDenied("insert into public.sentinel values (9,'forbidden')");
      await expectDenied("set role sentinel_owner");
      await expectDenied("set role sentinel_read_capability");
      await expectDenied("select * from public.explicit_sentinel");
      const attributes = await login.query(`select rolname as name, rolcanlogin as login, rolinherit as "inherit",
        rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication as privileged
        from pg_roles where rolname like 'sentinel_%' order by rolname`);
      const expectedAttributes = [
        { name: "sentinel_explicit_capability", login: false, inherit: false, privileged: false },
        { name: "sentinel_owner", login: false, inherit: false, privileged: false },
        { name: "sentinel_read_capability", login: false, inherit: false, privileged: false },
        { name: "sentinel_reader", login: true, inherit: true, privileged: false },
      ];
      if (JSON.stringify(attributes.rows) !== JSON.stringify(expectedAttributes)) throw new Error("restored-role-attributes-mismatch");
      // pgapp is a legal user-role prefix; SQL LIKE 'pg_%' would silently omit
      // it because underscore is a wildcard rather than a literal separator.
      const nonReserved = await login.query("select rolcanlogin as login,rolinherit as inherit from pg_roles where rolname='pgapp_recovery'");
      if (JSON.stringify(nonReserved.rows) !== JSON.stringify([{ login: false, inherit: false }])) throw new Error("restored-nonreserved-role-missing");
      const memberships = await login.query(`select granted.rolname as role, member.rolname as member,
        a.admin_option as admin, a.inherit_option as "inherit", a.set_option as "set"
        from pg_auth_members a join pg_roles granted on granted.oid=a.roleid join pg_roles member on member.oid=a.member
        where member.rolname='sentinel_reader' order by granted.rolname`);
      const expectedMemberships = [
        { role: "sentinel_explicit_capability", member: "sentinel_reader", admin: false, inherit: false, set: true },
        { role: "sentinel_read_capability", member: "sentinel_reader", admin: false, inherit: true, set: false },
      ];
      if (JSON.stringify(memberships.rows) !== JSON.stringify(expectedMemberships)) throw new Error("restored-role-membership-mismatch");
      await login.query("set role sentinel_explicit_capability");
      const explicit = await login.query("select * from public.explicit_sentinel order by id");
      if (JSON.stringify(explicit.rows) !== JSON.stringify([{ id: 2, value: "synthetic-explicit" }])) throw new Error("restored-explicit-capability-mismatch");
      await expectDenied("insert into public.explicit_sentinel values (9,'forbidden')");
      await login.query("reset role");
      result.roleCapabilitiesVerified = true;
    } finally { await login.end(); }
    for (const object of objectOracle) {
      if (hash(await targetStore.get({ bucket, key: object.key })) !== hash(object.bytes)) throw new Error("restored-object-mismatch");
      const metadata = await targetStore.head({ bucket, key: object.key });
      if (!metadata || Object.entries(object.metadata).some(([key, value]) => metadata.metadata?.[key] !== value)) throw new Error("restored-object-metadata-mismatch");
      const stat = JSON.parse(mc(targetObjects, ["stat", "--json", `synthetic/${bucket}/${object.key}`], targetPassword).toString());
      if (stat.metadata?.["Content-Type"] !== object.contentType) throw new Error("restored-object-content-type-mismatch");
    }
    result.objectCount = mc(targetObjects, ["ls", "--recursive", "--json", `synthetic/${bucket}`], targetPassword).toString().trim().split("\n").filter(Boolean).length;
    if (result.objectCount !== 2) throw new Error("object-count-mismatch");
    await wait(async () => {
      if (execute(targetRedis, ["redis-cli", "LRANGE", "bull:synthetic:wait", "0", "-1"]).toString().trim() !== "job-1\njob-2" || execute(targetRedis, ["redis-cli", "HGET", "bull:synthetic:meta", "paused"]).toString().trim() !== "1") throw new Error("redis-value-mismatch");
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
    if (networkId) {
      try {
        const info = JSON.parse(docker(["network", "inspect", networkId]).toString())[0];
        if (info.Id !== networkId || info.Labels?.[label] !== run) throw new Error("network-ownership-mismatch");
        docker(["network", "rm", networkId]);
      } catch { cleaned = false; }
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
  if (process.argv.slice(2).join(" ") === "--synthetic-package-child") {
    try {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
      const config = JSON.parse(Buffer.concat(chunks).toString()) as RestoreChild;
      if (!/^[a-f0-9]{48}$/.test(config.password)) throw new Error("invalid-private-input");
      await restoreSyntheticPackage(config);
      console.log(JSON.stringify({ status: "synthetic-package-restored" }));
    } catch { console.log(JSON.stringify({ status: "blocked", reason: "synthetic-package-restore-failed" })); process.exitCode = 1; }
  } else if (process.argv.slice(2).join(" ") !== "--synthetic-only") {
    console.log(JSON.stringify({ status: "blocked", reason: "explicit-synthetic-only-required-no-other-arguments" }));
    process.exitCode = 2;
  } else {
    const result = await rehearseSyntheticRecovery();
    console.log(JSON.stringify(result)); process.exitCode = result.status === "passed" ? 0 : 1;
  }
}
