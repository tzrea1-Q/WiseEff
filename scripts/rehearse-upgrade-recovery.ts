import { createRecoveryExecutionAuthorization, type RecoveryCaptureRecord, type RecoveryExecutionApproval } from "../ops/self-hosted/storage/execution/authorization";
import { withHostOperationLock } from "../ops/self-hosted/scripts/parameter-catalog-upgrade/handoff";
import { openUpgradeJournal, loadUpgradeJournal } from "../ops/self-hosted/scripts/parameter-catalog-upgrade/journal";
import { mintRestoreToken } from "../ops/self-hosted/storage/recoveryPoint";
import { createControlledRecoveryTarget, restoreRecoveryPackage } from "../ops/self-hosted/storage/execution/packageRestore";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { Queue, Worker } from "bullmq";
import { isDeepStrictEqual } from "node:util";
import { createBullMqDurableQueue } from "../server/modules/jobs/bullmqQueue";
import { recordControlledRecoveryCapture } from "../ops/self-hosted/scripts/parameter-catalog-upgrade/recoveryCapture";
import { openSyntheticRecoveryAuthority } from "./synthetic-recovery-authority";
import { createHttpObjectStorageTransport } from "../server/modules/logs/s3ObjectStore";
import { createIsolatedUpgradeDocker } from "./isolated-upgrade-docker";
import { verifyRecoveryPackage, hasUnsupportedNonDumpCapabilities, RECOVERY_NON_DUMP_CAPABILITY_INVENTORY_SQL, type RecoveryRole } from "../ops/self-hosted/storage/recoveryPackage";

const images = { postgres: "postgres:16-alpine", redis: "redis:7-alpine", objects: "minio/minio:RELEASE.2024-12-18T13-15-44Z", objectClient: "minio/mc:RELEASE.2024-11-21T17-21-54Z" };
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const label = "wiseeff.synthetic-recovery-run";
const nonDumpFaults = {
  "database-acl": "grant create on database postgres to sentinel_reader",
  "database-settings": "alter database postgres set default_transaction_read_only=on",
  "other-database-acl": "grant create on database template1 to sentinel_reader",
  "tablespace-acl": "grant create on tablespace pg_default to sentinel_reader",
  "parameter-acl": "grant alter system on parameter work_mem to sentinel_reader",
  "builtin-function-acl": "revoke execute on function pg_catalog.pg_control_system() from public",
} as const;
type SyntheticFault = "stale-target-aof" | "missing-object" | "wrong-target" | "authority-volume-create-unknown" | "authority-container-create-unknown" | keyof typeof nonDumpFaults;

type RestoreChild = {
  run: string; daemonId: string; directory: string; digest: string; password: string;
  pg: string; redis: string; objects: string; objectClient: string; network: string;
  controllerJournal: string; capture: RecoveryCaptureRecord; approval: RecoveryExecutionApproval; restoreToken: string;
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
  const loaded = loadUpgradeJournal({ journalPath: config.controllerJournal, runId: config.run });
  if (!loaded.ok) throw new Error("synthetic-execution-journal-unavailable");
  await withHostOperationLock(path.dirname(config.controllerJournal), async lock => {
    const authorization = createRecoveryExecutionAuthorization({ journal: loaded.value, directory: config.directory,
      capture: config.capture, approval: config.approval, restoreToken: config.restoreToken, lock });
    const destination = createControlledRecoveryTarget({ target, authorization }, {
      async observe() {
        if (transport.daemonId !== config.daemonId) throw new Error("synthetic-daemon-drift");
        for (const id of [config.pg, config.redis, config.objects, config.objectClient]) owned(id);
        return target;
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
    async restorePostgres(backup) {
      // Structured nonprivileged role restore; secrets come only from this process stdin.
      const roles = backup.roles.map(role => `create role "${role.name}" ${role.login ? `login password '${config.password}'` : "nologin"} ${role.inherit ? "inherit" : "noinherit"} nosuperuser nobypassrls nocreatedb nocreaterole noreplication;`).join("\n");
      const members = backup.roles.flatMap(role => role.members.flatMap(member => [
        `grant "${role.name}" to "${member.name}" with admin false;`,
        `grant "${role.name}" to "${member.name}" with inherit ${member.inherit ? "true" : "false"};`,
        `grant "${role.name}" to "${member.name}" with set ${member.set ? "true" : "false"};`,
      ])).join("\n");
      exec(config.pg, ["psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], Buffer.from(`begin;\n${roles}\n${members}\ncommit;`));
      exec(config.pg, ["pg_restore", "-U", "postgres", "-d", "postgres", "--exit-on-error"], backup.postgres);
    },
    async restoreObjects(objects) {
      const targetStore = createHttpObjectStorageTransport({ endpoint: `http://${endpoint(config.objects, "9000")}`, accessKeyId: "synthetic", secretAccessKey: config.password });
      const ip = owned(config.objects).NetworkSettings.Networks[config.network].IPAddress;
      owned(config.objectClient);
      transport.command(["exec", "-e", `MC_HOST_synthetic=http://synthetic:${config.password}@${ip}:9000`, config.objectClient, "mc", "mb", "synthetic/synthetic-recovery"]);
      for (const object of objects) await targetStore.put({ bucket: "synthetic-recovery", ...object });
    },
    async restoreRedis(redis) {
      const redisDirectory = path.join(config.directory, "verified-redis-import");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(redisDirectory, { mode: 0o700 });
      for (const file of redis.files) await writeFile(path.join(redisDirectory, file.name), file.bytes, { flag: "wx", mode: 0o600 });
      owned(config.redis);
      transport.command(["cp", redisDirectory, `${config.redis}:/data/appendonlydir`]);
      // Starting the recovered queue belongs to the separate synthetic acceptance step.
    },
    });
    await restoreRecoveryPackage(config.directory, config.digest, destination);
  });
}

export function ownsRecoveryContainer(inspect: { Id: string; Config?: { Labels?: Record<string, string> } }, id: string, run: string) {
  return inspect.Id === id && inspect.Config?.Labels?.[label] === run;
}

/** No external targets, backups, image overrides, production configuration, or SQL inputs. */
export async function rehearseSyntheticRecovery(options: { fault?: SyntheticFault } = {}) {
  if (Object.keys(options).some(key => key !== "fault") || (options.fault && !["stale-target-aof", "missing-object", "wrong-target", "authority-volume-create-unknown", "authority-container-create-unknown", ...Object.keys(nonDumpFaults)].includes(options.fault))) throw new Error("unknown-synthetic-fault");
  const run = randomBytes(12).toString("hex");
  const password = randomBytes(24).toString("hex");
  const targetPassword = randomBytes(24).toString("hex");
  const ids: string[] = [];
  const containerIntents: Array<{ name: string; image: string; id?: string }> = [];
  const volumes: Array<{ Name: string; identity?: { CreatedAt: string; Mountpoint: string } }> = [];
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
    actualQueueVerified: false, queuePausedAfterRestore: false, queueRetryVerified: false, queueDeduplicationVerified: false,
  };
  const queueClosers: Array<() => Promise<unknown>> = [];
  let queueError = false;
  const onQueueError = () => { queueError = true; };
  let directory: string | undefined;
  let operationRoot: string | undefined;
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
  const create = (image: string, port: string, extra: string[], command: string[], unknownReply = false) => {
    const intent: typeof containerIntents[number] = { name: `upg-recovery-${run}-${containerIntents.length}`, image: pinnedImages.get(image)! };
    containerIntents.push(intent);
    const id = docker(["create", "--label", `${label}=${run}`, "--name", intent.name,
      "--network", network, "-p", `127.0.0.1::${port}`, ...extra, intent.image, ...command]).toString().trim();
    if (unknownReply) throw new Error("synthetic-container-create-reply-lost");
    intent.id = id;
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
    operationRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "wiseeff-synthetic-recovery-")));
    directory = path.join(operationRoot, "package");
    await mkdir(directory, { mode: 0o700 });
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
      create role recovery_queue_writer login noinherit password '${password}' nosuperuser nobypassrls nocreatedb nocreaterole;
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
      create table public.recovery_queue_effects(job_key text primary key, value integer not null);
      alter table public.recovery_queue_effects owner to sentinel_owner;
      grant select,insert on public.recovery_queue_effects to recovery_queue_writer;
    `));
    const objectOracle = [
      { key: "evidence/alpha.json", bytes: Buffer.from('{"value":null}'), contentType: "application/json", metadata: { source: "alpha", revision: "2" } },
      { key: "reports/beta.txt", bytes: Buffer.from("different payload\n"), contentType: "text/plain", metadata: { source: "beta", revision: "9" } },
    ];
    for (const object of objectOracle) await sourceStore.put({ bucket, ...object });
    const queueName = "synthetic-restored";
    const queuePrefix = `upg-${run}`;
    const queueConnection = (id: string) => ({ host: "127.0.0.1", port: Number(owned(id).NetworkSettings.Ports["6379/tcp"][0].HostPort),
      connectTimeout: 5000, maxRetriesPerRequest: null });
    const sourceQueue = new Queue<Record<string, unknown>>(queueName, { connection: queueConnection(sourceRedis), prefix: queuePrefix });
    sourceQueue.on("error", onQueueError);
    queueClosers.push(() => sourceQueue.close());
    await sourceQueue.waitUntilReady();
    const sourceAdapter = createBullMqDurableQueue({ name: queueName, queue: sourceQueue, maxAttempts: 2, retryBackoffMs: 10 });
    await sourceAdapter.pause();
    const inputs = [
      { name: "controlled-effect", idempotencyKey: "recovery:alpha", payload: { key: "alpha", value: 7 } },
      { name: "controlled-effect", idempotencyKey: "recovery:beta", payload: { key: "beta", value: 13 } },
    ];
    const enqueued = await Promise.all(inputs.map(input => sourceAdapter.enqueue(input)));
    if ((await sourceAdapter.enqueue(inputs[0])).id !== enqueued[0].id || queueError) throw new Error("source-queue-deduplication-failed");
    // Independent parent oracle is never passed to the restore process.
    const queueOracle = await Promise.all(enqueued.map(async item => {
      const job = await sourceQueue.getJob(item.id);
      if (!job) throw new Error("source-queue-job-missing");
      return { id: job.id, name: job.name, data: structuredClone(job.data), attempts: job.opts.attempts,
        backoff: structuredClone(job.opts.backoff), attemptsMade: job.attemptsMade };
    }));
    const checkSourceQueue = async () => {
      const counts = await sourceQueue.getJobCounts("paused", "active", "completed", "failed");
      if (queueError || !await sourceQueue.isPaused() || counts.paused !== 2 || counts.active !== 0 || counts.completed !== 0 || counts.failed !== 0) {
        throw new Error("source-queue-not-quiesced");
      }
    };
    await checkSourceQueue();
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
      const unchangedDatabaseSetting = options.fault !== "database-settings" || execute(sourcePg,
        ["psql", "-U", "postgres", "-Atc", "select pg_catalog.current_setting('default_transaction_read_only')"]).toString().trim() === "on";
      const unchangedRows = execute(sourcePg, ["psql", "-U", "postgres", "-Atc", "select (select count(*) from public.sentinel where id=1 and value='synthetic-value') + (select count(*) from public.explicit_sentinel where id=2 and value='synthetic-explicit')"]).toString().trim() === "2";
      const unchangedObjects = (await Promise.all(objectOracle.map(async object => Boolean(await sourceStore.head({ bucket, key: object.key })) && hash(await sourceStore.get({ bucket, key: object.key })) === hash(object.bytes)))).every(Boolean);
      await checkSourceQueue();
      const unchangedQueue = (await Promise.all(queueOracle.map(async expected => {
        const actual = await sourceQueue.getJob(expected.id!);
        return actual && isDeepStrictEqual(actual.data, expected.data);
      }))).every(Boolean);
      result.sourcePreservedBeforeCleanup = unchangedInventory && unchangedDatabaseSetting && unchangedRows && unchangedObjects && unchangedQueue;
      throw new Error("non-dump-capability-unsupported");
    }
    result.nonDumpCapabilitiesVerified = true;
    // This source has no worker: the proof covers pending jobs, not active-job draining.
    await checkSourceQueue();
    await sourceQueue.close();
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
    const objects: Array<{ key: string; bytes: Buffer; contentType: string; metadata: Record<string, string> }> = [];
    for (const entry of listing) {
      const key = entry.key as string;
      const head = await sourceStore.head({ bucket, key });
      const stat = JSON.parse(mc(sourceObjects, ["stat", "--json", `synthetic/${bucket}/${key}`]).toString());
      const contentType = stat.metadata?.["Content-Type"];
      if (typeof contentType !== "string") throw new Error("object-content-type-not-exported");
      objects.push({ key, bytes: await sourceStore.get({ bucket, key }), contentType, metadata: head?.metadata ?? {} });
    }
    const sourceIdentityConnection = new pg.Client({ connectionString: `postgres://postgres:${password}@${endpoint(sourcePg,"5432")}/postgres` });
    sourceIdentityConnection.on("error", onQueueError);
    let sourceDatabase;
    try {
      await sourceIdentityConnection.connect();
      sourceDatabase = (await sourceIdentityConnection.query(`select current_database() as "databaseName",
        (select oid::text from pg_database where datname=current_database()) as "databaseOid",
        inet_server_addr()::text as "serverAddress",inet_server_port() as "serverPort"`)).rows[0];
    } finally { await sourceIdentityConnection.end(); }
    for (const id of [sourcePg, sourceRedis, sourceObjects]) { owned(id); docker(["stop", id]); }
    result.sourceStoppedBeforeRestore = true;
    const redisExport = path.join(operationRoot, "redis-export");
    owned(sourceRedis); docker(["cp", `${sourceRedis}:/data/appendonlydir`, redisExport]);
    const redisFiles = await Promise.all((await readdir(redisExport)).sort().map(async name => ({ name, bytes: await readFile(path.join(redisExport, name)) })));
    const sourceTarget = { deploymentId: `source-${run}`, hostFingerprint: transport.daemonId,
      postgresIdentity: sourcePg, objectStoreIdentity: sourceObjects, redisIdentity: sourceRedis };
    const openedJournal = openUpgradeJournal({ journalPath: path.join(operationRoot, "synthetic-controller.json"), runId: run });
    if (!openedJournal.ok) throw new Error("synthetic-controller-journal-unavailable");
    const stoppedObservation = () => [sourcePg, sourceRedis, sourceObjects].map(id => {
      const info = owned(id);
      if (info.State.Running || info.State.Restarting || info.State.Status !== "exited") throw new Error("source-store-not-stopped");
      return { id: info.Id, image: info.Image, started: info.State.StartedAt, finished: info.State.FinishedAt };
    });
    const stopped = stoppedObservation();
    result.reason = "controlled-capture-failed";
    const receipt = { runId: run, target: sourceTarget, digest: hash(Buffer.from(JSON.stringify(stopped))),
      observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() };
    const verifyStopped = async () => {
      if (queueError || transport.daemonId !== sourceTarget.hostFingerprint || !isDeepStrictEqual(stoppedObservation(), stopped)) throw new Error("source-stop-boundary-drift");
    };
    const capture = await withHostOperationLock(operationRoot, lock => recordControlledRecoveryCapture({
      journal: openedJournal.value, attemptId: `capture-${run}`, directory: directory!, operationRoot: operationRoot!, target: sourceTarget, lock,
    }, {
      async observe() { await verifyStopped(); return sourceTarget; },
      async open() {
        await verifyStopped();
        // These are the actual exports made after the only producer closed.
        // Stopped container identities remain held throughout package capture.
        return { async postgres() { await verifyStopped(); return { postgres: dump, roles: roleManifest }; },
          async objects() { await verifyStopped(); return objects; },
          async redis() { await verifyStopped(); return { appendonly: true as const, files: redisFiles }; },
          async close() { await verifyStopped(); } };
      },
    }, {
      async acquire(input) { await verifyStopped(); if (input.runId !== run || !isDeepStrictEqual(input.target, sourceTarget)) throw new Error("source-boundary-target-mismatch"); return receipt; },
      async verify(current) { if (!isDeepStrictEqual(current,receipt)) throw new Error("source-boundary-receipt-mismatch"); await verifyStopped(); },
    }));
    result.manifestDigest = capture.packageDigest;
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
    const authVolumeName = `upg-recovery-${run}-authority`;
    // Register the exact create intent before Docker can commit with a lost reply.
    // Only this nonce name plus its run label may be reconciled in cleanup.
    const volumeIntent: typeof volumes[number] = { Name: authVolumeName };
    volumes.push(volumeIntent);
    result.reason = "authority-volume-create-outcome-unknown";
    docker(["volume", "create", "--label", `${label}=${run}`, authVolumeName]);
    // Real volume exists, but the caller has not consumed a successful response.
    if (options.fault === "authority-volume-create-unknown") throw new Error("synthetic-create-reply-lost");
    const authVolume = JSON.parse(docker(["volume", "inspect", authVolumeName]).toString())[0];
    if (authVolume.Name !== authVolumeName || authVolume.Labels?.[label] !== run || authVolume.Driver !== "local"
      || Object.keys(authVolume.Options ?? {}).length !== 0 || !authVolume.CreatedAt || !authVolume.Mountpoint) throw new Error("authority-volume-ownership-mismatch");
    volumeIntent.identity = { CreatedAt: authVolume.CreatedAt, Mountpoint: authVolume.Mountpoint };
    result.reason = "authority-container-create-outcome-unknown";
    const authPg = create(images.postgres, "5432", ["-e", `POSTGRES_PASSWORD=${targetPassword}`, "-v", `${authVolumeName}:/var/lib/postgresql/data`], [], options.fault === "authority-container-create-unknown");
    start(authPg);
    await wait(async () => execute(authPg, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres"]));
    const privateDirectory = path.join(operationRoot, "authority");
    await mkdir(privateDirectory, { mode: 0o700 });
    const restoreToken = mintRestoreToken(run, capture.recoveryPointDigest);
    result.reason = "synthetic-restore-approval-failed";
    const approval = await withHostOperationLock(operationRoot, async lock => {
      const authority = await openSyntheticRecoveryAuthority({ runId: run, operationRoot: operationRoot!, privateDirectory,
        journal: openedJournal.value, lock, capture, restoreToken, sourceDatabase,
        target: { deploymentId: `restore-${run}`, hostFingerprint: transport.daemonId, postgresIdentity: targetPg, objectStoreIdentity: targetObjects, redisIdentity: targetRedis },
        auth: { expectedDaemonId: transport.daemonId, containerId: authPg, imageId: pinnedImages.get(images.postgres)!, networkId,
          sourceContainerId: sourcePg, targetContainerId: targetPg, registeredContainerIds: [...ids], adminUrl: `postgres://postgres:${targetPassword}@${endpoint(authPg,"5432")}/postgres` } });
      try { return authority.approval; } finally { await authority.close(); }
    });
    result.reason = "separate-package-restore-failed";
    if (options.fault === "missing-object") await rm(path.join(directory, "payload-1.bin"));
    const child = spawnSync(process.execPath, ["--import", "tsx", new URL(import.meta.url).pathname, "--synthetic-package-child"], {
      input: JSON.stringify({ controllerJournal: openedJournal.value.journalPath, capture, approval, restoreToken: mintRestoreToken(run, capture.recoveryPointDigest), run: options.fault === "wrong-target" ? "0".repeat(24) : run, daemonId: transport.daemonId, directory, digest: result.manifestDigest, password: targetPassword, pg: targetPg, redis: targetRedis, objects: targetObjects, objectClient, network } satisfies RestoreChild),
      encoding: "utf8", timeout: 60000, env: { PATH: process.env.PATH, HOME: os.homedir() },
    });
    if (child.status !== 0) throw new Error("separate-package-restore-failed");
    result.separateRestoreProcess = true;
    result.restoreExecuted = true;
    result.reason = "restored-verification-failed";
    start(targetRedis);
    await wait(async () => execute(targetRedis, ["redis-cli", "PING"]));
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
    const targetQueue = new Queue<Record<string, unknown>>(queueName, { connection: queueConnection(targetRedis), prefix: queuePrefix });
    targetQueue.on("error", onQueueError);
    queueClosers.push(() => targetQueue.close());
    await targetQueue.waitUntilReady();
    if (queueError || !await targetQueue.isPaused() || await targetQueue.getActiveCount() !== 0) throw new Error("restored-queue-not-paused");
    for (const expected of queueOracle) {
      const job = await targetQueue.getJob(expected.id!);
      if (!job || !isDeepStrictEqual({ id: job.id, name: job.name, data: job.data, attempts: job.opts.attempts,
        backoff: job.opts.backoff, attemptsMade: job.attemptsMade }, expected)) throw new Error("restored-queue-job-mismatch");
    }
    if (await targetQueue.getJobCountByTypes("paused", "active", "completed", "failed", "delayed") !== 2) throw new Error("restored-queue-count-mismatch");
    result.queuePausedAfterRestore = true;
    const targetAdapter = createBullMqDurableQueue({ name: queueName, queue: targetQueue, maxAttempts: 2, retryBackoffMs: 10 });
    for (const [index, input] of inputs.entries()) {
      if ((await targetAdapter.enqueue(input)).id !== enqueued[index].id) throw new Error("restored-queue-deduplication-failed");
    }
    // Separate, explicitly synthetic acceptance. The restore child never resumes a queue.
    const effects = new pg.Client({ connectionString: `postgres://recovery_queue_writer:${targetPassword}@${endpoint(targetPg, "5432")}/postgres` });
    effects.on("error", onQueueError);
    let worker: Worker | undefined;
    let running: Promise<void> | undefined;
    const activeEffects = new Set<Promise<unknown>>();
    let stoppingEffects = false;
    try {
      await effects.connect();
      const identity = (await effects.query("select session_user as name,rolsuper or rolbypassrls or rolcreatedb or rolcreaterole as privileged from pg_roles where rolname=session_user")).rows[0];
      if (identity?.name !== "recovery_queue_writer" || identity.privileged !== false) throw new Error("queue-effect-login-invalid");
      worker = new Worker(queueName, async job => {
        if (stoppingEffects) throw new Error("controlled-worker-stopping");
        if (!inputs.some(input => isDeepStrictEqual(input.payload, { key: job.data.key, value: job.data.value }))) throw new Error("controlled-job-invalid");
        // A failure after the committed effect exercises at-least-once replay.
        // The actual database uniqueness boundary, not completed-job counts, deduplicates it.
        const pending = effects.query("insert into public.recovery_queue_effects(job_key,value) values($1,$2) on conflict(job_key) do nothing", [job.data.key, job.data.value]);
        activeEffects.add(pending);
        try { await pending; } finally { activeEffects.delete(pending); }
        if (job.data.key === "alpha" && job.attemptsMade === 0) throw new Error("controlled-retry-after-effect");
        return "controlled-effect-recorded";
      }, { connection: queueConnection(targetRedis), prefix: queuePrefix, autorun: false, concurrency: 1 });
      worker.on("error", onQueueError);
      await worker.waitUntilReady();
      await targetAdapter.resume();
      running = worker.run().catch(() => { queueError = true; });
      await wait(async () => {
        if (queueError || await targetQueue.getCompletedCount() !== 2) throw new Error("controlled-queue-incomplete");
      });
      const jobs = await Promise.all(enqueued.map(item => targetQueue.getJob(item.id)));
      if (jobs[0]?.attemptsMade !== 2 || jobs[1]?.attemptsMade !== 1 || queueError) throw new Error("controlled-retry-mismatch");
      const rows = (await effects.query("select job_key,value from public.recovery_queue_effects order by job_key")).rows;
      if (!isDeepStrictEqual(rows, [{ job_key: "alpha", value: 7 }, { job_key: "beta", value: 13 }])) throw new Error("controlled-effect-mismatch");
      result.queueRetryVerified = true;
      result.queueDeduplicationVerified = true;
      result.actualQueueVerified = true;
    } finally {
      // Close/drain the worker before closing the database used by late callbacks.
      stoppingEffects = true;
      const closed = await Promise.allSettled([Promise.resolve().then(() => worker?.close())]);
      if (closed[0].status === "rejected") {
        queueError = true;
        await Promise.resolve().then(() => worker?.disconnect()).catch(() => { queueError = true; });
      }
      await running;
      await Promise.allSettled([...activeEffects]);
      await effects.end();
    }
    if (queueError) throw new Error("controlled-queue-lifecycle-failed");
    result.businessVerified = true; // Only the explicitly labeled synthetic sentinel behavior.
    result.status = "passed"; result.reason = "synthetic-package-and-controlled-queue-restored";
  } catch {
    result.status = "blocked"; // Keep the static stage, never driver output or private material.
  } finally {
    cleaning = true;
    let cleaned = true;
    const queueCleanup = await Promise.allSettled(queueClosers.map(close => Promise.resolve().then(close)));
    if (queueCleanup.some(outcome => outcome.status === "rejected")) cleaned = false;
    for (const intent of [...containerIntents].reverse()) {
      try {
        const info = JSON.parse(docker(["inspect", intent.id ?? intent.name]).toString())[0];
        if (!ownsRecoveryContainer(info, info.Id, run) || info.Name !== `/${intent.name}` || info.Image !== intent.image
          || (intent.id && info.Id !== intent.id)) throw new Error("container-create-identity-mismatch");
        owned(info.Id); docker(["rm", "-f", "-v", info.Id]);
      } catch { cleaned = false; }
    }
    for (const expected of volumes) {
      try {
        const current = JSON.parse(docker(["volume", "inspect", expected.Name]).toString())[0];
        if (current.Labels?.[label] !== run || current.Driver !== "local" || Object.keys(current.Options ?? {}).length !== 0
          || current.Name !== expected.Name || !current.CreatedAt || !current.Mountpoint
          || (expected.identity && !isDeepStrictEqual({ CreatedAt: current.CreatedAt, Mountpoint: current.Mountpoint }, expected.identity))
          || docker(["ps", "-aq", "--filter", `volume=${expected.Name}`]).toString().trim()) throw new Error("volume-ownership-mismatch");
        docker(["volume", "rm", expected.Name]);
      } catch { cleaned = false; }
    }
    if (networkId) {
      try {
        const info = JSON.parse(docker(["network", "inspect", networkId]).toString())[0];
        if (info.Id !== networkId || info.Labels?.[label] !== run) throw new Error("network-ownership-mismatch");
        docker(["network", "rm", networkId]);
      } catch { cleaned = false; }
    }
    // Capture/approval/restore may have committed even when the caller failed.
    // Keep the private journal, package and assignment for explicit inspection;
    // Docker cleanup is not permission to erase the only recovery evidence.
    result.backupRetained = result.backupExists;
    result.cleanupVerified = cleaned;
    if (!cleaned || queueError) {
      if (result.status === "passed") result.reason = !cleaned ? "owned-resource-cleanup-failed" : "queue-connection-failed";
      result.status = "blocked";
    }
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
