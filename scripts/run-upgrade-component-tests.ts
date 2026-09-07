import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile, open, access } from "node:fs/promises";
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
  "retirement-existing-pg16": { image: "postgres:16-alpine", files: ["server/modules/catalog-cutover/retirement/loginFence.integration.test.ts", "scripts/retirement-endpoint-supervision.docker.test.ts"], config: "vitest.upgrade-retirement.config.ts" },
  "bootstrap-credential-pg16": { image: "postgres:16-alpine", files: ["server/modules/catalog-cutover/retirement/bootstrapCredentialFence.integration.test.ts"], config: "vitest.upgrade-bootstrap-credential.config.ts" },
  "scripts-pgvector": { image: "pgvector/pgvector:pg16", files: [], config: "vitest.scripts.config.ts" },
  "server-pgvector": { image: "pgvector/pgvector:pg16", files: [], config: "vitest.server.config.ts" },
  "comparison-pgvector": { image: "pgvector/pgvector:pg16", files: ["server/modules/release-verification/comparison/aggregateComparisonCorpus.integration.test.ts"], config: "vitest.upgrade-comparison.config.ts" },
  "schema-doc": { image: "pgvector/pgvector:pg16", files: [], config: "", command: "schema-doc" },
  "docs-check": { image: "pgvector/pgvector:pg16", files: [], config: "", command: "docs-check" },
};

export type RetirementEndpoints = {
  ownerRunId: string; label: string; networkId: string; imageId: string;
  firstId: string; secondId: string; probeId: string; hostnameProbeId: string;
  firstUrl: string; secondUrl: string;
};
export type RetirementEndpointObservation = Omit<RetirementEndpoints, "firstUrl" | "secondUrl">;
export class RetirementEndpointCleanupError extends Error {
  constructor() { super("owned-retirement-endpoint-cleanup-incomplete"); }
}

/** This ledger owns only the three freshly named component-profile resources.
 * Creation acknowledgments are not the sole source of cleanup identity. */
export async function createOwnedComponentResources(options: {
  docker: ReturnType<typeof createIsolatedUpgradeDocker>; directory: string;
  imageId: string; run: string; password: string; bootstrapUser: string;
  isRedis: boolean; authorizeCreation: () => void;
}) {
  const { docker, directory, imageId, run, password, bootstrapUser, isRedis, authorizeCreation } = options;
  if (!/^conversion-[a-f0-9]{16}$/.test(run) || !/^sha256:[a-f0-9]{64}$/.test(imageId) ||
      !/^[a-f0-9]{48}$/.test(password) || !["postgres", "wiseeff"].includes(bootstrapUser)) throw new Error("owned-component-resource-input-invalid");
  const label = "wiseeff.upgrade.conversion";
  const resources = {
    network: { name: run, id: "", attempted: false },
    volume: { name: `${run}-data`, id: "", attempted: false },
    container: { name: `${run}-service`, id: "", attempted: false },
  };
  const plan = await open(path.join(directory, "component-resources-plan.json"), "wx", 0o600);
  try { await plan.writeFile(JSON.stringify({ run, label, imageId, resources })); await plan.sync(); }
  finally { await plan.close(); }
  const records = await open(path.join(directory, "component-resources-observed.jsonl"), "wx", 0o600);
  try {
    const parent = await open(directory, "r"); try { await parent.sync(); } finally { await parent.close(); }
  } catch (error) { await records.close(); throw error; }
  const verify = (kind: keyof typeof resources) => {
    const resource = resources[kind];
    if (kind === "volume" ? resource.id !== resource.name : !/^[a-f0-9]{64}$/.test(resource.id)) throw new Error("owned-component-resource-identity-unavailable");
    if (kind === "container") {
      const actual = docker.assertOwned(resource.id, label, run);
      if (actual.Name !== `/${resource.name}` || actual.Image !== imageId) throw new Error("owned-component-resource-identity-mismatch");
    } else {
      const actual = JSON.parse(docker.command([kind, "inspect", resource.id]).toString())[0];
      if (actual.Name !== resource.name || actual.Labels?.[label] !== run ||
          (kind === "network" && actual.Id !== resource.id)) throw new Error("owned-component-resource-identity-mismatch");
    }
  };
  const create = async (kind: keyof typeof resources, command: string[]) => {
    const resource = resources[kind];
    if (resource.attempted) throw new Error("owned-component-create-already-attempted");
    authorizeCreation(); resource.attempted = true;
    resource.id = docker.command(command).toString().trim();
    await records.writeFile(JSON.stringify({ kind, name: resource.name, id: resource.id }) + "\n");
    await records.sync();
    verify(kind);
    return resource.id;
  };
  return {
    network: () => create("network", ["network", "create", "--opt", "com.docker.network.bridge.enable_ip_masquerade=false", "--label", `${label}=${run}`, resources.network.name]),
    volume: () => {
      verify("network");
      return create("volume", ["volume", "create", "--label", `${label}=${run}`, resources.volume.name]);
    },
    async container() {
      if (!resources.network.id || !resources.volume.id) throw new Error("owned-component-prerequisite-unavailable");
      verify("network"); verify("volume");
      const args = ["run", "-d", "--name", resources.container.name, "--network", resources.network.id, "--label", `${label}=${run}`];
      if (isRedis) {
        await writeFile(path.join(directory, "redis.conf"), `bind 0.0.0.0\nappendonly yes\ndir /data\nrequirepass ${password}\n`, { mode: 0o600, flag: "wx" });
        args.push("--mount", `type=volume,source=${resources.volume.id},target=/data`, "--mount", `type=bind,source=${directory},target=/private,readonly`,
          "-p", "127.0.0.1::6379", "--entrypoint", "redis-server", imageId, "/private/redis.conf");
      } else args.push("-v", `${resources.volume.id}:/var/lib/postgresql/data`, "-e", `POSTGRES_PASSWORD=${password}`,
        "-e", `POSTGRES_USER=${bootstrapUser}`, "-e", "POSTGRES_DB=postgres", "-p", "127.0.0.1::5432", imageId);
      return create("container", args);
    },
    async cleanup() {
      let failed = false;
      for (const kind of ["container", "volume", "network"] as const) {
        const resource = resources[kind];
        if (!resource.attempted) continue;
        try {
          const lookup = kind === "container" ? ["ps", "-aq", "--no-trunc", "--filter", `name=^/${resource.name}$`]
            : [kind, "ls", "-q", ...(kind === "network" ? ["--no-trunc"] : []), "--filter", `name=^${resource.name}$`];
          const id = resource.id || docker.command(lookup).toString().trim();
          if (!id) continue;
          if (kind === "container") {
            const actual = docker.assertOwned(id, label, run);
            if (actual.Image !== imageId || actual.Name !== `/${resource.name}`) throw new Error();
            docker.command(["rm", "-f", "-v", id]);
          } else {
            const actual = JSON.parse(docker.command([kind, "inspect", id]).toString())[0];
            if (actual.Name !== resource.name || actual.Labels?.[label] !== run ||
                (kind === "network" && (actual.Id !== id || Object.keys(actual.Containers ?? {}).length))) throw new Error();
            docker.command([kind, "rm", id]);
          }
        } catch { failed = true; }
      }
      try { await records.close(); } catch { failed = true; }
      if (failed) throw new Error("owned-component-resource-cleanup-incomplete");
    },
  };
}

/** Supervising process owns every endpoint resource, including when body kills
 * the test child. Names/nonce/image are durably declared before any Docker create;
 * an unknown create acknowledgment is reconciled by that exact owned name. */
export async function withOwnedRetirementEndpoints<T>(options: {
  docker: ReturnType<typeof createIsolatedUpgradeDocker>; directory: string;
  imageId: string; password: string; authorizeCreation: () => void;
}, body: (endpoints: RetirementEndpoints) => Promise<T>): Promise<T> {
  const { docker, directory, imageId, password, authorizeCreation } = options;
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId) || !/^[a-f0-9]{48}$/.test(password)) throw new Error("owned-retirement-input-invalid");
  const ownerRunId = randomBytes(12).toString("hex"), label = "wiseeff.controlled-recovery-run";
  const networkName = `retirement-endpoint-${ownerRunId}`;
  const resources = ["first", "second", "probe", "hostname-probe"].map(kind => ({ kind, name: `${networkName}-${kind}`, id: "", attempted: false }));
  let networkId = "", networkAttempted = false;
  const planFile = await open(path.join(directory, "retirement-endpoints-plan.json"), "wx", 0o600);
  try {
    await planFile.writeFile(JSON.stringify({ ownerRunId, label, networkName, imageId, resources: resources.map(({ kind, name }) => ({ kind, name })) }));
    await planFile.sync();
  } finally { await planFile.close(); }
  const parent = await open(directory, "r"); try { await parent.sync(); } finally { await parent.close(); }
  const observations = await open(path.join(directory, "retirement-endpoints-observed.jsonl"), "wx", 0o600);
  const observedParent = await open(directory, "r"); try { await observedParent.sync(); } finally { await observedParent.close(); }
  const record = async (kind: string, id: string) => {
    await observations.writeFile(JSON.stringify({ kind, id }) + "\n");
    await observations.sync();
  };
  const ids = (kind: string) => resources.find(resource => resource.kind === kind)!.id;
  try {
    authorizeCreation(); networkAttempted = true;
    networkId = docker.command(["network", "create", "--driver", "bridge", "--opt", "com.docker.network.bridge.enable_ip_masquerade=false",
      "--label", `${label}=${ownerRunId}`, networkName]).toString().trim();
    await record("network", networkId);
    for (const resource of resources) {
      const database = resource.kind === "first" || resource.kind === "second";
      const alias = resource.kind === "first" ? "postgres" : resource.kind === "second" ? "other" : resource.kind === "probe" ? "api" : "hostname-probe";
      const args = ["create", "--name", resource.name, "--network", networkId, "--network-alias", alias, "--label", `${label}=${ownerRunId}`];
      if (database) args.push("--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw,size=268435456", "--env", `POSTGRES_PASSWORD=${password}`);
      else args.push("--entrypoint", "sleep");
      if (resource.kind === "hostname-probe") args.push("--hostname", "postgres");
      args.push(imageId); if (!database) args.push("infinity");
      authorizeCreation(); resource.attempted = true;
      resource.id = docker.command(args).toString().trim();
      await record(resource.kind, resource.id);
      docker.assertOwned(resource.id, label, ownerRunId);
      authorizeCreation(); docker.command(["start", resource.id]);
    }
    const endpoint = async (id: string) => {
      for (let attempt = 0; attempt < 40; attempt++) {
        authorizeCreation();
        const actual = docker.assertOwned(id, label, ownerRunId);
        const port = actual.NetworkSettings.Ports?.["5432/tcp"]?.[0];
        if (actual.State.Running && actual.Image === imageId && port?.HostIp === "127.0.0.1" && /^\d+$/.test(port.HostPort)) {
          try {
            docker.command(["exec", id, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]);
            return `postgres://postgres:${password}@127.0.0.1:${port.HostPort}/postgres`;
          } catch { /* Retry only readiness, never a creation or mutation. */ }
        }
        await setTimeout(100);
      }
      throw new Error("owned-retirement-endpoint-not-ready");
    };
    const firstUrl = await endpoint(ids("first")), secondUrl = await endpoint(ids("second"));
    authorizeCreation();
    return await body({ ownerRunId, label, networkId, imageId, firstId: ids("first"), secondId: ids("second"),
      probeId: ids("probe"), hostnameProbeId: ids("hostname-probe"), firstUrl, secondUrl });
  } finally {
    let failed = false;
    for (const resource of [...resources].reverse()) {
      if (!resource.attempted) continue;
      try {
        const found = resource.id || docker.command(["ps", "-aq", "--no-trunc", "--filter", `name=^/${resource.name}$`]).toString().trim();
        if (!found) continue;
        const actual = docker.assertOwned(found, label, ownerRunId);
        if (actual.Image !== imageId || actual.Name !== `/${resource.name}`) throw new Error();
        docker.command(["rm", "-f", "-v", found]);
      } catch { failed = true; }
    }
    if (networkAttempted) {
      try {
        const found = networkId || docker.command(["network", "ls", "-q", "--no-trunc", "--filter", `name=^${networkName}$`]).toString().trim();
        if (found) {
          const actual = JSON.parse(docker.command(["network", "inspect", found]).toString())[0];
          if (actual.Id !== found || actual.Name !== networkName || actual.Labels?.[label] !== ownerRunId || Object.keys(actual.Containers ?? {}).length) throw new Error();
          docker.command(["network", "rm", found]);
        }
      } catch { failed = true; }
    }
    try { await observations.close(); } catch { failed = true; }
    if (failed) throw new RetirementEndpointCleanupError();
  }
}

export function componentTestExecutable(name: string): string {
  if (!Object.hasOwn(suites, name)) throw new Error("unknown-upgrade-component-suite");
  return suites[name].command === "docs-check" ? "npm" : process.execPath;
}

/** The scripts lane keeps all frozen source-lock cases, in a separate process
 * before ordinary parallel suites. Other lanes retain their existing command. */
export function componentTestCommands(name: string): string[][] {
  if (!Object.hasOwn(suites, name)) throw new Error("unknown-upgrade-component-suite");
  const suite = suites[name];
  if (suite.command === "docs-check") return [["run", "docs:check", "--", "--require-database"]];
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
export function componentSupervisionLimits(input = { deadlineMs: 15 * 60_000, graceMs: 2000, outputBytes: 8 * 1024 * 1024 }) {
  const { deadlineMs, graceMs, outputBytes } = input;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 15 * 60_000 ||
      !Number.isSafeInteger(graceMs) || graceMs < 1 || graceMs > 2000 ||
      !Number.isSafeInteger(outputBytes) || outputBytes < 1 || outputBytes > 8 * 1024 * 1024) {
    throw new Error("component-supervision-limits-invalid");
  }
  return Object.freeze({ deadlineMs, graceMs, outputBytes });
}

export async function runUpgradeComponentTests(args: string[], observation?: {
  /** Fault injection can only shorten the production supervisor's limits. */
  limits?: { deadlineMs: number; graceMs: number; outputBytes: number };
  retirementEndpoints?: (value: RetirementEndpointObservation) => void;
}) {
  let limits: ReturnType<typeof componentSupervisionLimits>;
  try { limits = componentSupervisionLimits(observation?.limits); }
  catch { return { exitCode: 2, reason: "component-supervision-limits-invalid" }; }
  const hosted = args.length === 5 && args[4] === "--github-hosted";
  if ((!hosted && args.length !== 4) || args[0] !== "--expected-daemon-id" || !/^[a-zA-Z0-9-]+$/.test(args[1]) || args[2] !== "--suite" || !Object.hasOwn(suites, args[3])) {
    return { exitCode: 2, reason: "usage-expected-daemon-id-and-known-suite-required" };
  }
  // Registering a route does not authorize creating resources for an absent
  // component. Integration must supply the exact test/config before execution.
  if (["retirement-existing-pg16", "bootstrap-credential-pg16"].includes(args[3])) {
    try { for (const file of [...suites[args[3]].files, suites[args[3]].config]) await access(path.join(root, file)); }
    catch { return { exitCode: 2, reason: args[3] === "bootstrap-credential-pg16" ? "owned-bootstrap-component-unavailable" : "owned-retirement-component-unavailable" }; }
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
  let retainPrivateDirectory = false;
  const interrupt = () => { interrupted = true; supervisor?.stop(); };
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  let exitCode = 1;
  let stage = "network-create";
  let resources: Awaited<ReturnType<typeof createOwnedComponentResources>> | undefined;
  try {
    resources = await createOwnedComponentResources({ docker, directory, imageId: image.Id, run, password, bootstrapUser, isRedis,
      authorizeCreation: () => { if (interrupted) throw new Error("owned-component-supervisor-interrupted"); authorizeCreation(); } });
    // Only the selected data service runs here. An internal Docker network does not publish
    // its port on Docker Desktop; this owned bridge publishes loopback only.
    // This is not an application egress-isolation environment.
    net = await resources.network();
    stage = "volume-create";
    volume = await resources.volume();
    stage = "container-create";
    id = await resources.container();
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
    const runChildren = async (retirementEndpoints?: RetirementEndpoints) => {
    await writeFile(receipt, JSON.stringify({ id, net, run, label, daemonId: docker.daemonId, url, ...physical,
      profile,
      imageId: image.Id, dataVolume: { name: volume, createdAt: dataVolume.CreatedAt },
      ...(retirementEndpoints ? { retirementEndpoints } : {}) }), { mode: 0o600, flag: "wx" });
    // Splitting the scripts lane must not multiply its existing supervision
    // deadline/output budget or continue after a failed mandatory first stage.
    const deadlineAt = Date.now() + limits.deadlineMs;
    let outputRemaining = limits.outputBytes;
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
      supervisor = superviseComponentProcess(child, { deadlineMs: Math.max(1, deadlineAt - Date.now()), graceMs: limits.graceMs, outputBytes: outputRemaining });
      const { exitCode: status, output } = await supervisor.wait;
      outputRemaining -= Buffer.byteLength(output);
      process.stdout.write(output.split(url).join("[REDACTED_TEST_URL]").split(password).join("[REDACTED]"));
      exitCode = interrupted ? 1 : status;
      if (exitCode !== 0) break;
    }
    };
    if (args[3] === "retirement-existing-pg16") {
      await withOwnedRetirementEndpoints({ docker, directory, imageId: image.Id, password, authorizeCreation: () => {
        if (interrupted) throw new Error("owned-retirement-supervisor-interrupted");
        authorizeCreation();
      } }, async endpoints => {
        const { firstUrl: _firstUrl, secondUrl: _secondUrl, ...identity } = endpoints;
        observation?.retirementEndpoints?.(identity);
        await runChildren(endpoints);
      });
    } else await runChildren();
  } catch (error) {
    retainPrivateDirectory = error instanceof RetirementEndpointCleanupError;
    console.error(`upgrade-component-stage-failed:${stage}`);
    exitCode = 1;
  } finally {
    try { await resources?.cleanup(); }
    catch { retainPrivateDirectory = true; exitCode = 1; console.error("owned-component-resource-cleanup-incomplete"); }
    if (!retainPrivateDirectory) await rm(directory, { recursive: true });
    process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
  }
  console.log(JSON.stringify({ scope: "isolated-components-only", suite: args[3], imageReference: suite.image, imageId: image.Id, platform: `${image.Os}/${image.Architecture}`, containerId: id, networkId: net, exitCode, cleanupVerified: !retainPrivateDirectory, privateEvidenceRetained: retainPrivateDirectory, releaseApproved: false }));
  return { exitCode, reason: "isolated-components-only", childProcessId: child?.pid };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runUpgradeComponentTests(process.argv.slice(2)).then(result => {
    if (result.exitCode !== 0) console.error(result.reason);
    process.exitCode = result.exitCode;
  }).catch(() => { console.error("upgrade-component-runner-failed"); process.exitCode = 1; });
}
