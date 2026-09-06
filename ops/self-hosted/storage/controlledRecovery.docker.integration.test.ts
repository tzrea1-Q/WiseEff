import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { createIsolatedUpgradeDocker } from "../../../scripts/isolated-upgrade-docker";
import { createHttpObjectStorageTransport } from "../../../server/modules/logs/s3ObjectStore";
import { captureControlledRecovery } from "./controlledRecovery";
import { createDockerRecoverySource, type DockerRecoveryResources, type DockerRecoverySecrets } from "./controlledRecovery.docker";

// Explicit opt-in uses only the owned Docker guard; no globalSetup or ambient DB URL.
describe.skipIf(process.env.UPG_CONTROLLED_RECOVERY_DOCKER_TEST !== "1")("controlled three-store Docker adapter", () => {
  it("captures live owned stores and restores package-only in another process after the source is stopped", async () => {
    const docker = createIsolatedUpgradeDocker();
    const runId = randomBytes(12).toString("hex");
    const label = "wiseeff.controlled-recovery-run";
    const directory = await mkdtemp(path.join(os.tmpdir(), "controlled-recovery-live-"));
    const privateInputs = await mkdtemp(path.join(os.tmpdir(), "controlled-recovery-secrets-"));
    const containers: string[] = []; const volumes: string[] = []; const networks: string[] = [];
    const refs = { postgres: "postgres:16-alpine", objects: "minio/minio:RELEASE.2024-12-18T13-15-44Z", redis: "redis:7-alpine", mc: "minio/mc:RELEASE.2024-11-21T17-21-54Z" };
    const imageIds = Object.fromEntries(Object.entries(refs).map(([name, ref]) => [name, JSON.parse(docker.command(["image", "inspect", ref]).toString())[0].Id as string]));
    const inspect = (id: string) => docker.assertOwned(id, label, runId);
    const exec = (id: string, args: string[], bytes?: Buffer) => { inspect(id); return docker.command(["exec", "-i", id, ...args], bytes); };
    const start = (id: string) => { inspect(id); docker.command(["start", id]); };
    const stop = (id: string) => { inspect(id); docker.command(["stop", id]); };
    const endpoint = (id: string, port: number) => `127.0.0.1:${inspect(id).NetworkSettings.Ports[`${port}/tcp`][0].HostPort}`;
    const wait = async (probe: () => Promise<unknown>) => {
      for (let attempt = 0; attempt < 40; attempt++) { try { await probe(); return; } catch { await setTimeout(100); } }
      throw new Error("owned-fixture-startup-failed");
    };
    const setup = async (name: string) => {
      const networkId = docker.command(["network", "create", "--driver", "bridge", "--opt", "com.docker.network.bridge.enable_ip_masquerade=false",
        "--label", `${label}=${runId}`, `controlled-${runId}-${name}`]).toString().trim();
      networks.push(networkId);
      const secrets: DockerRecoverySecrets = { postgresPassword: randomBytes(24).toString("hex"), objectAccessKey: "controlled", objectSecretKey: randomBytes(24).toString("hex"), rolePasswords: { reader: randomBytes(24).toString("hex") } };
      const create = (image: string, args: string[], cmd: string[], destination?: string) => {
        const mounts: { name: string; destination: string; createdAt: string }[] = [];
        if (destination) {
          const volume = docker.command(["volume", "create", "--label", `${label}=${runId}`, `controlled-${runId}-${volumes.length}`]).toString().trim();
          volumes.push(volume);
          mounts.push({ name: volume, destination, createdAt: JSON.parse(docker.command(["volume", "inspect", volume]).toString())[0].CreatedAt });
        }
        const id = docker.command(["create", "--label", `${label}=${runId}`, "--network", networkId,
          ...mounts.flatMap(m => ["--mount", `type=volume,source=${m.name},target=${m.destination}`]), ...args, image, ...cmd]).toString().trim();
        containers.push(id); inspect(id); return { id, imageId: image, mounts };
      };
      // Disposable fixture credentials stay in separate 0600 files and container
      // config, never in Docker argv, the backup directory or printed evidence.
      const postgresEnv = path.join(privateInputs, `${name}-postgres.env`);
      const objectsEnv = path.join(privateInputs, `${name}-objects.env`);
      await writeFile(postgresEnv, `POSTGRES_PASSWORD=${secrets.postgresPassword}\n`, { flag: "wx", mode: 0o600 });
      await writeFile(objectsEnv, `MINIO_ROOT_USER=${secrets.objectAccessKey}\nMINIO_ROOT_PASSWORD=${secrets.objectSecretKey}\n`, { flag: "wx", mode: 0o600 });
      const postgres = create(imageIds.postgres, ["-p", "127.0.0.1::5432", "--env-file", postgresEnv], [], "/var/lib/postgresql/data");
      const objects = create(imageIds.objects, ["-p", "127.0.0.1::9000", "--env-file", objectsEnv], ["server", "/data"], "/data");
      const redis = create(imageIds.redis, ["-p", "127.0.0.1::6379"], ["redis-server", "--appendonly", "yes", "--appendfsync", "always"], "/data");
      const objectClient = create(imageIds.mc, ["--entrypoint", "/bin/sh"], ["-c", "sleep 3600"]);
      const writers = (["api", "worker", "web"] as const).map(service => ({ ...create(imageIds.mc, ["--entrypoint", "/bin/sh"], ["-c", "exit 0"]), service }));
      for (const c of [postgres, objects, objectClient, ...writers]) start(c.id);
      for (const writer of writers) docker.command(["wait", writer.id]);
      await wait(async () => exec(postgres.id, ["pg_isready", "-U", "postgres"]));
      const mc = (args: string[]) => {
        const ip = (Object.values(inspect(objects.id).NetworkSettings.Networks) as { IPAddress: string }[])[0].IPAddress;
        const config = { version: "10", aliases: { fixture: { url: `http://${ip}:9000`, accessKey: secrets.objectAccessKey, secretKey: secrets.objectSecretKey, api: "S3v4", path: "auto" } } };
        return exec(objectClient.id, ["sh", "-c", 'umask 077; d=$(mktemp -d); trap \'rm -rf "$d"\' EXIT; cat > "$d/config.json"; mc --config-dir "$d" "$@"', "fixture", ...args], Buffer.from(JSON.stringify(config)));
      };
      await wait(async () => mc(["mb", "fixture/controlled-bucket"]));
      const resources: DockerRecoveryResources = { profile: "owned-pg16-minio2024-redis7-v1", runId, deploymentId: name, daemonId: docker.daemonId, networkId,
        postgres, objects, redis, objectClient, writers, database: "postgres", bucket: "controlled-bucket" };
      return { resources, secrets, mc, store: createHttpObjectStorageTransport({ endpoint: `http://${endpoint(objects.id, 9000)}`, accessKeyId: secrets.objectAccessKey, secretAccessKey: secrets.objectSecretKey }) };
    };
    try {
      const source = await setup("source");
      start(source.resources.redis.id);
      await wait(async () => exec(source.resources.redis.id, ["redis-cli", "PING"]));
      exec(source.resources.postgres.id, ["psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], Buffer.from(`
        create role data_owner nologin noinherit;
        create role read_capability nologin noinherit;
        create role reader login inherit;
        grant read_capability to reader with inherit true;
        grant read_capability to reader with set false;
        create table public.business(id integer primary key, value jsonb not null);
        alter table public.business owner to data_owner;
        grant select on public.business to read_capability;
        insert into public.business values(1,'{"approved":null}'),(2,'[1,2]');
      `));
      const oracle = [
        { key: "one/data.json", contentType: "application/json", metadata: { revision: "7", origin: "left" }, bytes: Buffer.from('{"kind":null}') },
        { key: "other/report.txt", contentType: "text/plain", metadata: { revision: "12", origin: "right" }, bytes: Buffer.from("second object\n") },
      ];
      for (const object of oracle) await source.store.put({ bucket: source.resources.bucket, ...object });
      exec(source.resources.redis.id, ["redis-cli", "LPUSH", "bull:controlled:wait", "job-b", "job-a"]);
      exec(source.resources.redis.id, ["redis-cli", "HSET", "bull:controlled:meta", "paused", "1"]);
      stop(source.resources.redis.id);
      const adapter = createDockerRecoverySource(source.resources, source.secrets);
      const target = await adapter.observe();
      const receipt = { runId, target, digest: "b".repeat(64), observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120000).toISOString() };
      const boundaryPort = {
        acquire: async () => receipt,
        verify: async (value: typeof receipt) => { expect(value).toEqual(receipt); for (const writer of source.resources.writers) expect(inspect(writer.id).State.Running).toBe(false); },
      };
      const writer = new pg.Client({ connectionString: `postgres://postgres:${source.secrets.postgresPassword}@${endpoint(source.resources.postgres.id, 5432)}/postgres` });
      try {
        await writer.connect(); await writer.query("begin");
        await writer.query("update public.business set value=value where id=1");
        await expect(captureControlledRecovery({ directory, runId, target }, adapter, boundaryPort)).rejects.toThrow("database-writer-boundary-unavailable");
      } finally { await writer.query("rollback").catch(() => {}); await writer.end(); }
      exec(source.resources.postgres.id, ["psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c", "grant create on database postgres to reader"]);
      try {
        await expect(captureControlledRecovery({ directory, runId, target }, adapter, boundaryPort)).rejects.toThrow("non-dump-capability-unsupported");
      } finally {
        exec(source.resources.postgres.id, ["psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c", "revoke create on database postgres from reader"]);
      }
      // Synthetic principal is limited to this test's resource identities. Real
      // controller approvals are neither generated nor mocked as passed reports.
      const captured = await captureControlledRecovery({ directory, runId, target }, adapter, boundaryPort);
      expect(captured.status).toBe("captured-not-restored");
      for (const c of [source.resources.postgres, source.resources.objects, source.resources.objectClient]) stop(c.id);
      const destination = await setup("destination");
      // The restore child gets only destination identities/secrets and package
      // location/digest. It cannot read a source connection or fixture oracle.
      const childScript = `import { readFileSync } from 'node:fs';
        import { createDockerRecoveryDestination } from ${JSON.stringify(path.resolve("ops/self-hosted/storage/controlledRecovery.docker.ts"))};
        import { createControlledRecoveryTarget } from ${JSON.stringify(path.resolve("ops/self-hosted/storage/controlledRecovery.ts"))};
        import { restoreRecoveryPackage } from ${JSON.stringify(path.resolve("ops/self-hosted/storage/recoveryPackage.ts"))};
        const c=JSON.parse(readFileSync(0,'utf8'));
        try { const io=createDockerRecoveryDestination(c.resources,c.secrets); const target=await io.observe();
          const port=createControlledRecoveryTarget({target,journalPath:c.journal,authorize:async binding=>{
            if(binding.runId!==c.runId||binding.packageDigest!==c.digest) throw new Error('fixture-approval-refused');
          }},io); await restoreRecoveryPackage(c.directory,c.digest,port); console.log('restored-package-only');
        } catch { console.log('restore-refused'); process.exitCode=1; }`;
      const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", childScript], {
        input: JSON.stringify({ resources: destination.resources, secrets: destination.secrets, runId, digest: captured.packageDigest, directory, journal: path.join(directory, "restore.json") }),
        encoding: "utf8", timeout: 90000, env: { PATH: process.env.PATH, HOME: os.homedir() },
      });
      expect(child.status, child.stdout).toBe(0);
      expect(child.stdout.trim()).toBe("restored-package-only");
      expect(child.stderr).not.toContain(destination.secrets.postgresPassword);
      const client = new pg.Client({ connectionString: `postgres://reader:${destination.secrets.rolePasswords!.reader}@${endpoint(destination.resources.postgres.id, 5432)}/postgres` });
      try {
        await client.connect();
        expect((await client.query("select * from public.business order by id")).rows).toEqual([{ id: 1, value: { approved: null } }, { id: 2, value: [1, 2] }]);
        await expect(client.query("insert into public.business values(3,'null')")).rejects.toMatchObject({ code: "42501" });
        await expect(client.query("set role read_capability")).rejects.toMatchObject({ code: "42501" });
      } finally { await client.end(); }
      for (const object of oracle) {
        expect(await destination.store.get({ bucket: destination.resources.bucket, key: object.key })).toEqual(object.bytes);
        expect(await destination.store.head({ bucket: destination.resources.bucket, key: object.key })).toMatchObject({ metadata: object.metadata });
        expect(JSON.parse(destination.mc(["stat", "--json", `fixture/${destination.resources.bucket}/${object.key}`]).toString()).metadata["Content-Type"]).toBe(object.contentType);
      }
      expect(inspect(destination.resources.redis.id).State.Running).toBe(false);
      start(destination.resources.redis.id);
      await wait(async () => exec(destination.resources.redis.id, ["redis-cli", "PING"]));
      expect(exec(destination.resources.redis.id, ["redis-cli", "LRANGE", "bull:controlled:wait", "0", "-1"]).toString().trim()).toBe("job-a\njob-b");
      expect(exec(destination.resources.redis.id, ["redis-cli", "HGET", "bull:controlled:meta", "paused"]).toString().trim()).toBe("1");
    } finally {
      // Only exact IDs/volumes created by this fixture may be disposed of.
      for (const id of containers.reverse()) { inspect(id); docker.command(["rm", "-f", id]); }
      for (const name of volumes.reverse()) {
        expect(JSON.parse(docker.command(["volume", "inspect", name]).toString())[0].Labels[label]).toBe(runId);
        docker.command(["volume", "rm", name]);
      }
      for (const id of networks.reverse()) {
        expect(JSON.parse(docker.command(["network", "inspect", id]).toString())[0].Labels[label]).toBe(runId);
        docker.command(["network", "rm", id]);
      }
      await rm(directory, { recursive: true, force: true });
      await rm(privateInputs, { recursive: true, force: true });
    }
  }, 180000);
});
