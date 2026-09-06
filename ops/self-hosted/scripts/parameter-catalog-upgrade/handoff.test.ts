import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createIsolatedUpgradeDocker } from "../../../../scripts/isolated-upgrade-docker";
import { openCatalogUpgradeController } from "./controller";
import { executeHandoff, inspectHandoff, prepareHandoff, withHostOperationLock, type HandoffInputs } from "./handoff";

it("refuses an unbound daemon before observing any deployment resource", async () => {
  let observed = false;
  await expect(inspectHandoff({ expectedDaemonId: "other" } as never, {
    docker: { daemonId: "local", command() { observed = true; return Buffer.from(""); } },
    observeDataIdentity: async () => { throw new Error("must not query"); },
  })).rejects.toThrow("handoff-daemon-mismatch");
  expect(observed).toBe(false);
});

describe.skipIf(process.env.UPG_HANDOFF_DOCKER_TEST !== "1")("actual isolated Compose handoff identity", () => {
  it("binds old checkout and actual Compose stores, dispatches inspect, and refuses wrong targets or changed plans", async () => {
    const sourceSha = "82344044b436a8dafecefbb85dfd724cecb05e3f";
    const root = await realpath(process.cwd());
    const directory = await mkdtemp(path.join(os.tmpdir(), "handoff-compose-"));
    const source = path.join(directory, "source");
    const run = `handoff-${randomBytes(8).toString("hex")}`;
    const secret = randomBytes(24).toString("hex");
    const git = (...args: string[]) => {
      const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
      if (result.status !== 0) throw new Error("fixture-git-failed");
      return result.stdout.trim();
    };
    const docker = createIsolatedUpgradeDocker();
    const sourceImage = `${run}-source:${sourceSha}`;
    const candidateTag = `${run}-candidate:fixture`;
    let composeFile = "";
    let worktree = false;
    let composeAttempted = false;
    const compose = (...args: string[]) => docker.command(["compose", "-p", run, "-f", composeFile, ...args]);
    const ids: Record<string, string> = {};
    const owned = (service: string) => {
      const info = JSON.parse(docker.command(["inspect", ids[service]!]).toString())[0];
      if (info.Id !== ids[service] || info.Config.Labels["com.docker.compose.project"] !== run || info.Config.Labels["com.docker.compose.service"] !== service) throw new Error("fixture-ownership-mismatch");
      return info;
    };
    const exec = (service: string, args: string[]) => { owned(service); return docker.command(["exec", ids[service]!, ...args]).toString().trim(); };
    const wait = async (probe: () => unknown) => { for (let n = 0; n < 40; n++) { try { return probe(); } catch { await setTimeout(150); } } throw new Error("fixture-store-not-ready"); };
    try {
      git("worktree", "add", "--detach", source, sourceSha); worktree = true;
      composeFile = path.join(await realpath(source), "ops/self-hosted/handoff-fixture.yaml");
      const revision = git("rev-parse", "HEAD"); const tree = git("rev-parse", "HEAD^{tree}");
      const redisImage = docker.command(["image", "inspect", "redis:7-alpine", "--format", "{{.Id}}"] ).toString().trim();
      docker.command(["tag", redisImage, sourceImage]);
      const dockerfile = path.join(directory, "Dockerfile");
      await writeFile(dockerfile, `FROM ${sourceImage}\nLABEL org.opencontainers.image.revision=${revision}\nLABEL org.wiseeff.source.tree=${tree}\n`);
      docker.command(["build", "--network=none", "-t", candidateTag, "-f", dockerfile, directory]);
      const candidateImage = docker.command(["image", "inspect", candidateTag, "--format", "{{.Id}}"] ).toString().trim();
      // App fixtures prove artifact/Compose identity only. They are not a built legacy application.
      const app = { image: sourceImage, entrypoint: ["sh", "-c", "sleep 300"] };
      await writeFile(composeFile, JSON.stringify({ services: {
        api: app, worker: app, web: app,
        postgres: { image: "postgres:16-alpine", environment: { POSTGRES_PASSWORD: secret }, volumes: ["pg:/var/lib/postgresql/data"] },
        redis: { image: "redis:7-alpine", command: ["redis-server", "--appendonly", "yes"], volumes: ["redis:/data"] },
        minio: { image: "minio/minio:RELEASE.2024-12-18T13-15-44Z", environment: { MINIO_ROOT_USER: "synthetic", MINIO_ROOT_PASSWORD: secret }, command: ["server", "/data"], volumes: ["objects:/data"] },
        mc: { image: "minio/mc:RELEASE.2024-11-21T17-21-54Z", entrypoint: ["sh", "-c", "sleep 300"], environment: { MC_HOST_fixture: `http://synthetic:${secret}@minio:9000` } },
      }, volumes: { pg: {}, redis: {}, objects: {} }, networks: { default: { driver_opts: { "com.docker.network.bridge.enable_ip_masquerade": "false" } } } }), { mode: 0o600 });
      expect(docker.command(["ps", "-aq", "--filter", `label=com.docker.compose.project=${run}`]).toString().trim()).toBe("");
      composeAttempted = true;
      compose("up", "-d", "--no-build", "--pull", "never");
      for (const service of ["api", "worker", "web", "postgres", "redis", "minio", "mc"]) {
        const short = compose("ps", "-q", service).toString().trim();
        ids[service] = JSON.parse(docker.command(["inspect", short]).toString())[0].Id; owned(service);
      }
      await wait(() => exec("postgres", ["pg_isready", "-U", "postgres"]));
      await wait(() => exec("mc", ["mc", "mb", "fixture/isolated"]));
      const configFile = path.join(source, "ops/self-hosted/.handoff-private.env");
      await writeFile(configFile, "SYNTHETIC_CONFIGURATION=first\n", { mode: 0o600 });
      const input: HandoffInputs = {
        runId: run, expectedDaemonId: docker.daemonId, entrypoint: { checkout: root, sha: revision, tree },
        source: { checkout: source, sha: sourceSha, composeFile, project: run,
          applications: (["api", "worker", "web"] as const).map(service => ({ service, containerId: ids[service]!, imageId: owned(service).Image, imageReference: sourceImage })),
          stores: (["postgres", "minio", "redis"] as const).map(service => ({ service, containerId: ids[service]!, volumeName: owned(service).Mounts[0].Name, destination: service === "postgres" ? "/var/lib/postgresql/data" : "/data" })),
        }, candidate: { sha: revision, tree, imageId: candidateImage }, privateConfigPath: configFile, lockRoot: path.join(directory, "state"),
      };
      const observer = { docker, async observeDataIdentity() {
        return {
          postgres: exec("postgres", ["psql", "-U", "postgres", "-Atc", "select system_identifier::text || ':' || (select oid::text from pg_database where datname=current_database()) from pg_control_system()"]),
          objectStore: `${JSON.parse(exec("minio", ["cat", "/data/.minio.sys/format.json"])).id}:${exec("mc", ["mc", "stat", "--json", "fixture/isolated"])}`,
          redis: `${exec("redis", ["redis-cli", "INFO", "server"]).split("\n").find(line => line.startsWith("run_id:"))}:${exec("redis", ["redis-cli", "CONFIG", "GET", "appendonly"])}:db0:synthetic`,
        };
      } };
      const plan = await prepareHandoff(input, path.join(directory, "plan.json"), observer);
      expect(plan.observation.applications[0]?.imageReference).toBe(sourceImage);
      expect(git("-C", source, "rev-parse", "HEAD")).toBe(sourceSha);
      await expect(prepareHandoff(input, path.join(directory, "plan.json"), observer)).rejects.toThrow("plan-exists-or-unavailable");
      const opened = openCatalogUpgradeController({ runId: run, journalPath: path.join(directory, "journal.json"), cutover: {} as never, verification: {} as never });
      if (!opened.ok) throw new Error("fixture-controller-open-failed");
      expect((await executeHandoff(plan, plan.digest, { action: "inspect" }, { ...observer, controller: opened.value, withOperationLock: withHostOperationLock })).ok).toBe(true);
      await expect(inspectHandoff({ ...input, source: { ...input.source, project: "wrong-project" } }, observer)).rejects.toThrow("compose-container-mismatch");
      await expect(inspectHandoff({ ...input, source: { ...input.source, stores: input.source.stores.map(store => ({ ...store, volumeName: "wrong-volume" })) } }, observer)).rejects.toThrow("source-volume-mismatch");
      await writeFile(configFile, "SYNTHETIC_CONFIGURATION=changed\n", { mode: 0o600 });
      await expect(executeHandoff(plan, plan.digest, { action: "inspect" }, { ...observer, controller: opened.value, withOperationLock: withHostOperationLock })).rejects.toThrow("target-changed-after-plan");
      expect(JSON.parse(await readFile(path.join(directory, "journal.json"), "utf8")).entries).toEqual([]);
    } finally {
      if (composeAttempted) {
        const remaining = docker.command(["ps", "-aq", "--filter", `label=com.docker.compose.project=${run}`]).toString().trim().split("\n").filter(Boolean);
        for (const id of remaining) {
          const info = JSON.parse(docker.command(["inspect", id]).toString())[0];
          if (info.Config.Labels["com.docker.compose.project"] !== run || info.Config.Labels["com.docker.compose.project.config_files"] !== composeFile) throw new Error("cleanup-container-owner-mismatch");
          docker.command(["rm", "-f", "-v", info.Id]);
        }
        for (const kind of ["volume", "network"]) {
          const names = docker.command([kind, "ls", "-q", "--filter", `label=com.docker.compose.project=${run}`]).toString().trim().split("\n").filter(Boolean);
          for (const name of names) {
            const info = JSON.parse(docker.command([kind, "inspect", name]).toString())[0];
            if (info.Labels?.["com.docker.compose.project"] !== run) throw new Error("cleanup-resource-owner-mismatch");
            docker.command([kind, "rm", kind === "network" ? info.Id : info.Name]);
          }
        }
      }
      for (const reference of [sourceImage, candidateTag]) { try { docker.command(["image", "rm", reference]); } catch { /* Absent if setup failed before creation. */ } }
      if (worktree) {
        for (const file of [composeFile, path.join(source, "ops/self-hosted/.handoff-private.env")]) if (file) await rm(file, { force: true });
        git("worktree", "remove", source);
      }
      await rm(directory, { recursive: true, force: true });
    }
  }, 120000);
});

it("holds the existing shared operation lock for the complete callback and refuses concurrency", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handoff-lock-test-"));
  let entered!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  try {
    const first = withHostOperationLock(directory, async () => { entered(); await barrier; return "done"; });
    await started;
    await expect(withHostOperationLock(directory, async () => "must-not-enter")).rejects.toThrow("handoff-lock-unavailable");
    release();
    expect(await first).toBe("done");
    expect(await withHostOperationLock(directory, async () => "next")).toBe("next");
  } finally { release?.(); await rm(directory, { recursive: true, force: true }); }
});

it("refuses a mismatched handoff digest before lock, controller or target work", async () => {
  await expect(executeHandoff({ digest: "changed" } as never, "expected", { action: "execute" }, {
    withOperationLock: async () => { throw new Error("must-not-lock"); },
  } as never)).rejects.toThrow("handoff-plan-digest-mismatch");
});
