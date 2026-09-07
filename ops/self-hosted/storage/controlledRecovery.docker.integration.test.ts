import { withHostOperationLock } from "../scripts/parameter-catalog-upgrade/handoff";
import { createRecoveryExecutionAuthorization } from "./execution/authorization";
import { createSyntheticRecoveryEvidence, recordSyntheticRecoveryConsumption } from "./execution/authorization.fixture";
import { createControlledRecoveryTarget } from "./execution/packageRestore";
import { createDockerRecoveryDestination } from "./execution/dockerRestore";
import { restoreRecoveryPackage } from "./execution/packageRestore";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { createIsolatedUpgradeDocker } from "../../../scripts/isolated-upgrade-docker";
import { createHttpObjectStorageTransport } from "../../../server/modules/logs/s3ObjectStore";
import { captureControlledRecovery } from "./controlledRecovery";
import { createDockerRecoverySource, type DockerRecoveryResources, type DockerRecoverySecrets } from "./controlledRecovery.docker";
import { verifyRecoveryPackage } from "./recoveryPackage";

// Explicit opt-in uses only the owned Docker guard; no globalSetup or ambient DB URL.
describe.skipIf(process.env.UPG_CONTROLLED_RECOVERY_DOCKER_TEST !== "1")("controlled three-store Docker adapter", () => {
  // Each acceptance responsibility owns a fresh source, package, target and run.
  // The six rejected-target attempts must not consume the successful lifecycle's
  // deadline. Both responsibilities retain the same 180s limit and all assertions.
  const scenarios = ["postgres", "wiseeff"].flatMap(bootstrapName =>
    ["package-only-restore", "nonempty-target-refusals"].map(scenario => ({ bootstrapName, scenario })));
  it.for(scenarios)("$bootstrapName bootstrap: $scenario after source shutdown", async ({ bootstrapName, scenario }, { signal, onTestFinished }) => {
    const transport = createIsolatedUpgradeDocker();
    let cleaning = false;
    const docker = { ...transport, command(args: string[], input?: Buffer) {
      if (!cleaning) signal.throwIfAborted();
      return transport.command(args, input);
    } };
    let finish!: () => void;
    const settled = new Promise<void>(resolve => { finish = resolve; });
    // A test timeout is still a failure at the unchanged 180s limit. Await the
    // interrupted body's owned-resource cleanup instead of exiting its worker
    // with a live restored target. This bounded hook does not extend acceptance.
    const runId = randomBytes(12).toString("hex");
    const label = "wiseeff.controlled-recovery-run";
    const evidence = await createSyntheticRecoveryEvidence();
    const directory = evidence.directory;
    let acceptanceComplete = false;
    let bodyStarted = false;
    const retainEvidence = async (outcome: "accepted" | "failed") => {
      await evidence.finish(outcome);
      console.info(JSON.stringify({ evidence: "private-synthetic-package-retained",
        locator: `${path.basename(directory)}/retained-evidence.json` }));
    };
    onTestFinished(async () => {
      if (bodyStarted) await settled;
      else await retainEvidence("failed");
    }, 60000);
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
    const timed = async <T>(phase: string, action: () => Promise<T>): Promise<T> => {
      const start = Date.now(); let passed = false;
      console.info(JSON.stringify({ evidence: "owned-recovery-adapter", phase, state: "started" }));
      try { const value = await action(); passed = true; return value; }
      finally { console.info(JSON.stringify({ evidence: "owned-recovery-adapter", phase, state: passed ? "returned" : "failed", elapsedMs: Date.now() - start })); }
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
      // This administrator is provisioned only in these new fixture containers.
      // Its private credential is never supplied to the API/worker placeholders.
      await writeFile(postgresEnv, `POSTGRES_USER=${bootstrapName}\nPOSTGRES_DB=postgres\nPOSTGRES_PASSWORD=${secrets.postgresPassword}\n`, { flag: "wx", mode: 0o600 });
      await writeFile(objectsEnv, `MINIO_ROOT_USER=${secrets.objectAccessKey}\nMINIO_ROOT_PASSWORD=${secrets.objectSecretKey}\n`, { flag: "wx", mode: 0o600 });
      const postgres = create(imageIds.postgres, ["-p", "127.0.0.1::5432", "--env-file", postgresEnv], [], "/var/lib/postgresql/data");
      const objects = create(imageIds.objects, ["-p", "127.0.0.1::9000", "--env-file", objectsEnv], ["server", "/data"], "/data");
      const redis = create(imageIds.redis, ["-p", "127.0.0.1::6379"], ["redis-server", "--appendonly", "yes", "--appendfsync", "always"], "/data");
      const objectClient = create(imageIds.mc, ["--entrypoint", "/bin/sh"], ["-c", "trap 'exit 0' TERM INT; sleep 3600 & wait"]);
      const writers = (["api", "worker", "web"] as const).map(service => ({ ...create(imageIds.mc, ["--entrypoint", "/bin/sh"], ["-c", "exit 0"]), service }));
      for (const c of [postgres, objects, objectClient, ...writers]) start(c.id);
      for (const writer of writers) docker.command(["wait", writer.id]);
      await wait(async () => exec(postgres.id, ["pg_isready", "-U", bootstrapName, "-d", "postgres"]));
      const mc = (args: string[]) => {
        const ip = (Object.values(inspect(objects.id).NetworkSettings.Networks) as { IPAddress: string }[])[0].IPAddress;
        const config = { version: "10", aliases: { fixture: { url: `http://${ip}:9000`, accessKey: secrets.objectAccessKey, secretKey: secrets.objectSecretKey, api: "S3v4", path: "auto" } } };
        return exec(objectClient.id, ["sh", "-c", 'umask 077; d=$(mktemp -d); trap \'rm -rf "$d"\' EXIT; cat > "$d/config.json"; mc --config-dir "$d" "$@"', "fixture", ...args], Buffer.from(JSON.stringify(config)));
      };
      await wait(async () => mc(["mb", "fixture/controlled-bucket"]));
      const resources: DockerRecoveryResources = { profile: "owned-pg16-minio2024-redis7-v1", runId, deploymentId: name, daemonId: docker.daemonId, networkId,
        postgres, objects, redis, objectClient, writers, database: "postgres", bucket: "controlled-bucket" };
      if (bootstrapName === "wiseeff") {
        resources.profile = "owned-pg16-minio2024-redis7-bootstrap-v3";
        resources.bootstrap = { roleName: "wiseeff", roleOid: "10", postgresMajor: 16 };
      }
      return { resources, secrets, mc, store: createHttpObjectStorageTransport({ endpoint: `http://${endpoint(objects.id, 9000)}`, accessKeyId: secrets.objectAccessKey, secretAccessKey: secrets.objectSecretKey }) };
    };
    bodyStarted = true;
    try {
      const source = await timed("setup-source", () => setup("source"));
      start(source.resources.redis.id);
      await wait(async () => exec(source.resources.redis.id, ["redis-cli", "PING"]));
      exec(source.resources.postgres.id, ["psql", "-U", bootstrapName, "-d", source.resources.database, "-v", "ON_ERROR_STOP=1"], Buffer.from(`
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
      const callerResources = structuredClone(source.resources);
      const callerSecrets = structuredClone(source.secrets);
      const adapter = createDockerRecoverySource(callerResources, callerSecrets);
      // A stopped, unrelated consumer on a different network must still make a
      // registered volume unsafe. This also verifies Docker's repeated volume
      // filter semantics against the real daemon used by the adapter.
      const borrowed = docker.command(["create", "--label", `${label}=${runId}`, "--network", "none",
        "--mount", `type=volume,source=${source.resources.postgres.mounts[0].name},target=/borrowed`,
        "--entrypoint", "/bin/sh", imageIds.mc, "-c", "exit 0"]).toString().trim();
      containers.push(borrowed);
      try { await expect(adapter.observe()).rejects.toThrow("volume-shared-with-other-container"); }
      finally { inspect(borrowed); docker.command(["rm", borrowed]); containers.splice(containers.indexOf(borrowed), 1); }
      // A caller's later object mutation must not retarget pg_dump/mc/AOF or
      // change a credential. The completed capture exercises all these paths.
      callerResources.postgres.id = source.resources.objects.id;
      callerResources.objects.id = source.resources.postgres.id;
      callerResources.redis.id = source.resources.objectClient.id;
      callerResources.database = "wrong_database"; callerResources.bucket = "wrong-bucket";
      callerSecrets.postgresPassword = "mutated"; callerSecrets.objectSecretKey = "mutated";
      const target = await adapter.observe();
      const issued = new Map<string, string>();
      const boundaryPort = {
        acquire: async () => {
          // Each independent attempt obtains a new observed boundary. Reusing a
          // receipt issued before earlier fault scenarios is deliberately invalid.
          const observed = await adapter.observe(); expect(observed).toEqual(target);
          const observedAt = new Date().toISOString();
          const proof = { runId, target: observed, observedAt, writers: source.resources.writers.map(w => w.id) };
          const receipt = { runId, target: observed, digest: createHash("sha256").update(JSON.stringify(proof)).digest("hex"), observedAt,
            expiresAt: new Date(Date.now() + 120000).toISOString() };
          issued.set(receipt.digest, JSON.stringify(receipt)); return receipt;
        },
        verify: async (value: { digest: string }) => {
          signal.throwIfAborted();
          expect(JSON.stringify(value)).toBe(issued.get(value.digest));
          const writers = JSON.parse(docker.command(["inspect", ...source.resources.writers.map(w => w.id)]).toString());
          expect(writers).toHaveLength(3);
          for (const writer of writers) expect(writer.State.Running).toBe(false);
        },
      };
      const writer = new pg.Client({ connectionString: `postgres://${bootstrapName}:${source.secrets.postgresPassword}@${endpoint(source.resources.postgres.id, 5432)}/postgres` });
      try {
        await writer.connect(); await writer.query("begin");
        await writer.query("update public.business set value=value where id=1");
        await timed("capture-active-writer-refusal", async () => {
          await expect(captureControlledRecovery({ directory, runId, target }, adapter, boundaryPort)).rejects.toThrow("database-writer-boundary-unavailable");
        });
      } finally { await writer.query("rollback").catch(() => {}); await writer.end(); }
      exec(source.resources.postgres.id, ["psql", "-U", bootstrapName, "-d", source.resources.database, "-v", "ON_ERROR_STOP=1", "-c", "grant create on database postgres to reader"]);
      try {
        await timed("capture-extra-acl-refusal", async () => {
          await expect(captureControlledRecovery({ directory, runId, target }, adapter, boundaryPort)).rejects.toThrow("non-dump-capability-unsupported");
        });
      } finally {
        exec(source.resources.postgres.id, ["psql", "-U", bootstrapName, "-d", source.resources.database, "-v", "ON_ERROR_STOP=1", "-c", "revoke create on database postgres from reader"]);
      }
      exec(source.resources.postgres.id, ["psql", "-U", bootstrapName, "-d", source.resources.database, "-v", "ON_ERROR_STOP=1", "-c", "alter database postgres connection limit 5"]);
      try {
        await timed("capture-database-properties-refusal", async () => {
          await expect(captureControlledRecovery({ directory, runId, target }, adapter, boundaryPort)).rejects.toThrow("non-dump-capability-unsupported");
          expect(exec(source.resources.postgres.id, ["psql", "-U", bootstrapName, "-d", source.resources.database, "-At", "-c",
            "select datconnlimit from pg_database where datname=current_database()"] ).toString().trim()).toBe("5");
        });
      } finally {
        // The source capture does not repair the unsupported setting. Only this
        // disposable fixture explicitly restores its own injected fault.
        exec(source.resources.postgres.id, ["psql", "-U", bootstrapName, "-d", source.resources.database, "-v", "ON_ERROR_STOP=1", "-c", "alter database postgres connection limit -1"]);
      }
      // Synthetic principal is limited to this test's resource identities. Real
      // controller approvals are neither generated nor mocked as passed reports.
      const captured = await timed("capture-package", () => captureControlledRecovery({ directory, runId, target }, adapter, boundaryPort));
      expect(captured.status).toBe("captured-not-restored");
      const verified = await verifyRecoveryPackage(directory, captured.packageDigest);
      expect(verified.manifest.format).toBe(bootstrapName === "postgres" ? "wiseeff-recovery-package-v2" : "wiseeff-recovery-package-v3");
      expect(verified.bootstrap).toEqual(source.resources.bootstrap);
      expect(verified.roles.map(role => role.name)).not.toContain(bootstrapName);
      for (const c of [source.resources.postgres, source.resources.objects, source.resources.objectClient]) stop(c.id);
      expect(inspect(source.resources.objectClient.id).State.ExitCode).toBe(0);
      const destination = await timed("setup-destination", () => setup("destination"));
      const destinationIo = createDockerRecoveryDestination(destination.resources, destination.secrets);
      const destinationIdentity = await destinationIo.observe();
      const targetSql = (sql: string) => exec(destination.resources.postgres.id,
        ["psql", "-U", bootstrapName, "-d", destination.resources.database, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql]).toString().trim();
      if (bootstrapName === "wiseeff") {
        await expect(destinationIo.assertBootstrap!({ roleName: "postgres", roleOid: "10", postgresMajor: 16 })).rejects.toThrow("restore-bootstrap-mismatch");
        await expect(destinationIo.assertBootstrap!()).rejects.toThrow("restore-bootstrap-mismatch");
        expect(targetSql("select rolname from pg_roles where oid=10")).toBe("wiseeff");
        expect(targetSql("select count(*) from pg_roles where rolname='postgres'")).toBe("0");
      }
      const targetFaults = [
        { name: "function", create: "create function public.preexisting_fn() returns integer language sql as 'select 7'",
          read: "select public.preexisting_fn()", expected: "7", remove: "drop function public.preexisting_fn()" },
        { name: "view", create: "create view public.preexisting_view as select 7 as value",
          read: "select value from public.preexisting_view", expected: "7", remove: "drop view public.preexisting_view" },
        { name: "sequence", create: "create sequence public.preexisting_seq start 7",
          read: "select last_value from public.preexisting_seq", expected: "7", remove: "drop sequence public.preexisting_seq" },
        { name: "type", create: "create type public.preexisting_type as enum ('hold')",
          read: "select 'hold'::public.preexisting_type", expected: "hold", remove: "drop type public.preexisting_type" },
        { name: "extension", create: "create extension hstore",
          read: "select extname from pg_extension where extname='hstore'", expected: "hstore", remove: "drop extension hstore" },
        { name: "event-trigger", create: "create function public.preexisting_event() returns event_trigger language plpgsql as 'begin end'; create event trigger preexisting_event on ddl_command_start execute function public.preexisting_event()",
          read: "select evtname from pg_event_trigger where evtname='preexisting_event'", expected: "preexisting_event",
          remove: "drop event trigger preexisting_event; drop function public.preexisting_event()" },
      ];
      for (const fault of scenario === "nonempty-target-refusals" ? targetFaults : []) {
        targetSql(fault.create);
        try {
          await timed(`restore-nonempty-${fault.name}-refusal`, async () => {
            const journalPath = path.join(directory, `refused-${fault.name}.json`);
            const consumption = await recordSyntheticRecoveryConsumption(directory, captured.packageDigest, destinationIdentity);
            await withHostOperationLock(path.join(privateInputs, "locks"), async lock => {
            const port = createControlledRecoveryTarget({ target: destinationIdentity,
              authorization: createRecoveryExecutionAuthorization({ ...consumption, lock }) }, destinationIo);
            await expect(restoreRecoveryPackage(directory, captured.packageDigest, port)).rejects.toThrow("controlled-recovery-restore-database-not-empty");
            await expect(lstat(journalPath)).rejects.toMatchObject({ code: "ENOENT" });
            expect(targetSql(fault.read)).toBe(fault.expected);
            expect(targetSql("select count(*) from pg_roles where rolname in ('data_owner','read_capability','reader')")).toBe("0");
            });
          });
        } finally {
          // Only the fixture removes its exact injected object. The restore
          // adapter must preserve it and refuse before creating a journal.
          targetSql(fault.remove);
        }
      }
      if (scenario === "nonempty-target-refusals") { acceptanceComplete = true; return; }
      // The restore child gets only destination identities/secrets and package
      // location/digest. It cannot read a source connection or fixture oracle.
      const consumption = await recordSyntheticRecoveryConsumption(directory, captured.packageDigest, destinationIdentity);
      const childScript = `import { readFileSync } from 'node:fs';
        import { createDockerRecoveryDestination } from ${JSON.stringify(path.resolve("ops/self-hosted/storage/execution/dockerRestore.ts"))};
        import { createControlledRecoveryTarget } from ${JSON.stringify(path.resolve("ops/self-hosted/storage/execution/packageRestore.ts"))};
        import { restoreRecoveryPackage } from ${JSON.stringify(path.resolve("ops/self-hosted/storage/execution/packageRestore.ts"))};
        import { withHostOperationLock } from ${JSON.stringify(path.resolve("ops/self-hosted/scripts/parameter-catalog-upgrade/handoff.ts"))};
        import { loadUpgradeJournal } from ${JSON.stringify(path.resolve("ops/self-hosted/scripts/parameter-catalog-upgrade/journal.ts"))};
        import { createRecoveryExecutionAuthorization } from ${JSON.stringify(path.resolve("ops/self-hosted/storage/execution/authorization.ts"))};
        const c=JSON.parse(readFileSync(0,'utf8'));
        try { const r=structuredClone(c.resources),s=structuredClone(c.secrets);
          const io=createDockerRecoveryDestination(r,s);
          r.postgres.id=c.resources.objects.id; r.objects.id=c.resources.postgres.id; r.redis.id=c.resources.objectClient.id;
          r.database='wrong_database'; r.bucket='wrong-bucket'; s.postgresPassword='mutated'; s.objectSecretKey='mutated'; s.rolePasswords.reader='mutated';
          const target=await io.observe();
          const loaded=loadUpgradeJournal({journalPath:c.controllerJournal,runId:c.runId}); if(!loaded.ok) throw new Error("journal-unavailable");
          await withHostOperationLock(c.lockRoot,async lock=>{
            const authorization=createRecoveryExecutionAuthorization({journal:loaded.value,directory:c.directory,capture:c.capture,approval:c.approval,restoreToken:c.restoreToken,lock});
            const port=createControlledRecoveryTarget({target,authorization},io);
            await restoreRecoveryPackage(c.directory,c.digest,port);
          }); console.log('restored-package-only');
        } catch { console.log('restore-refused'); process.exitCode=1; }`;
      const child = await timed("restore-package-child", async () => spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", childScript], {
        input: JSON.stringify({ controllerJournal: consumption.journal.journalPath, capture: consumption.capture, approval: consumption.approval, restoreToken: consumption.restoreToken,
          lockRoot: path.join(privateInputs, "locks"), resources: destination.resources, secrets: destination.secrets, runId, digest: captured.packageDigest, directory, journal: path.join(directory, "restore.json") }),
        encoding: "utf8", timeout: 90000, env: { PATH: process.env.PATH, HOME: os.homedir() },
      }));
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
      acceptanceComplete = true;
    } finally {
      cleaning = true;
      let cleanupComplete = false;
      try {
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
      await rm(privateInputs, { recursive: true, force: true });
      cleanupComplete = true;
      } finally {
        try {
          await retainEvidence(acceptanceComplete && cleanupComplete && !signal.aborted ? "accepted" : "failed");
        } finally { finish(); }
      }
    }
  }, 180000);
});
