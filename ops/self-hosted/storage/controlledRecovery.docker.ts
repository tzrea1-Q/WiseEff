import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdtemp, open, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { createIsolatedUpgradeDocker } from "../../../scripts/isolated-upgrade-docker";
import { createHttpObjectStorageTransport } from "../../../server/modules/logs/s3ObjectStore";
import { hasUnsupportedNonDumpCapabilities, RECOVERY_NON_DUMP_CAPABILITY_INVENTORY_SQL, RECOVERY_V3_NON_DUMP_CAPABILITY_INVENTORY_SQL, type RecoveryBootstrapIdentity, type RecoveryPackageInput, type RecoveryRole } from "./recoveryPackage";
import { recoveryRefuse, type ControlledRecoverySource, type ControlledRecoveryTarget } from "./controlledRecovery";

const OWNER_LABEL = "wiseeff.controlled-recovery-run";
const LIMIT = 256 * 1024 * 1024;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Container = { id: string; imageId: string; mounts: readonly { name: string; destination: string; createdAt: string }[] };
type ContainerObservation = {
  Id: string; Image: string; Config: { Labels: Record<string, string>; Cmd: string[] };
  Mounts: { Type: string; Name?: string; Destination: string }[];
  HostConfig: { NetworkMode: string };
  NetworkSettings: { Networks: Record<string, { NetworkID: string; IPAddress: string }>; Ports: Record<string, { HostIp: string; HostPort: string }[] | null> };
  State: { Running: boolean; Restarting: boolean; OOMKilled: boolean; ExitCode: number; Error: string; StartedAt: string; FinishedAt: string };
};
type VolumeObservation = { Name: string; CreatedAt: string; Labels: Record<string, string>; Driver: string; Options: Record<string, string> | null };
export type DockerRecoveryResources = {
  profile: "owned-pg16-minio2024-redis7-v1" | "owned-pg16-minio2024-redis7-bootstrap-v3";
  bootstrap?: RecoveryBootstrapIdentity;
  runId: string; deploymentId: string; daemonId: string; networkId: string;
  postgres: Container; objects: Container; redis: Container; objectClient: Container;
  writers: readonly (Container & { service: "api" | "worker" | "web" })[];
  database: string; bucket: string;
};
/** Private closure only: no secret is an argv, receipt, manifest or error field. */
export type DockerRecoverySecrets = {
  postgresPassword: string; objectAccessKey: string; objectSecretKey: string;
  rolePasswords?: Readonly<Record<string, string>>;
};

const ROLE_PROFILE_SQL = `select json_build_object(
 'unsupportedRoles',(select count(*) from pg_roles where rolname !~ '^pg_' and rolname<>'postgres'
   and (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication or rolconnlimit<>-1 or rolvaliduntil is not null or rolconfig is not null)),
 'unsupportedMembership',(select count(*) from pg_auth_members a join pg_roles member on member.oid=a.member
   join pg_roles granted on granted.oid=a.roleid join pg_roles grantor on grantor.oid=a.grantor
   where (member.rolname !~ '^pg_' and member.rolname<>'postgres' or granted.rolname !~ '^pg_' and granted.rolname<>'postgres')
   and (a.admin_option or grantor.rolname<>'postgres' or member.rolname ~ '^pg_' or member.rolname='postgres' or granted.rolname ~ '^pg_' or granted.rolname='postgres')),
 'unsupportedSettings',(select count(*) from pg_db_role_setting s join pg_roles r on r.oid=s.setrole where r.rolname !~ '^pg_' and r.rolname<>'postgres'),
 'roles',(select coalesce(json_agg(json_build_object('name',rolname,'login',rolcanlogin,'inherit',rolinherit,'members',
   (select coalesce(json_agg(json_build_object('name',member.rolname,'inherit',am.inherit_option,'set',am.set_option) order by member.rolname),'[]')
    from pg_auth_members am join pg_roles member on member.oid=am.member where am.roleid=r.oid)) order by rolname),'[]')
   from pg_roles r where rolname !~ '^pg_' and rolname<>'postgres')) as value`;
const tablesSql = "select format('%I.%I',n.nspname,c.relname) as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast' order by 1";
// This is an empty vanilla PG16 target profile, not permission to overwrite a
// partially restored database. Include every relation kind and standalone user
// object: a table-only check misses executable functions and event triggers.
// 16384 is PostgreSQL's FirstNormalObjectId; checking both namespace and OID also
// rejects user objects placed inside an otherwise built-in namespace.
const EMPTY_TARGET_SQL = `select json_build_object(
 'relations',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where c.oid>=16384 or n.nspname not in ('pg_catalog','information_schema','pg_toast')),
 'routines',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where p.oid>=16384 or n.nspname not in ('pg_catalog','information_schema')),
 'types',(select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace
   where t.oid>=16384 or n.nspname not in ('pg_catalog','information_schema','pg_toast')),
 'schemas',(select count(*) from pg_namespace where nspname not in ('pg_catalog','information_schema','pg_toast','public')),
 'extensions',(select count(*) from pg_extension where extname<>'plpgsql'),
 'missingPlpgsql',(select case when count(*)=1 then 0 else 1 end from pg_extension where extname='plpgsql'),
 'eventTriggers',(select count(*) from pg_event_trigger),
 'largeObjects',(select count(*) from pg_largeobject_metadata),
 'defaultAcls',(select count(*) from pg_default_acl),
 'foreignData',(select count(*) from pg_foreign_data_wrapper)+(select count(*) from pg_foreign_server)+(select count(*) from pg_user_mapping),
 'replicationObjects',(select count(*) from pg_publication)+(select count(*) from pg_subscription where subdbid=(select oid from pg_database where datname=current_database())),
 'casts',(select count(*) from pg_cast where oid>=16384),
 'collations',(select count(*) from pg_collation where oid>=16384),
 'languages',(select count(*) from pg_language where oid>=16384 or lanname not in ('internal','c','sql','plpgsql')),
 'operators',(select count(*) from pg_operator where oid>=16384)+(select count(*) from pg_opclass where oid>=16384)+(select count(*) from pg_opfamily where oid>=16384),
 'accessMethods',(select count(*) from pg_am where oid>=16384),
 'conversions',(select count(*) from pg_conversion where oid>=16384),
 'transforms',(select count(*) from pg_transform),
 'textSearch',(select count(*) from pg_ts_config where oid>=16384)+(select count(*) from pg_ts_dict where oid>=16384)
   +(select count(*) from pg_ts_parser where oid>=16384)+(select count(*) from pg_ts_template where oid>=16384),
 'roles',(select count(*) from pg_roles where rolname !~ '^pg_' and rolname<>'postgres')
) as inventory`;
const quote = (value: string) => pg.escapeLiteral(value);
const copyInputs = (resources: DockerRecoveryResources, secrets: DockerRecoverySecrets) => ({
  resources: JSON.parse(JSON.stringify(resources)) as DockerRecoveryResources,
  secrets: JSON.parse(JSON.stringify(secrets)) as DockerRecoverySecrets,
});

/** Deliberately limited to the existing owned Docker bridge rehearsal profile:
 * IP masquerade disabled, loopback published ports, exact members and volumes.
 * This is not proof of complete application egress isolation or a production
 * host selector. It never creates/stops/removes a resource. */
function access(resources: DockerRecoveryResources, secrets: DockerRecoverySecrets, sourceMode: boolean) {
  const v3 = resources.profile === "owned-pg16-minio2024-redis7-bootstrap-v3";
  if ((!v3 && resources.profile !== "owned-pg16-minio2024-redis7-v1") || !/^[a-f0-9]{24}$/.test(resources.runId)
    || !/^[a-z][a-z0-9_]{0,62}$/.test(resources.database) || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(resources.bucket)
    || resources.writers.map(w => w.service).sort().join(",") !== "api,web,worker"
    || ![secrets.postgresPassword, secrets.objectAccessKey, secrets.objectSecretKey].every(s => typeof s === "string" && s.length > 0 && !s.includes("\0"))) recoveryRefuse("docker-profile-unsupported");
  const bootstrap = resources.bootstrap;
  if (v3 ? (!bootstrap || Object.keys(bootstrap).sort().join(",") !== "postgresMajor,roleName,roleOid"
    || !/^[a-z][a-z0-9_]{0,62}$/.test(bootstrap.roleName) || bootstrap.roleName.startsWith("pg_") || bootstrap.roleOid !== "10" || bootstrap.postgresMajor !== 16)
    : bootstrap !== undefined) recoveryRefuse("bootstrap-profile-unsupported");
  const adminName = bootstrap?.roleName ?? "postgres";
  const assertBootstrapIdentity = async (client: pg.Client | pg.PoolClient) => {
    if (!v3) return;
    // Verify the pre-existing initdb identity. No CREATE/ALTER ROLE or owner
    // translation is authorized by this observation or by a package receipt.
    const row = (await client.query(`select oid::text as oid,rolname as name from pg_roles
      where oid=10 and rolname=session_user and rolname=current_user and rolsuper and rolbypassrls
      and rolcreatedb and rolcreaterole and rolcanlogin and rolreplication and rolinherit
      and rolconnlimit=-1 and rolvaliduntil is null and rolconfig is null
      and current_setting('server_version_num')::integer between 160000 and 169999
      and not exists(select 1 from pg_auth_members where member=10 or roleid=10)
      and not exists(select 1 from pg_db_role_setting where setrole=10)`)).rows[0];
    if (row?.oid !== bootstrap?.roleOid || row?.name !== bootstrap?.roleName) recoveryRefuse("bootstrap-identity-mismatch");
  };
  const inventory = async (client: pg.Client | pg.PoolClient) => {
    await assertBootstrapIdentity(client);
    const result = await client.query(v3 ? RECOVERY_V3_NON_DUMP_CAPABILITY_INVENTORY_SQL : RECOVERY_NON_DUMP_CAPABILITY_INVENTORY_SQL,
      v3 ? [bootstrap!.roleOid, bootstrap!.roleName] : []);
    return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
  };
  const docker = createIsolatedUpgradeDocker();
  if (docker.daemonId !== resources.daemonId) recoveryRefuse("daemon-mismatch");
  let lockClient: pg.PoolClient | undefined;
  let lockPid: number | undefined;
  const all = [resources.postgres, resources.objects, resources.redis, resources.objectClient, ...resources.writers];
  if (new Set(all.map(c => c.id)).size !== all.length || all.some(c => !/^[a-f0-9]{64}$/.test(c.id) || !/^sha256:[a-f0-9]{64}$/.test(c.imageId))) recoveryRefuse("container-alias");
  const volumeNames = all.flatMap(c => c.mounts.map(m => m.name));
  if (new Set(volumeNames).size !== volumeNames.length) recoveryRefuse("volume-alias");
  const imageProfile = [[resources.postgres, "postgres:16-alpine"], [resources.redis, "redis:7-alpine"],
    [resources.objects, "minio/minio:RELEASE.2024-12-18T13-15-44Z"], [resources.objectClient, "minio/mc:RELEASE.2024-11-21T17-21-54Z"]] as const;
  const registered = (container: Container) => {
    const fixed = all.find(c => c.id === container.id);
    if (!fixed || digest(fixed) !== digest(container)) recoveryRefuse("unregistered-container");
    return fixed;
  };
  // A check owns one observation, never a cache across operations. Every Docker
  // command still uses the existing transport's freshly verified daemon ID.
  const check = () => {
    const network = JSON.parse(docker.command(["network", "inspect", resources.networkId]).toString())[0];
    if (network.Id !== resources.networkId || network.Driver !== "bridge" || network.Internal !== false
      || network.Options?.["com.docker.network.bridge.enable_ip_masquerade"] !== "false" || network.Labels?.[OWNER_LABEL] !== resources.runId
      || Object.keys(network.Containers ?? {}).some(id => !all.some(c => c.id === id))) recoveryRefuse("network-not-isolated");
    // Inspect only registered containers, never unrelated containers' Env/secrets.
    const observed = JSON.parse(docker.command(["inspect", ...all.map(c => c.id)]).toString()) as ContainerObservation[];
    const volumes = volumeNames.length ? JSON.parse(docker.command(["volume", "inspect", ...volumeNames]).toString()) as VolumeObservation[] : [];
    const images = JSON.parse(docker.command(["image", "inspect", ...imageProfile.map(([, image]) => image)]).toString()) as { Id: string }[];
    if (observed.length !== all.length || new Set(observed.map(i => i.Id)).size !== all.length
      || volumes.length !== volumeNames.length || images.length !== imageProfile.length) recoveryRefuse("docker-inventory-incomplete");
    const infos = all.map(container => {
      const info = observed.find(i => i.Id === container.id);
      if (!info || info.Config?.Labels?.[OWNER_LABEL] !== resources.runId) recoveryRefuse("container-ownership-drift");
      if (info.Image !== container.imageId) recoveryRefuse("container-image-drift");
      const mounts = info.Mounts;
      if (mounts.some(m => m.Type !== "volume") || mounts.length !== container.mounts.length) recoveryRefuse("container-mount-unsupported");
      for (const mount of container.mounts) {
        const actual = mounts.find(m => m.Name === mount.name && m.Destination === mount.destination);
        const volume = volumes.find(v => v.Name === mount.name);
        if (!actual || !volume || volume.CreatedAt !== mount.createdAt || volume.Labels?.[OWNER_LABEL] !== resources.runId
          || volume.Driver !== "local" || Object.keys(volume.Options ?? {}).length) recoveryRefuse("volume-identity-drift");
        const consumers = docker.command(["ps", "-a", "--no-trunc", "--filter", `volume=${mount.name}`, "--format", "{{.ID}}"])
          .toString().trim().split("\n").filter(Boolean);
        if (consumers.length !== 1 || consumers[0] !== container.id) recoveryRefuse("volume-shared-with-other-container");
      }
      const networks = Object.values(info.NetworkSettings.Networks);
      // A never-started restore container has no active endpoint yet. Its actual
      // Docker HostConfig must still pin the already-inspected network ID.
      if (networks.length !== 1 || (networks[0].NetworkID !== resources.networkId
        && (info.State.Running || networks[0].NetworkID || info.HostConfig.NetworkMode !== resources.networkId))) recoveryRefuse("container-network-drift");
      for (const bindings of Object.values(info.NetworkSettings.Ports)) {
        if (bindings?.some(b => b.HostIp !== "127.0.0.1")) recoveryRefuse("published-port-not-private");
      }
      return info;
    });
    for (const writer of resources.writers) {
      const info = infos.find(i => i.Id === writer.id)!;
      if (info.State.Running || info.State.Restarting) recoveryRefuse("writer-still-running");
    }
    for (const [index, [container]] of imageProfile.entries()) {
      // A fixed image ID and the inspected trusted local tag must identify the same bytes.
      const expected = images[index];
      if (expected.Id !== container.imageId) recoveryRefuse("image-profile-unsupported");
    }
    const redis = infos[2];
    const command = redis.Config.Cmd as string[];
    if (command.length !== 5 || command[0] !== "redis-server" || command[1] !== "--appendonly" || command[2] !== "yes"
      || command[3] !== "--appendfsync" || !["always", "everysec"].includes(command[4])) recoveryRefuse("redis-config-unsupported");
    if (redis.State.Running || redis.State.Restarting || redis.State.OOMKilled || redis.State.ExitCode !== 0 || redis.State.Error
      || (sourceMode && (!Date.parse(redis.State.StartedAt) || Date.parse(redis.State.FinishedAt) <= Date.parse(redis.State.StartedAt)))) recoveryRefuse("redis-not-cleanly-stopped");
    return infos;
  };
  type Observation = ReturnType<typeof check>;
  const endpoint = (observation: Observation, container: Container, port: number) => {
    registered(container);
    const rows = observation.find(i => i.Id === container.id)!.NetworkSettings.Ports[`${port}/tcp`];
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].HostIp !== "127.0.0.1" || !/^[0-9]+$/.test(rows[0].HostPort)) recoveryRefuse("store-endpoint-unavailable");
    return { host: "127.0.0.1", port: Number(rows[0].HostPort) };
  };
  const execObserved = (observation: Observation, container: Container, args: string[], input?: Buffer) => {
    const fixed = registered(container);
    if (!observation.some(i => i.Id === fixed.id && i.Image === fixed.imageId)) recoveryRefuse("container-image-drift");
    return docker.command(["exec", "-i", fixed.id, ...args], input);
  };
  const exec = (container: Container, args: string[], input?: Buffer) => { registered(container); return execObserved(check(), container, args, input); };
  const db = async <T>(body: (client: pg.Client) => Promise<T>, observation = check()) => {
    const client = new pg.Client({ ...endpoint(observation, resources.postgres, 5432), user: adminName, password: secrets.postgresPassword, database: resources.database,
      application_name: "controlled-recovery", connectionTimeoutMillis: 5000, query_timeout: 10000 });
    try { await client.connect(); await assertBootstrapIdentity(client); return await body(client); } finally { await client.end(); }
  };
  const mc = (args: string[], observation = check()) => {
    const networks = Object.values(observation.find(i => i.Id === resources.objects.id)!.NetworkSettings.Networks) as { IPAddress: string }[];
    const config = { version: "10", aliases: { recovery: { url: `http://${networks[0].IPAddress}:9000`, accessKey: secrets.objectAccessKey, secretKey: secrets.objectSecretKey, api: "S3v4", path: "auto" } } };
    // Secret JSON is stdin and a 0600 temporary file inside the owned client,
    // never Docker -e/argv. Only this ephemeral secret directory is removed.
    const script = 'umask 077; d=$(mktemp -d); trap \'rm -rf "$d"\' EXIT HUP INT TERM; cat > "$d/config.json"; mc --config-dir "$d" "$@"';
    return execObserved(observation, resources.objectClient, ["sh", "-c", script, "controlled-mc", ...args], Buffer.from(JSON.stringify(config)));
  };
  const jsonLines = (bytes: Buffer) => bytes.toString().trim() ? bytes.toString().trim().split("\n").map(line => JSON.parse(line)) : [];
  const list = () => {
    const rows = jsonLines(mc(["ls", "--recursive", "--json", `recovery/${resources.bucket}`]));
    if (rows.length > 10000 || rows.some(row => row.status !== "success" || row.type !== "file" || typeof row.key !== "string" || !Number.isSafeInteger(row.size) || row.size < 0)
      || new Set(rows.map(row => row.key)).size !== rows.length || rows.reduce((n, row) => n + row.size, 0) > LIMIT) recoveryRefuse("object-list-unsupported");
    return rows.sort((a, b) => a.key.localeCompare(b.key));
  };
  const store = () => {
    const target = endpoint(check(), resources.objects, 9000);
    return createHttpObjectStorageTransport({ endpoint: `http://${target.host}:${target.port}`, accessKeyId: secrets.objectAccessKey, secretAccessKey: secrets.objectSecretKey });
  };
  const assertNoOtherSessions = async (client: pg.Client | pg.PoolClient) => {
    const result = await client.query("select count(*)::int as n from pg_stat_activity where backend_type='client backend' and pid<>pg_backend_pid() and ($1::integer is null or pid<>$1)", [lockPid ?? null]);
    if (result.rows[0]?.n !== 0) recoveryRefuse("database-writer-boundary-unavailable");
  };
  const observe = async () => {
    const infos = check();
    const postgres = await db(async client => {
      await assertNoOtherSessions(client);
      const row = (await client.query("select system_identifier::text as system, (select oid::text from pg_database where datname=current_database()) as database from pg_control_system()" )).rows[0];
      if (!row?.system || !row.database) recoveryRefuse("database-identity-unavailable");
      return row;
    }, infos);
    const info = JSON.parse(mc(["admin", "info", "--json", "recovery"], infos).toString());
    if (info.status !== "success" || typeof info.info?.deploymentID !== "string" || !info.info.deploymentID) recoveryRefuse("object-deployment-identity-unavailable");
    const version = JSON.parse(mc(["version", "info", "--json", `recovery/${resources.bucket}`], infos).toString());
    // This pinned mc version emits a versioning object whose status is empty
    // for a never-versioned bucket (cmd/version-info.go), not its human label.
    if (version.status !== "success" || version.versioning?.status !== "" || version.versioning.MFADelete
      || version.versioning.ExcludeFolders || version.versioning.ExcludedPrefixes?.length) recoveryRefuse("object-versioning-unsupported");
    const buckets = jsonLines(mc(["ls", "--json", "recovery"], infos));
    if (buckets.length !== 1 || buckets[0].status !== "success" || buckets[0].key !== `${resources.bucket}/`
      || !Number.isFinite(Date.parse(buckets[0].lastModified))) recoveryRefuse("bucket-inventory-unsupported");
    return { deploymentId: resources.deploymentId, hostFingerprint: docker.daemonId,
      postgresIdentity: digest({ container: resources.postgres, ...postgres, ...(bootstrap ? { bootstrap } : {}) }),
      objectStoreIdentity: digest({ container: resources.objects, deployment: info.info.deploymentID, bucket: resources.bucket, createdAt: buckets[0].lastModified, versioning: version.versioning }),
      redisIdentity: digest({ container: resources.redis, command: infos[2].Config.Cmd, startedAt: infos[2].State.StartedAt, finishedAt: infos[2].State.FinishedAt }) };
  };
  const redisFiles = async () => {
    check();
    const directory = await mkdtemp(path.join(os.tmpdir(), "controlled-aof-"));
    try {
      docker.command(["cp", `${resources.redis.id}:/data/appendonlydir/.`, directory]);
      const names = (await readdir(directory)).sort();
      if (names.length > 1000) recoveryRefuse("aof-size-limit");
      let total = 0;
      const files = [];
      for (const name of names) {
        if (!/^appendonly\.aof(?:\.manifest|\.[0-9]+\.(?:base\.rdb|base\.aof|incr\.aof))$/.test(name)) recoveryRefuse("aof-file-unsupported");
        const file = await open(path.join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const stat = await file.stat(); total += stat.size;
          if (!stat.isFile() || stat.nlink !== 1 || total > LIMIT) recoveryRefuse("aof-size-limit");
          const bytes = await file.readFile();
          if (bytes.length !== stat.size) recoveryRefuse("aof-file-changed");
          files.push({ name, bytes });
        } finally { await file.close(); }
      }
      check(); return { appendonly: true as const, files };
    } finally { await rm(directory, { recursive: true, force: true }); }
  };
  return { check, db, exec, mc, list, store, observe, redisFiles, docker, assertNoOtherSessions, inventory, adminName,
    setLock(client: pg.PoolClient | undefined, pid?: number) { lockClient = client; lockPid = pid; },
    async openSource() {
      if (lockClient) recoveryRefuse("source-already-open");
      const observation = check();
      const pool = new pg.Pool({ ...endpoint(observation, resources.postgres, 5432), user: adminName, password: secrets.postgresPassword, database: resources.database, max: 1, connectionTimeoutMillis: 5000, query_timeout: 10000 });
      const client = await pool.connect();
      try {
        await assertBootstrapIdentity(client);
        await assertNoOtherSessions(client);
        await client.query("begin isolation level repeatable read");
        const names = (await client.query(tablesSql)).rows.map(row => row.name as string);
        if (!names.length || names.length > 10000) recoveryRefuse("source-table-inventory-unsupported");
        await client.query(`lock table ${names.join(", ")} in share mode nowait`);
        const pid = (await client.query("select pg_backend_pid() as pid")).rows[0].pid as number;
        this.setLock(client, pid);
        const snapshot = (await client.query("select pg_export_snapshot() as snapshot")).rows[0].snapshot as string;
        return { client, snapshot, async close() {
          let destroy = false;
          try { await client.query("rollback"); } catch { destroy = true; }
          client.release(destroy); await pool.end();
          lockClient = undefined; lockPid = undefined;
          if (destroy) recoveryRefuse("source-close-unknown");
        } };
      } catch {
        client.release(true); await pool.end(); recoveryRefuse("source-lock-unavailable");
      }
    },
  };
}

export function createDockerRecoverySource(resources: DockerRecoveryResources, secrets: DockerRecoverySecrets): ControlledRecoverySource {
  ({ resources, secrets } = copyInputs(resources, secrets));
  const io = access(resources, secrets, true);
  return { observe: io.observe, async open() {
    const locked = await io.openSource();
    return {
      async postgres() {
        io.check();
        if (hasUnsupportedNonDumpCapabilities(await io.inventory(locked.client))) recoveryRefuse("non-dump-capability-unsupported");
        const profile = (await locked.client.query(resources.bootstrap ? ROLE_PROFILE_SQL.replaceAll("'postgres'", "$1::text") : ROLE_PROFILE_SQL,
          resources.bootstrap ? [io.adminName] : [])).rows[0].value;
        if (profile.unsupportedRoles !== 0 || profile.unsupportedMembership !== 0 || profile.unsupportedSettings !== 0) recoveryRefuse("role-capability-unsupported");
        const postgres = io.exec(resources.postgres, ["pg_dump", "-U", io.adminName, "-d", resources.database, "--format=custom", `--snapshot=${locked.snapshot}`]);
        return { postgres, roles: profile.roles as RecoveryRole[], ...(resources.bootstrap ? { bootstrap: { ...resources.bootstrap } } : {}) };
      },
      async objects() {
        const before = io.list();
        const objects: RecoveryPackageInput["objects"] = [];
        for (const entry of before) {
          const stat = JSON.parse(io.mc(["stat", "--json", `recovery/${resources.bucket}/${entry.key}`]).toString());
          const contentType = stat.metadata?.["Content-Type"];
          const head = await io.store().head({ bucket: resources.bucket, key: entry.key });
          if (stat.status !== "success" || typeof contentType !== "string" || (head && !head.ok)) recoveryRefuse("object-metadata-unavailable");
          const bytes = await io.store().get({ bucket: resources.bucket, key: entry.key });
          if (bytes.length !== entry.size) recoveryRefuse("object-size-drift");
          // The existing HEAD transport returns void for a successful object
          // with no user metadata; failed requests throw instead.
          objects.push({ key: entry.key, bytes, contentType, metadata: head?.metadata ?? {} });
        }
        if (digest(before) !== digest(io.list())) recoveryRefuse("object-inventory-drift");
        return objects;
      },
      redis: io.redisFiles, close: locked.close,
    };
  } };
}

export function createDockerRecoveryDestination(resources: DockerRecoveryResources, secrets: DockerRecoverySecrets): ControlledRecoveryTarget {
  ({ resources, secrets } = copyInputs(resources, secrets));
  const io = access(resources, secrets, false);
  return {
    observe: io.observe,
    async assertBootstrap(bootstrap) {
      if (!resources.bootstrap && !bootstrap) return;
      if (!resources.bootstrap || !bootstrap || digest(bootstrap) !== digest(resources.bootstrap)) recoveryRefuse("restore-bootstrap-mismatch");
      await io.db(async client => {
        await io.assertNoOtherSessions(client);
        if (hasUnsupportedNonDumpCapabilities(await io.inventory(client))) recoveryRefuse("restore-database-profile-unsupported");
      });
    },
    async assertEmptyAndIsolated() {
      await io.db(async client => {
        await io.assertNoOtherSessions(client);
        if (hasUnsupportedNonDumpCapabilities(await io.inventory(client))) recoveryRefuse("restore-database-profile-unsupported");
        const empty = (await client.query(resources.bootstrap ? EMPTY_TARGET_SQL.replaceAll("'postgres'", "$1::text") : EMPTY_TARGET_SQL,
          resources.bootstrap ? [io.adminName] : [])).rows[0]?.inventory;
        if (!empty || Object.values(empty).some(count => count !== 0)) recoveryRefuse("restore-database-not-empty");
      });
      if (io.list().length) recoveryRefuse("restore-bucket-not-empty");
      const directory = await mkdtemp(path.join(os.tmpdir(), "controlled-empty-redis-"));
      try {
        io.docker.command(["cp", `${resources.redis.id}:/data/.`, directory]);
        if ((await readdir(directory)).length) recoveryRefuse("restore-redis-not-empty");
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
    async restorePostgres(backup) {
      if (resources.bootstrap || backup.bootstrap) {
        if (!resources.bootstrap || !backup.bootstrap || digest(resources.bootstrap) !== digest(backup.bootstrap)) recoveryRefuse("restore-bootstrap-mismatch");
      }
      if (backup.roles.some(role => role.login && (!secrets.rolePasswords?.[role.name] || secrets.rolePasswords[role.name].includes("\0")))) recoveryRefuse("restore-role-secret-unavailable");
      await io.db(async client => {
        await client.query("begin");
        try {
          // Only this controlled bootstrap session changes logging. Password
          // statements must not enter even a locally enabled SQL-duration log.
          await client.query("set local log_statement='none'; set local log_min_error_statement='panic'; set local log_min_duration_statement=-1; set local log_min_duration_sample=-1");
          // Package verification has already restricted names and capabilities.
          for (const role of backup.roles) {
            const password = role.login ? secrets.rolePasswords?.[role.name] : undefined;
            if (role.login && (!password || password.includes("\0"))) recoveryRefuse("restore-role-secret-unavailable");
            await client.query(`create role "${role.name}" ${role.login ? `login password ${quote(password!)}` : "nologin"} ${role.inherit ? "inherit" : "noinherit"} nosuperuser nobypassrls nocreatedb nocreaterole noreplication`);
          }
          for (const role of backup.roles) for (const member of role.members) {
            await client.query(`grant "${role.name}" to "${member.name}" with admin false`);
            await client.query(`grant "${role.name}" to "${member.name}" with inherit ${member.inherit}`);
            await client.query(`grant "${role.name}" to "${member.name}" with set ${member.set}`);
          }
          await client.query("commit");
        } catch { await client.query("rollback").catch(() => {}); recoveryRefuse("restore-role-outcome-unknown"); }
      });
      io.exec(resources.postgres, ["pg_restore", "-U", io.adminName, "-d", resources.database, "--exit-on-error"], backup.postgres);
    },
    async restoreObjects(objects) {
      for (const object of objects) await io.store().put({ bucket: resources.bucket, ...object });
    },
    async restoreRedis(redis) {
      io.check();
      const directory = await mkdtemp(path.join(os.tmpdir(), "controlled-redis-import-"));
      try {
        for (const file of redis.files) await writeFile(path.join(directory, file.name), file.bytes, { flag: "wx", mode: 0o600 });
        io.check();
        io.docker.command(["cp", directory, `${resources.redis.id}:/data/appendonlydir`]);
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
  };
}
