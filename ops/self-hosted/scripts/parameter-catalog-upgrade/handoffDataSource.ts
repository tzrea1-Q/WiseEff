import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { createIsolatedUpgradeDocker } from "../../../../scripts/isolated-upgrade-docker";
import { canonicalJson } from "./journal";
import type { DataIdentity, HandoffInputs, HandoffObserver } from "./handoff";

type Options = {
  inputs: HandoffInputs;
  objectClient: { containerId: string; imageId: string };
  postgres: { database: string; user: string; password: string };
  objects: { bucket: string; accessKey: string; secretKey: string };
  /** Only the actual Redis logical database, never an inferred BullMQ prefix. */
  redis: { database: number; auth: { kind: "none" } | { kind: "password"; username: string; password: string } };
};
type Container = {
  Id: string; Image: string; Config: { Labels: Record<string, string> };
  State: { Running: boolean; Restarting: boolean; StartedAt: string };
  Mounts: { Type: string; Name: string; Destination: string }[];
  HostConfig: { NetworkMode: string };
  NetworkSettings: { Networks: Record<string, { NetworkID: string; IPAddress: string }> };
};
type Volume = { Name: string; Driver: string; Options: Record<string, string> | null;
  CreatedAt: string; Mountpoint: string; Labels: Record<string, string> };
function fail(code: string): never { throw new Error(`handoff-data-${code}`); }
function need(value: unknown, code: string): asserts value { if (!value) fail(code); }
const id = (value: string) => /^[a-f0-9]{64}$/.test(value);
const image = (value: string) => /^sha256:[a-f0-9]{64}$/.test(value);
const digest = (value: unknown) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const privateText = (value: unknown): value is string => typeof value === "string" && value.length > 0 &&
  Buffer.byteLength(value) <= 65536 && !/[\r\n\0]/.test(value);
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(value);
const PG_SCRIPT = 'IFS= read -r PGPASSWORD || exit 1; export PGPASSWORD; PGOPTIONS="-c default_transaction_read_only=on -c search_path=pg_catalog"; export PGOPTIONS; exec psql -X -w -h 127.0.0.1 -p 5432 -U "$1" -d "$2" -At --set=ON_ERROR_STOP=1 -c "$3"';
const PG_SQL = "select pg_catalog.json_build_object('systemIdentifier',s.system_identifier::text,'databaseOid',d.oid::text,'database',d.datname,'user',current_user,'version',pg_catalog.current_setting('server_version_num')::int) from pg_catalog.pg_control_system() s cross join pg_catalog.pg_database d where d.datname=pg_catalog.current_database() and session_user=current_user";
const MC_SCRIPT = 'umask 077; d=$(mktemp -d) || exit 1; trap \'rm -rf "$d"\' EXIT HUP INT TERM; cat > "$d/config.json" || exit 1; mc --config-dir "$d" "$@"; result=$?; rm -rf "$d" || exit 1; trap - EXIT HUP INT TERM; exit "$result"';
const REDIS_SCRIPT = 'mode=$1; shift; if [ "$mode" = password ]; then IFS= read -r REDISCLI_AUTH || exit 1; export REDISCLI_AUTH; fi; exec redis-cli --no-auth-warning --raw -h 127.0.0.1 -p 6379 "$@"';
const persistenceKeys = ["appendonly", "appendfsync", "save", "dir", "dbfilename", "appendfilename", "appenddirname", "databases"];

/** Read-only owned Compose adapter. The three digests must be consumed with the
 * original handoff's complete private-config binding. It does not establish
 * writer quiescence, arbitrary queue-prefix isolation, or application startup.
 * Secrets are copied into this closure; no environment fallback or client is
 * exposed. Commands use stdin and an empty child environment, never secret argv.
 */
export function createOwnedHandoffDataObserver(offered: Options): HandoffObserver {
  let fixed: Options;
  try { fixed = structuredClone(offered); need(fixed, "input-invalid"); } catch { fail("input-invalid"); }
  const { inputs, postgres, objects, redis } = fixed;
  try {
  need(inputs && inputs.source && identifier(postgres?.database) && identifier(postgres?.user) &&
    [postgres.password, objects?.accessKey, objects?.secretKey].every(privateText) &&
    /^[a-z0-9][a-z0-9-]{2,62}$/.test(objects.bucket) && Number.isSafeInteger(redis?.database) && redis.database >= 0 &&
    (redis.auth?.kind === "none" || redis.auth?.kind === "password" && identifier(redis.auth.username) && privateText(redis.auth.password)), "input-invalid");
  need(path.isAbsolute(inputs.source.composeFile) && inputs.source.composeFile === path.resolve(inputs.source.composeFile) &&
    /^[a-z0-9][a-z0-9_-]*$/.test(inputs.source.project) && id(fixed.objectClient.containerId) && image(fixed.objectClient.imageId), "input-invalid");
  need(inputs.source.stores.map(s => s.service).sort().join(",") === "minio,postgres,redis" &&
    inputs.source.applications.map(s => s.service).sort().join(",") === "api,web,worker", "input-invalid");
  const selections = [...inputs.source.applications, ...inputs.source.stores,
    { service: "mc", containerId: fixed.objectClient.containerId }];
  need(selections.every(s => id(s.containerId)) && new Set(selections.map(s => s.containerId)).size === 7 &&
    new Set(inputs.source.stores.map(s => s.volumeName)).size === 3, "input-invalid");
  } catch { fail("input-invalid"); }
  const selections = [...inputs.source.applications, ...inputs.source.stores,
    { service: "mc", containerId: fixed.objectClient.containerId }];
  const docker = createIsolatedUpgradeDocker();
  const stores = (["postgres", "minio", "redis"] as const).map(service => inputs.source.stores.find(s => s.service === service)!);
  const inspect = () => {
    need(docker.daemonId === inputs.expectedDaemonId, "daemon-mismatch");
    const containers = JSON.parse(docker.command(["inspect", ...selections.map(s => s.containerId)]).toString()) as Container[];
    need(containers.length === 7, "resource-unavailable");
    for (const selected of selections) {
      const current = containers.find(c => c.Id === selected.containerId), labels = current?.Config?.Labels;
      need(current && image(current.Image) && labels?.["com.docker.compose.project"] === inputs.source.project &&
        labels["com.docker.compose.service"] === selected.service && labels["com.docker.compose.project.config_files"] === inputs.source.composeFile &&
        labels["com.docker.compose.project.working_dir"] === path.dirname(inputs.source.composeFile), "resource-owner-mismatch");
      if (selected.service === "mc" || stores.some(s => s.service === selected.service)) {
        need(current.State.Running && !current.State.Restarting && Number.isFinite(Date.parse(current.State.StartedAt)), "store-not-running");
      }
    }
    const helper = containers.find(c => c.Id === fixed.objectClient.containerId)!;
    need(helper.Image === fixed.objectClient.imageId && helper.Mounts.length === 0, "helper-mismatch");
    const observedStores = stores.map(store => containers.find(c => c.Id === store.containerId)!);
    const volumes = JSON.parse(docker.command(["volume", "inspect", ...stores.map(s => s.volumeName)]).toString()) as Volume[];
    need(volumes.length === 3, "volume-unavailable");
    const consumers = docker.command(["ps", "-a", "--no-trunc",
      ...stores.flatMap(store => ["--filter", `volume=${store.volumeName}`]), "--format", "{{.ID}}"])
      .toString().trim().split("\n").filter(Boolean);
    const expectedConsumers = new Set(stores.map(store => store.containerId));
    need(consumers.length === expectedConsumers.size && new Set(consumers).size === expectedConsumers.size &&
      consumers.every(containerId => expectedConsumers.has(containerId)), "shared-volume");
    for (const [index, store] of stores.entries()) {
      const container = observedStores[index]!, volume = volumes.find(v => v.Name === store.volumeName);
      const destination = store.service === "postgres" ? "/var/lib/postgresql/data" : "/data";
      need(store.destination === destination && container.Mounts.length === 1 && container.Mounts[0]!.Type === "volume" &&
        container.Mounts[0]!.Name === store.volumeName && container.Mounts[0]!.Destination === destination &&
        volume?.Labels?.["com.docker.compose.project"] === inputs.source.project && volume.Driver === "local" &&
        Object.keys(volume.Options ?? {}).length === 0 && path.isAbsolute(volume.Mountpoint) && Number.isFinite(Date.parse(volume.CreatedAt)), "volume-owner-mismatch");
    }
    const connected = [...observedStores, helper];
    const networks = connected.map(c => Object.values(c.NetworkSettings.Networks));
    need(networks.every(n => n.length === 1 && id(n[0]!.NetworkID)) && connected.every(c => c.HostConfig.NetworkMode !== "host" && !c.HostConfig.NetworkMode.startsWith("container:")), "network-unproven");
    const networkId = networks[0]![0]!.NetworkID;
    need(networks.every(n => n[0]!.NetworkID === networkId), "network-unproven");
    const network = JSON.parse(docker.command(["network", "inspect", networkId]).toString())[0];
    const networkConsumers = docker.command(["ps", "-a", "--no-trunc", "--filter", `network=${networkId}`, "--format", "{{.ID}}"])
      .toString().trim().split("\n").filter(Boolean);
    need(network.Id === networkId && network.Driver === "bridge" && network.Internal === false &&
      network.Labels?.["com.docker.compose.project"] === inputs.source.project &&
      network.Options?.["com.docker.network.bridge.enable_ip_masquerade"] === "false" &&
      Object.keys(network.Containers).every(key => selections.some(s => s.containerId === key)) &&
      networkConsumers.every(key => selections.some(s => s.containerId === key)) &&
      connected.every(c => Object.hasOwn(network.Containers, c.Id)), "network-unproven");
    const address = Object.values(observedStores[1]!.NetworkSettings.Networks)[0]!.IPAddress;
    need(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(address) && address.split(".").every(octet => Number(octet) <= 255), "network-unproven");
    return { containers: connected.map(c => ({ id: c.Id, image: c.Image, startedAt: c.State.StartedAt, mounts: c.Mounts })),
      volumes, networkId, address };
  };
  return { docker, async observeDataIdentity(selection): Promise<DataIdentity> {
    try {
      need(isDeepStrictEqual(structuredClone(selection), inputs), "selection-mismatch");
      const baseline = inspect();
      const guard = () => need(isDeepStrictEqual(inspect(), baseline), "resource-drift");
      const exec = (container: string, marker: string, script: string, args: string[], input?: Buffer) => {
        const output = docker.command(["exec", "-i", container, "env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/tmp", "sh", "-c", script, marker, ...args], input);
        return output.toString().replace(/\r?\n$/, "");
      };
      const read = () => {
        const pgIdentity = JSON.parse(exec(stores[0]!.containerId, "handoff-postgres", PG_SCRIPT,
          [postgres.user, postgres.database, PG_SQL], Buffer.from(postgres.password + "\n")));
        need(/^[0-9]+$/.test(pgIdentity.systemIdentifier) && /^[1-9][0-9]*$/.test(pgIdentity.databaseOid) &&
          pgIdentity.database === postgres.database && pgIdentity.user === postgres.user && Number.isInteger(pgIdentity.version) &&
          pgIdentity.version >= 160000 && pgIdentity.version < 170000, "postgres-unavailable");
        guard();
        const mc = (args: string[]) => exec(fixed.objectClient.containerId, "handoff-minio", MC_SCRIPT, args, Buffer.from(JSON.stringify({ version: "10", aliases: {
          handoff: { url: `http://${baseline.address}:9000`, accessKey: objects.accessKey, secretKey: objects.secretKey, api: "S3v4", path: "auto" },
        } })));
        const minio = JSON.parse(mc(["admin", "info", "--json", "handoff"]));
        const buckets = mc(["ls", "--json", "handoff"]).split("\n").filter(Boolean).map(line => JSON.parse(line));
        const version = JSON.parse(mc(["version", "info", "--json", `handoff/${objects.bucket}`]));
        const bucket = buckets.filter(row => row.key === `${objects.bucket}/`);
        need(minio.status === "success" && typeof minio.info?.deploymentID === "string" && minio.info.deploymentID.length > 0 &&
          buckets.every(row => row.status === "success") && bucket.length === 1 && Number.isFinite(Date.parse(bucket[0].lastModified)) &&
          version.status === "success" && version.versioning && ["", "Enabled", "Suspended"].includes(version.versioning.status), "object-identity-unavailable");
        guard();
        const redisRead = (...args: string[]) => exec(stores[2]!.containerId, "handoff-redis", REDIS_SCRIPT,
          [redis.auth.kind, "-n", String(redis.database), ...(redis.auth.kind === "password" ? ["--user", redis.auth.username] : []), ...args],
          redis.auth.kind === "password" ? Buffer.from(redis.auth.password + "\n") : undefined);
        const server = redisRead("INFO", "server").split(/\r?\n/);
        const field = (key: string) => { const rows = server.filter(line => line.startsWith(key + ":")); need(rows.length === 1, "redis-unavailable"); return rows[0]!.slice(key.length + 1); };
        const runId = field("run_id"); need(/^[a-f0-9]{40}$/.test(runId) && /^7\./.test(field("redis_version")), "redis-unavailable");
        const lines = redisRead("CONFIG", "GET", ...persistenceKeys).split(/\r?\n/);
        need(lines.length === persistenceKeys.length * 2, "redis-persistence-unavailable");
        const persistence: Record<string, string> = {};
        for (let n = 0; n < lines.length; n += 2) {
          need(persistenceKeys.includes(lines[n]!) && !Object.hasOwn(persistence, lines[n]!), "redis-persistence-unavailable");
          persistence[lines[n]!] = lines[n + 1]!;
        }
        need(persistence.appendonly === "yes" && ["always", "everysec"].includes(persistence.appendfsync!) &&
          persistence.dir === "/data" && /^[1-9][0-9]*$/.test(persistence.databases!) && Number(persistence.databases) > redis.database, "redis-persistence-unavailable");
        const client = redisRead("CLIENT", "INFO").split(/\s+/);
        need(client.filter(value => value.startsWith("db=")).join("") === `db=${redis.database}` &&
          client.filter(value => value.startsWith("user=")).join("") === `user=${redis.auth.kind === "password" ? redis.auth.username : "default"}`, "redis-namespace-unavailable");
        guard();
        return { pgIdentity, objects: { deployment: minio.info.deploymentID, bucket: objects.bucket,
          createdAt: bucket[0].lastModified, versioning: version.versioning }, redis: { runId, persistence, namespace: { kind: "logical-database", database: redis.database } } };
      };
      const facts = read();
      const resource = (index: number) => ({ daemon: docker.daemonId, project: inputs.source.project, network: baseline.networkId,
        container: stores[index]!.containerId, image: baseline.containers[index]!.image, volume: baseline.volumes.find(v => v.Name === stores[index]!.volumeName) });
      return { postgres: digest({ resource: resource(0), identity: facts.pgIdentity }),
        objectStore: digest({ resource: resource(1), identity: facts.objects }), redis: digest({ resource: resource(2), identity: facts.redis }) };
    } catch { fail("observation-unavailable"); }
  } };
}
