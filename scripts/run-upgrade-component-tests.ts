import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { createIsolatedUpgradeDocker } from "./isolated-upgrade-docker";
import { admitHostedUpgradeComponents, assertHostedUpgradeAdmission, type HostedUpgradeAdmission } from "./upgrade-hosted-admission";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindingFiles = ["server/modules/parameter-bindings/cutoverImport/import.integration.test.ts", "server/modules/catalog-cutover/archive/adapter.test.ts", "server/modules/catalog-cutover/archive/adapter.integration.test.ts", "server/modules/catalog-cutover/bindingImportProducer.integration.test.ts", "server/modules/catalog-cutover/conversionManifest.integration.test.ts", "server/modules/catalog-cutover/orchestrator.test.ts", "server/modules/catalog-cutover/runtimeState.test.ts", "server/modules/catalog-cutover/sourceSnapshot.test.ts", "server/modules/catalog-cutover/managementStructure.test.ts"];
const suites: Record<string, { image: string; files: readonly string[]; config: string; command?: "schema-doc" | "docs-check" }> = {
  bindings: { image: "pgvector/pgvector:pg16", files: bindingFiles, config: "vitest.upgrade-cutover.config.ts" },
  "bindings-pg16": { image: "postgres:16-alpine", files: bindingFiles, config: "vitest.upgrade-cutover.config.ts" },
  "reader-pg16": { image: "postgres:16-alpine", files: ["server/modules/catalog-kernel/security/catalogReader.integration.test.ts"], config: "vitest.upgrade-cutover.config.ts" },
  "activation-existing-pg16": { image: "postgres:16-alpine", files: ["server/modules/catalog-cutover/activation/activation.integration.test.ts"], config: "vitest.upgrade-cutover.config.ts" },
  "report-pg16": { image: "postgres:16-alpine", files: ["server/modules/release-verification/startup/reportConnection.integration.test.ts"], config: "vitest.upgrade-cutover.config.ts" },
  "authority-pg16": { image: "postgres:16-alpine", files: ["ops/self-hosted/scripts/parameter-catalog-upgrade/deploymentAuthority.integration.test.ts"], config: "vitest.upgrade-cutover.config.ts" },
  "log-redis": { image: "redis:7-alpine", files: ["server/modules/logs/logAnalysisQueueRuntime.redis.integration.test.ts"], config: "vitest.upgrade-redis.config.ts" },
  "scripts-pgvector": { image: "pgvector/pgvector:pg16", files: [], config: "vitest.scripts.config.ts" },
  "server-pgvector": { image: "pgvector/pgvector:pg16", files: [], config: "vitest.server.config.ts" },
  "schema-doc": { image: "pgvector/pgvector:pg16", files: [], config: "", command: "schema-doc" },
  "docs-check": { image: "pgvector/pgvector:pg16", files: [], config: "", command: "docs-check" },
};

export function componentTestExecutable(name: string): string {
  if (!Object.hasOwn(suites, name)) throw new Error("unknown-upgrade-component-suite");
  return suites[name].command === "docs-check" ? "npm" : process.execPath;
}

/** The scripts lane keeps all frozen source-lock cases, in a separate process
 * before ordinary parallel suites. Other lanes retain their existing command. */
export function componentTestCommands(name: string): string[][] {
  if (!Object.hasOwn(suites, name)) throw new Error("unknown-upgrade-component-suite");
  const suite = suites[name];
  if (suite.command === "docs-check") return [["run", "docs:check"]];
  if (suite.command === "schema-doc") return [["--import", "tsx", path.join(root, "scripts/generate-db-schema-doc.ts")]];
  const vitest = path.join(root, "node_modules/vitest/vitest.mjs");
  const commands = [[vitest, "run", "--config", suite.config, ...suite.files]];
  if (name === "scripts-pgvector") commands.unshift([vitest, "run", "--config", "vitest.scripts-source-lock.config.ts"]);
  return commands;
}

/** The child owns its process group. Deadline/output limits cannot authorize a pass. */
export function superviseComponentProcess(child: ReturnType<typeof spawn>, limits = { deadlineMs: 15 * 60_000, graceMs: 2000, outputBytes: 8 * 1024 * 1024 }) {
  let output = ""; let bytes = 0; let stopped = false;
  let closed = false; let killed = false; let status: number | null = null;
  let finish = () => {};
  let escalation: ReturnType<typeof globalThis.setTimeout> | undefined;
  const signal = (name: NodeJS.Signals) => {
    try { if (child.pid) process.kill(-child.pid, name); } catch { /* Already exited. */ }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true; signal("SIGTERM");
    escalation = globalThis.setTimeout(() => { signal("SIGKILL"); killed = true; finish(); }, limits.graceMs);
  };
  const deadline = globalThis.setTimeout(stop, limits.deadlineMs);
  const append = (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > limits.outputBytes) { stop(); return; }
    output += chunk.toString();
  };
  child.stdout!.on("data", append); child.stderr!.on("data", append);
  const wait = new Promise<{ exitCode: number; output: string }>((resolve, reject) => {
    const clear = () => { globalThis.clearTimeout(deadline); if (escalation) globalThis.clearTimeout(escalation); };
    child.once("error", error => { clear(); reject(error); });
    finish = () => {
      // A terminated leader may leave children with closed stdio in its group.
      // Do not cancel escalation until the whole group has received SIGKILL.
      if (!closed || (stopped && !killed)) return;
      clear(); resolve({ exitCode: stopped ? 1 : status ?? 1, output });
    };
    child.once("close", code => { closed = true; status = code; finish(); });
  });
  return { stop, wait };
}

/** Observe executable source, including migrations discovered by directory scan. */
export function observeCleanUpgradeCheckout(directory: string): string {
  const options = { cwd: directory, encoding: "utf8" as const,
    env: { PATH: process.env.PATH, HOME: process.env.HOME }, timeout: 10000 };
  const git = spawnSync("git", ["rev-parse", "HEAD"], options);
  const clean = spawnSync("git", ["diff-index", "--quiet", "HEAD", "--"], options);
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], options);
  if (git.status !== 0 || git.error || clean.status !== 0 || clean.error ||
      untracked.status !== 0 || untracked.error || untracked.stdout.length !== 0) {
    throw new Error("upgrade-hosted-checkout-unavailable");
  }
  return git.stdout.trim();
}

/** Developer component runner, never a deployment upgrade or release approval.
 * Owns a fresh cluster/network/credential; accepts no database URL or backup. */
export async function runUpgradeComponentTests(args: string[]) {
  const hosted = args.length === 5 && args[4] === "--github-hosted";
  if ((!hosted && args.length !== 4) || args[0] !== "--expected-daemon-id" || !/^[a-zA-Z0-9-]+$/.test(args[1]) || args[2] !== "--suite" || !Object.hasOwn(suites, args[3])) {
    return { exitCode: 2, reason: "usage-expected-daemon-id-and-known-suite-required" };
  }
  const docker = createIsolatedUpgradeDocker();
  if (docker.daemonId !== args[1] || (!hosted && docker.command(["info", "--format", "{{.ID}}|{{.Name}}|{{.OperatingSystem}}"] ).toString().trim() !== `${args[1]}|docker-desktop|Docker Desktop`)) {
    return { exitCode: 2, reason: "explicit-development-daemon-required" };
  }
  const observeHosted = () => {
    return { checkoutSha: observeCleanUpgradeCheckout(root), daemonId: docker.command(["info", "--format", "{{.ID}}"] ).toString().trim(),
      workflowRef: process.env.GITHUB_WORKFLOW_REF ?? "", runId: process.env.GITHUB_RUN_ID ?? "", runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "" };
  };
  let admission: HostedUpgradeAdmission | undefined;
  if (hosted) admission = await admitHostedUpgradeComponents(observeHosted(), {
    ACTIONS_ID_TOKEN_REQUEST_URL: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
  }, observeHosted);
  const authorizeCreation = () => { if (hosted) assertHostedUpgradeAdmission(admission!, observeHosted()); };
  const suite = suites[args[3] as keyof typeof suites];
  const isRedis = args[3] === "log-redis";
  const profile = isRedis ? "selfhost-redis7-aof-v1" : suite.image === "postgres:16-alpine" ? "selfhost-postgres16-alpine-v1" : "catalog-pgvector-v1";
  // Frozen rehearsal CLI fixtures use their historical bootstrap login. It is
  // confined to this newly created cluster, never an application identity.
  const bootstrapUser = args[3] === "scripts-pgvector" ? "wiseeff" : "postgres";
  if (hosted) {
    // Registry acquisition also uses the authenticated job and pinned local
    // daemon, never an ambient shell Docker context before host admission.
    authorizeCreation();
    docker.command(["pull", suite.image]);
  }
  const image = JSON.parse(docker.command(["image", "inspect", suite.image]).toString())[0];
  const run = `conversion-${randomBytes(8).toString("hex")}`;
  const label = "wiseeff.upgrade.conversion";
  const password = randomBytes(24).toString("hex");
  const directory = await mkdtemp(path.join(await realpath(os.tmpdir()), "upgrade-components-"));
  let id = ""; let net = ""; let volume = ""; let child: ReturnType<typeof spawn> | undefined;
  let supervisor: ReturnType<typeof superviseComponentProcess> | undefined;
  let interrupted = false;
  const interrupt = () => { interrupted = true; supervisor?.stop(); };
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  let exitCode = 1;
  let stage = "network-create";
  try {
    // Only the selected data service runs here. An internal Docker network does not publish
    // its port on Docker Desktop; this owned bridge publishes loopback only.
    // This is not an application egress-isolation environment.
    authorizeCreation();
    net = docker.command(["network", "create", "--opt", "com.docker.network.bridge.enable_ip_masquerade=false", "--label", `${label}=${run}`, run]).toString().trim();
    stage = "volume-create";
    authorizeCreation();
    volume = docker.command(["volume", "create", "--label", `${label}=${run}`, `${run}-data`]).toString().trim();
    stage = "container-create";
    authorizeCreation();
    if (isRedis) {
      await writeFile(path.join(directory, "redis.conf"), `bind 0.0.0.0\nappendonly yes\ndir /data\nrequirepass ${password}\n`, { mode: 0o600, flag: "wx" });
      authorizeCreation();
      id = docker.command(["run", "-d", "--network", net, "--label", `${label}=${run}`, "--mount", `type=volume,source=${volume},target=/data`,
        "--mount", `type=bind,source=${directory},target=/private,readonly`, "-p", "127.0.0.1::6379", "--entrypoint", "redis-server", image.Id, "/private/redis.conf"]).toString().trim();
    } else {
      id = docker.command(["run", "-d", "--network", net, "--label", `${label}=${run}`, "-v", `${volume}:/var/lib/postgresql/data`, "-e", `POSTGRES_PASSWORD=${password}`, "-e", `POSTGRES_USER=${bootstrapUser}`, "-e", "POSTGRES_DB=postgres", "-p", "127.0.0.1::5432", image.Id]).toString().trim();
    }
    const redisCommand = (args: string[]) => docker.command(["exec", id, "sh", "-c",
      'export REDISCLI_AUTH="$(awk \'$1 == "requirepass" {print $2}\' /private/redis.conf)"; exec redis-cli --raw "$@"', "redis-probe", ...args]).toString().trim();
    stage = "container-port-observation";
    let port: string | undefined;
    for (let n = 0; n < 40 && !interrupted; n++) {
      const owned = docker.assertOwned(id, label, run);
      const published = owned.NetworkSettings.Ports?.[isRedis ? "6379/tcp" : "5432/tcp"]?.[0];
      if (owned.State.Running && published?.HostIp === "127.0.0.1" && /^\d+$/.test(published.HostPort)) { port = published.HostPort; break; }
      await setTimeout(200);
    }
    if (!port) throw new Error("owned-service-port-unavailable");
    const url = isRedis ? `redis://:${password}@127.0.0.1:${port}` : `postgres://${bootstrapUser}:${password}@127.0.0.1:${port}/postgres`;
    stage = "database-readiness";
    let ready = false;
    for (let n = 0; n < 40 && !interrupted; n++) {
      docker.assertOwned(id, label, run);
      try {
        if (isRedis) { if (redisCommand(["PING"]) !== "PONG") throw new Error("redis-not-ready"); }
        else docker.command(["exec", id, "pg_isready", "-h", "127.0.0.1", "-U", bootstrapUser]);
        ready = true; break;
      }
      catch { await setTimeout(200); }
    }
    if (!ready || interrupted) throw new Error("owned-service-not-ready");
    if (suite.image === "pgvector/pgvector:pg16") {
      stage = "owned-vector-preparation";
      docker.assertOwned(id, label, run);
      docker.command(["exec", id, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", bootstrapUser, "-d", "postgres", "-c", "create extension vector"]);
    }
    stage = "receipt-and-tests";
    const receipt = path.join(directory, "target.json");
    const physical = isRedis ? { redisRunId: /^run_id:([a-f0-9]{40})\r?$/m.exec(redisCommand(["INFO", "server"]))?.[1] }
      : JSON.parse(docker.command(["exec", id, "psql", "-X", "-U", bootstrapUser, "-d", "postgres", "-Atc", "select json_build_object('systemIdentifier',system_identifier::text,'databaseOid',(select oid::text from pg_database where datname=current_database()),'databaseProperties',(select row_to_json(p) from (select encoding,datcollate,datctype,datlocprovider,daticulocale,daticurules,datcollversion,datconnlimit,datallowconn,datistemplate from pg_database where datname=current_database()) p)) from pg_control_system()"]).toString());
    if (isRedis && !physical.redisRunId) throw new Error("owned-redis-identity-unavailable");
    console.log(JSON.stringify({ evidence: "owned-service-profile", profile, imageId: image.Id, databaseProperties: physical.databaseProperties }));
    const dataVolume = JSON.parse(docker.command(["volume", "inspect", volume]).toString())[0];
    await writeFile(receipt, JSON.stringify({ id, net, run, label, daemonId: docker.daemonId, url, ...physical,
      profile,
      imageId: image.Id, dataVolume: { name: volume, createdAt: dataVolume.CreatedAt } }), { mode: 0o600, flag: "wx" });
    // Splitting the scripts lane must not multiply its existing supervision
    // deadline/output budget or continue after a failed mandatory first stage.
    const deadlineAt = Date.now() + 15 * 60_000;
    let outputRemaining = 8 * 1024 * 1024;
    for (const command of componentTestCommands(args[3])) {
      if (interrupted || Date.now() >= deadlineAt || outputRemaining <= 0) { exitCode = 1; break; }
      child = spawn(componentTestExecutable(args[3]), command, {
        cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME,
          // Frozen rehearsal cleanup refuses symlink parents (macOS /tmp).
          // Use this run's canonical private directory, never ambient TMPDIR.
          TMPDIR: directory,
          DOCKER_HOST: docker.endpoint,
          ...(isRedis ? { UPG_REDIS_TARGET_RECEIPT: receipt, UPG_EXPECTED_DOCKER_DAEMON_ID: docker.daemonId }
            : { WAYFINDER_POSTGRES_CONTAINER: id, UPG_TEST_TARGET_RECEIPT: receipt, DATABASE_URL: url, TEST_DATABASE_URL: url }),
          UPG_COMPONENT_PROFILE: profile },
        stdio: ["ignore", "pipe", "pipe"], detached: true,
      });
      supervisor = superviseComponentProcess(child, { deadlineMs: Math.max(1, deadlineAt - Date.now()), graceMs: 2000, outputBytes: outputRemaining });
      const { exitCode: status, output } = await supervisor.wait;
      outputRemaining -= Buffer.byteLength(output);
      process.stdout.write(output.split(url).join("[REDACTED_TEST_URL]").split(password).join("[REDACTED]"));
      exitCode = interrupted ? 1 : status;
      if (exitCode !== 0) break;
    }
  } catch {
    console.error(`upgrade-component-stage-failed:${stage}`);
    exitCode = 1;
  } finally {
    // Each destructive cleanup is constrained to the exact newly created object.
    if (id) { docker.assertOwned(id, label, run); docker.command(["rm", "-f", "-v", id]); }
    if (volume) {
      const found = JSON.parse(docker.command(["volume", "inspect", volume]).toString())[0];
      if (found.Name !== volume || found.Labels?.[label] !== run) throw new Error("owned-volume-mismatch");
      docker.command(["volume", "rm", volume]);
    }
    if (net) {
      const found = JSON.parse(docker.command(["network", "inspect", net]).toString())[0];
      if (found.Id !== net || found.Labels?.[label] !== run) throw new Error("owned-network-mismatch");
      docker.command(["network", "rm", net]);
    }
    await rm(directory, { recursive: true });
    process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
  }
  console.log(JSON.stringify({ scope: "isolated-components-only", suite: args[3], imageReference: suite.image, imageId: image.Id, platform: `${image.Os}/${image.Architecture}`, containerId: id, networkId: net, exitCode, cleanupVerified: true, releaseApproved: false }));
  return { exitCode, reason: "isolated-components-only" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runUpgradeComponentTests(process.argv.slice(2)).then(result => {
    if (result.exitCode !== 0) console.error(result.reason);
    process.exitCode = result.exitCode;
  }).catch(() => { console.error("upgrade-component-runner-failed"); process.exitCode = 1; });
}
