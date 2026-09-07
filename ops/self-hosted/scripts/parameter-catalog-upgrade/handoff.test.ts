import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createIsolatedUpgradeDocker } from "../../../../scripts/isolated-upgrade-docker";
import { openCatalogUpgradeController } from "./controller";
import { executeHandoff, inspectHandoff, prepareHandoff, withHostOperationLock, type HandoffInputs, type HostOperationLock } from "./handoff";
import { readHandoffApplicationRequirement, assertHostOperationLockForJournal, verifyStoppedHandoff } from "./handoff";
import { bindingJournalPath, createBindingCutoverJournal } from "./bindingJournal";
import { commitJournalTransition, openUpgradeJournal } from "./journal";

it("rejects a structural stopped-handoff lock before observing any target", async () => {
  let observations = 0;
  const plan = { inputs: { journalPath: "/unobserved/journal.json" } } as Parameters<typeof verifyStoppedHandoff>[0];
  await expect(verifyStoppedHandoff(plan, "untrusted", {
    docker: { daemonId: "unobserved", command() { observations++; throw new Error("must-not-observe"); } },
    async observeDataIdentity() { observations++; throw new Error("must-not-observe"); },
  }, { async assertHeld() {} })).rejects.toThrow("handoff-lock-not-issued-for-journal");
  expect(observations).toBe(0);
});

it("resumes the exact stopped source only after the same journal durably completed P2", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "handoff-resume-")));
  const target = { systemIdentifier: "123", databaseOid: "45" };
  const runId = "handoff-resume";
  const planDigest = `sha256:${"a".repeat(64)}`;
  const journalPath = bindingJournalPath({ operationRoot: directory, target, runId });
  const inputs = { runId, journalPath, lockRoot: directory } as HandoffInputs;
  try {
    expect(readHandoffApplicationRequirement(inputs, "execute")).toBe("running");
    const opened = openUpgradeJournal({ journalPath, runId });
    if (!opened.ok) throw new Error("fixture-journal-failed");
    expect(commitJournalTransition(opened.value, { action: "plan", inputDigest: planDigest, planDigest, toState: "planned", nextAction: "execute" }).ok).toBe(true);
    const adapter = createBindingCutoverJournal({ operationRoot: directory, target, journal: opened.value });
    const attempt = await adapter.begin({ target, runId: "cutover-source", planDigest, phase: "P2", inputDigest: planDigest });
    expect(() => readHandoffApplicationRequirement(inputs, "resume")).toThrow("handoff-phase-outcome-unresolved");
    expect(readHandoffApplicationRequirement(inputs, "inspect")).toBe("observable");
    await adapter.finish({ attempt, outcome: "committed" });
    expect(readHandoffApplicationRequirement(inputs, "resume")).toBe("stopped");
    const later = await adapter.begin({ target, runId: "cutover-source", planDigest, phase: "P3", inputDigest: planDigest });
    await adapter.finish({ attempt: later, outcome: "unknown" });
    expect(() => readHandoffApplicationRequirement(inputs, "resume")).toThrow("handoff-phase-outcome-unresolved");
    expect(readHandoffApplicationRequirement(inputs, "recover")).toBe("observable");
    expect(() => readHandoffApplicationRequirement({ ...inputs, runId: "another-run" }, "execute")).toThrow("handoff-journal-unavailable");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

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
    const privateRoot = await realpath(directory);
    const repositorySecretRoot = path.join(root, "work", run);
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
      const lockRoot = path.join(privateRoot, "state");
      // The new custodian reader requires a private journal directory. Prepare
      // this fixture's newly owned directory; never relax the runtime check.
      await mkdir(lockRoot, { mode: 0o700 });
      const roleFiles = { WISEEFF_API_ENV_FILE: path.join(privateRoot, "api.env"), WISEEFF_WORKER_ENV_FILE: path.join(privateRoot, "worker.env"), WISEEFF_MANAGEMENT_ENV_FILE: path.join(privateRoot, "management.env") };
      for (const [key, file] of Object.entries(roleFiles)) await writeFile(file, `ROLE_PURPOSE=${key}\n`, { mode: 0o600 });
      const mainConfig = (roles = roleFiles) => `WISEEFF_OPERATION_LOCK_DIR=${lockRoot}\n${Object.entries(roles).map(([key, file]) => `${key}=${file}`).join("\n")}\nSYNTHETIC_CONFIGURATION=first\n`;
      await writeFile(configFile, mainConfig(), { mode: 0o600 });
      const input: HandoffInputs = {
        runId: run, expectedDaemonId: docker.daemonId, entrypoint: { checkout: root, sha: revision, tree },
        source: { checkout: source, sha: sourceSha, composeFile, project: run,
          applications: (["api", "worker", "web"] as const).map(service => ({ service, containerId: ids[service]!, imageId: owned(service).Image, imageReference: sourceImage })),
          stores: (["postgres", "minio", "redis"] as const).map(service => ({ service, containerId: ids[service]!, volumeName: owned(service).Mounts[0].Name, destination: service === "postgres" ? "/var/lib/postgresql/data" : "/data" })),
        }, candidate: { checkout: root, sha: revision, tree, imageId: candidateImage }, privateConfigPath: await realpath(configFile), lockRoot, journalPath: path.join(lockRoot, "journal.json"),
      };
      const observer = { docker, async observeDataIdentity() {
        return {
          postgres: exec("postgres", ["psql", "-U", "postgres", "-Atc", "select system_identifier::text || ':' || (select oid::text from pg_database where datname=current_database()) from pg_control_system()"]),
          objectStore: `${JSON.parse(exec("minio", ["cat", "/data/.minio.sys/format.json"])).id}:${exec("mc", ["mc", "ls", "--json", "fixture"])}:${exec("mc", ["mc", "version", "info", "fixture/isolated"])}`,
          redis: `${exec("redis", ["redis-cli", "INFO", "server"]).split("\n").find(line => line.startsWith("run_id:"))}:${exec("redis", ["redis-cli", "CONFIG", "GET", "appendonly"])}:db0:synthetic`,
        };
      } };
      const plan = await prepareHandoff(input, path.join(directory, "plan.json"), observer);
      // Return only the typed reason on unexpected acceptance; never dump a plan
      // containing private paths or live resource metadata into assertion output.
      const refusal = async (operation: Promise<unknown>) => operation.then(() => "unexpected-success", error => error instanceof Error ? error.message : "unknown-error");
      for (const [key, file] of Object.entries(roleFiles)) {
        expect(plan.observation.privateConfigurations.runtime[key]).toEqual({ path: file, device: expect.any(String), inode: expect.any(String), digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) });
      }
      expect(JSON.stringify(plan)).not.toContain("ROLE_PURPOSE=");
      await mkdir(repositorySecretRoot, { recursive: true, mode: 0o700 });
      for (const basename of ["management.env", "custom-name"]) {
        const repositoryManagement = path.join(repositorySecretRoot, basename);
        await writeFile(repositoryManagement, "DATABASE_URL=must-not-enter-image\n", { mode: 0o600 });
        await writeFile(configFile, mainConfig({ ...roleFiles, WISEEFF_MANAGEMENT_ENV_FILE: repositoryManagement }), { mode: 0o600 });
        expect(await refusal(inspectHandoff(input, observer))).toBe("handoff-private-file-inside-build-checkout");
      }
      const repositoryMain = path.join(repositorySecretRoot, "host-config");
      await writeFile(repositoryMain, mainConfig(), { mode: 0o600 });
      expect(await refusal(inspectHandoff({ ...input, privateConfigPath: repositoryMain }, observer))).toBe("handoff-private-file-inside-build-checkout");
      const alias = path.join(privateRoot, "management-alias");
      await symlink(roleFiles.WISEEFF_MANAGEMENT_ENV_FILE, alias);
      await writeFile(configFile, mainConfig({ ...roleFiles, WISEEFF_MANAGEMENT_ENV_FILE: alias }), { mode: 0o600 });
      expect(await refusal(inspectHandoff(input, observer))).toBe("handoff-private-file-path-alias");
      await rm(alias);
      await writeFile(configFile, mainConfig({ ...roleFiles, WISEEFF_MANAGEMENT_ENV_FILE: roleFiles.WISEEFF_API_ENV_FILE }), { mode: 0o600 });
      expect(await refusal(inspectHandoff(input, observer))).toBe("handoff-private-file-alias");
      await writeFile(configFile, mainConfig(), { mode: 0o600 });
      await link(roleFiles.WISEEFF_MANAGEMENT_ENV_FILE, alias);
      expect(await refusal(inspectHandoff(input, observer))).toBe("handoff-file-not-secure");
      await rm(alias);
      for (const mode of [0o644, 0o700]) {
        await chmod(roleFiles.WISEEFF_MANAGEMENT_ENV_FILE, mode);
        expect(await refusal(inspectHandoff(input, observer))).toBe("handoff-file-not-secure");
      }
      await chmod(roleFiles.WISEEFF_MANAGEMENT_ENV_FILE, 0o600);
      await writeFile(roleFiles.WISEEFF_MANAGEMENT_ENV_FILE, Buffer.alloc(1024 * 1024 + 1, 65));
      expect(await refusal(inspectHandoff(input, observer))).toBe("handoff-file-not-secure");
      await writeFile(roleFiles.WISEEFF_MANAGEMENT_ENV_FILE, "ROLE_PURPOSE=WISEEFF_MANAGEMENT_ENV_FILE\n");
      for (const key of ["WISEEFF_API_ENV_FILE", "WISEEFF_WORKER_ENV_FILE"] as const) {
        for (const mode of ["development", "test", ""]) {
          await writeFile(roleFiles[key], `ROLE_PURPOSE=${key}\nNODE_ENV=${mode}\n`);
          expect(await refusal(inspectHandoff(input, observer))).toBe("handoff-runtime-production-mode-required");
        }
        await writeFile(roleFiles[key], `ROLE_PURPOSE=${key}\nNODE_ENV=production\n`);
        await expect(inspectHandoff(input, observer)).resolves.toBeDefined();
        await writeFile(roleFiles[key], `ROLE_PURPOSE=${key}\n`);
      }
      await writeFile(configFile, mainConfig({ ...roleFiles, WISEEFF_MANAGEMENT_ENV_FILE: "" }), { mode: 0o600 });
      expect(await refusal(inspectHandoff(input, observer))).toBe("handoff-runtime-config-path-required");
      for (const script of ["#!/bin/sh\n", "DANGER=$(touch must-not-exist)\n", "source /private/config\n"]) {
        await writeFile(configFile, `${mainConfig()}${script}`, { mode: 0o600 });
        expect(await refusal(inspectHandoff(input, observer))).toBe("handoff-private-config-not-data-only");
      }
      await writeFile(configFile, mainConfig(), { mode: 0o600 });
      expect(await refusal(inspectHandoff({ ...input, candidate: { ...input.candidate, checkout: source } }, observer))).toBe("handoff-candidate-checkout-artifact-mismatch");
      expect(plan.observation.applications[0]?.imageReference).toBe(sourceImage);
      expect(git("-C", source, "rev-parse", "HEAD")).toBe(sourceSha);
      await expect(prepareHandoff(input, path.join(directory, "plan.json"), observer)).rejects.toThrow("plan-exists-or-unavailable");
      const openController = (binding: { runId: string; journalPath: string }) => {
        const opened = openCatalogUpgradeController({ ...binding, cutover: {} as never, verification: {} as never });
        if (!opened.ok) throw new Error("fixture-controller-open-failed");
        return opened.value;
      };
      expect((await executeHandoff(plan, plan.digest, { action: "inspect" }, { ...observer, openController, withOperationLock: withHostOperationLock })).ok).toBe(true);
      const mutableCommand = { action: "inspect" };
      const dispatched: string[] = [];
      const fixedResult = await executeHandoff(plan, plan.digest, mutableCommand, {
        ...observer,
        async observeDataIdentity() {
          const identity = await observer.observeDataIdentity();
          mutableCommand.action = "execute";
          return identity;
        },
        openController(binding) {
          const controller = openController(binding);
          return { dispatch(command) { dispatched.push(command.action); return controller.dispatch(command); } };
        },
        withOperationLock: withHostOperationLock,
      });
      expect(dispatched).toEqual(["inspect"]);
      expect(fixedResult.ok).toBe(true);
      for (const service of ["api", "worker", "web"]) owned(service);
      compose("stop", "api", "worker", "web");
      await withHostOperationLock(lockRoot, async lock => {
        await expect(verifyStoppedHandoff(plan, plan.digest, observer, lock)).resolves.toEqual(plan.observation);
        expect(await refusal(verifyStoppedHandoff(plan, "wrong-digest", observer, lock))).toBe("handoff-plan-digest-mismatch");
        const changed = { ...observer, async observeDataIdentity() {
          return { ...await observer.observeDataIdentity(), redis: "different-observed-redis" };
        } };
        expect(await refusal(verifyStoppedHandoff(plan, plan.digest, changed, lock))).toBe("handoff-target-changed-after-plan");
        const sharedObserver = { ...observer, async observeDataIdentity() {
          const actual = await observer.observeDataIdentity();
          const shared = { ...actual, redis: "observed-drift" };
          setImmediate(() => { shared.redis = actual.redis; });
          return shared;
        } };
        expect(await refusal(verifyStoppedHandoff(plan, plan.digest, sharedObserver, lock))).toBe("handoff-target-changed-after-plan");
      });
      expect((await executeHandoff(plan, plan.digest, { action: "inspect" }, { ...observer, openController, withOperationLock: withHostOperationLock })).ok).toBe(true);
      expect(await refusal(executeHandoff(plan, plan.digest, { action: "resume" }, { ...observer, openController, withOperationLock: withHostOperationLock }))).toBe("handoff-source-running-artifact-mismatch");
      for (const service of ["api", "worker", "web"]) owned(service);
      compose("start", "api", "worker", "web");
      await withHostOperationLock(lockRoot, async lock => {
        expect(await refusal(verifyStoppedHandoff(plan, plan.digest, observer, lock))).toBe("handoff-source-writer-not-stopped");
      });
      let controllerOpened = false;
      for (const [key, file] of Object.entries(roleFiles)) {
        await writeFile(file, `ROLE_PURPOSE=${key}\nCONFIGURATION_CHANGED=true\n`);
        expect(await refusal(executeHandoff(plan, plan.digest, { action: "inspect" }, { ...observer, openController: () => { controllerOpened = true; throw new Error("must-not-open-controller"); }, withOperationLock: withHostOperationLock }))).toBe("handoff-target-changed-after-plan");
        await writeFile(file, `ROLE_PURPOSE=${key}\n`);
      }
      expect(controllerOpened).toBe(false);
      await expect(inspectHandoff({ ...input, source: { ...input.source, project: "wrong-project" } }, observer)).rejects.toThrow("compose-container-mismatch");
      await expect(inspectHandoff({ ...input, source: { ...input.source, stores: input.source.stores.map(store => ({ ...store, volumeName: "wrong-volume" })) } }, observer)).rejects.toThrow("source-volume-mismatch");
      await writeFile(configFile, `${mainConfig()}CHANGED_CONFIGURATION=true\n`, { mode: 0o600 });
      await expect(executeHandoff(plan, plan.digest, { action: "inspect" }, { ...observer, openController, withOperationLock: withHostOperationLock })).rejects.toThrow("target-changed-after-plan");
      expect(JSON.parse(await readFile(input.journalPath, "utf8")).entries).toEqual([]);
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
      await rm(repositorySecretRoot, { recursive: true, force: true });
    }
  }, 120000);
});

it("holds the existing shared operation lock for the complete callback and refuses concurrency", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handoff-lock-test-"));
  let entered!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  try {
    const first = withHostOperationLock(directory, async lock => {
      await Promise.all([lock.assertHeld(), lock.assertHeld()]);
      entered(); await barrier;
      await lock.assertHeld();
      return "done";
    });
    await started;
    await expect(withHostOperationLock(directory, async () => "must-not-enter")).rejects.toThrow("handoff-lock-unavailable");
    release();
    expect(await first).toBe("done");
    expect(await withHostOperationLock(directory, async () => "next")).toBe("next");
  } finally { release?.(); await rm(directory, { recursive: true, force: true }); }
});

it("invalidates a released lock handle even when a new holder acquires the same path", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handoff-lock-expired-"));
  let previous!: HostOperationLock;
  try {
    await withHostOperationLock(directory, async lock => { previous = lock; await lock.assertHeld(); });
    await withHostOperationLock(directory, async current => {
      await current.assertHeld();
      await expect(previous.assertHeld()).rejects.toThrow("handoff-lock-lost");
    });
    await expect(withHostOperationLock(directory, async () => { throw new Error("effect-refused"); })).rejects.toThrow("effect-refused");
    expect(await withHostOperationLock(directory, async lock => { await lock.assertHeld(); return "reacquired"; })).toBe("reacquired");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("binds recovery journal ownership to the exact issued private directory", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "handoff-journal-owner-")));
  const nested = path.join(directory, "nested"), alias = `${directory}-alias`;
  try {
    await mkdir(nested, { mode: 0o700 });
    await symlink(directory, alias, "dir");
    await withHostOperationLock(directory, async lock => {
      await expect(assertHostOperationLockForJournal(lock, path.join(directory, "run.json"))).resolves.toBeUndefined();
      for (const invalid of ["run.json", `${directory}/nested/../run.json`, path.join(nested, "run.json"), path.join(alias, "run.json")]) {
        await expect(assertHostOperationLockForJournal(lock, invalid)).rejects.toThrow("lock-not-issued-for-journal");
      }
      await withHostOperationLock(nested, async nestedLock => {
        await expect(assertHostOperationLockForJournal(nestedLock, path.join(alias, "nested", "run.json")))
          .rejects.toThrow("lock-not-issued-for-journal");
      });
    });
  } finally {
    await rm(alias, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

it("refuses the next effect after the actual lock holder exits and finishes cleanup", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "handoff-lock-loss-"));
  const effects: string[] = [];
  try {
    const outcome = withHostOperationLock(directory, async lock => {
      const owner = await readFile(path.join(directory, ".operation.lock.owner"), "utf8")
        .catch(() => readFile(path.join(directory, ".operation.lock.d", "owner"), "utf8"));
      const pid = /^pid=([0-9]+)$/m.exec(owner)?.[1];
      if (!pid || !owner.includes("operation=catalog-handoff\n")) throw new Error("fixture-lock-owner-unavailable");
      effects.push("first-effect");
      // Only terminate the holder created by this invocation in its unique directory.
      process.kill(Number(pid), "SIGTERM");
      await setTimeout(50);
      await lock.assertHeld();
      effects.push("must-not-run-next-effect");
    }).then(() => "unexpected-success", error => error instanceof Error ? error.message : "unknown-error");
    // A bounded observation also catches the old cleanup waiting for an exit already delivered.
    expect(await Promise.race([outcome, setTimeout(2000, "cleanup-did-not-finish")])).toBe("handoff-lock-lost");
    expect(effects).toEqual(["first-effect"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("refuses a mismatched handoff digest before lock, controller or target work", async () => {
  await expect(executeHandoff({ digest: "changed" } as never, "expected", { action: "execute" }, {
    withOperationLock: async () => { throw new Error("must-not-lock"); },
  } as never)).rejects.toThrow("handoff-plan-digest-mismatch");
});
