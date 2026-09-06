import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { createIsolatedUpgradeDocker } from "./isolated-upgrade-docker";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suites = {
  bindings: ["server/modules/parameter-bindings/cutoverImport/import.integration.test.ts", "server/modules/catalog-cutover/archive/adapter.test.ts", "server/modules/catalog-cutover/archive/adapter.integration.test.ts", "server/modules/catalog-cutover/bindingImportProducer.integration.test.ts", "server/modules/catalog-cutover/conversionManifest.integration.test.ts", "server/modules/catalog-cutover/orchestrator.test.ts"],
} as const;

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

/** Developer component runner, never a deployment upgrade or release approval.
 * Owns a fresh cluster/network/credential; accepts no database URL or backup. */
export async function runUpgradeComponentTests(args: string[]) {
  if (args.length !== 4 || args[0] !== "--expected-daemon-id" || !/^[a-zA-Z0-9-]+$/.test(args[1]) || args[2] !== "--suite" || !Object.hasOwn(suites, args[3])) {
    return { exitCode: 2, reason: "usage-expected-daemon-id-and-suite-bindings-required" };
  }
  const docker = createIsolatedUpgradeDocker();
  if (docker.command(["info", "--format", "{{.ID}}|{{.Name}}|{{.OperatingSystem}}"] ).toString().trim() !== `${args[1]}|docker-desktop|Docker Desktop`) {
    return { exitCode: 2, reason: "explicit-development-daemon-required" };
  }
  const image = JSON.parse(docker.command(["image", "inspect", "pgvector/pgvector:pg16"]).toString())[0];
  const run = `conversion-${randomBytes(8).toString("hex")}`;
  const label = "wiseeff.upgrade.conversion";
  const password = randomBytes(24).toString("hex");
  const directory = await mkdtemp(path.join(os.tmpdir(), "upgrade-components-"));
  let id = ""; let net = ""; let child: ReturnType<typeof spawn> | undefined;
  let supervisor: ReturnType<typeof superviseComponentProcess> | undefined;
  let interrupted = false;
  const interrupt = () => { interrupted = true; supervisor?.stop(); };
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  let exitCode = 1;
  let stage = "network-create";
  try {
    // Only PostgreSQL runs here. An internal Docker network does not publish
    // its port on Docker Desktop; this owned bridge publishes loopback only.
    // This is not an application egress-isolation environment.
    net = docker.command(["network", "create", "--opt", "com.docker.network.bridge.enable_ip_masquerade=false", "--label", `${label}=${run}`, run]).toString().trim();
    stage = "container-create";
    id = docker.command(["run", "-d", "--network", net, "--label", `${label}=${run}`, "-e", `POSTGRES_PASSWORD=${password}`, "-p", "127.0.0.1::5432", image.Id]).toString().trim();
    stage = "container-port-observation";
    let port: string | undefined;
    for (let n = 0; n < 40 && !interrupted; n++) {
      const owned = docker.assertOwned(id, label, run);
      const published = owned.NetworkSettings.Ports?.["5432/tcp"]?.[0];
      if (owned.State.Running && published?.HostIp === "127.0.0.1" && /^\d+$/.test(published.HostPort)) { port = published.HostPort; break; }
      await setTimeout(200);
    }
    if (!port) throw new Error("owned-postgres-port-unavailable");
    const url = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
    stage = "database-readiness";
    let ready = false;
    for (let n = 0; n < 40 && !interrupted; n++) {
      docker.assertOwned(id, label, run);
      try { docker.command(["exec", id, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]); ready = true; break; }
      catch { await setTimeout(200); }
    }
    if (!ready || interrupted) throw new Error("owned-postgres-not-ready");
    stage = "receipt-and-tests";
    const receipt = path.join(directory, "target.json");
    await writeFile(receipt, JSON.stringify({ id, net, run, label, daemonId: docker.daemonId, url }), { mode: 0o600, flag: "wx" });
    const selectors = suites[args[3] as keyof typeof suites];
    child = spawn(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.upgrade-cutover.config.ts", ...selectors], {
      cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME,
        UPG_TEST_TARGET_RECEIPT: receipt, DATABASE_URL: url, TEST_DATABASE_URL: url },
      stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    supervisor = superviseComponentProcess(child);
    const { exitCode: status, output } = await supervisor.wait;
    process.stdout.write(output.split(url).join("[REDACTED_TEST_URL]").split(password).join("[REDACTED]"));
    exitCode = interrupted ? 1 : status;
  } catch {
    console.error(`upgrade-component-stage-failed:${stage}`);
    exitCode = 1;
  } finally {
    // Each destructive cleanup is constrained to the exact newly created object.
    if (id) { docker.assertOwned(id, label, run); docker.command(["rm", "-f", "-v", id]); }
    if (net) {
      const found = JSON.parse(docker.command(["network", "inspect", net]).toString())[0];
      if (found.Id !== net || found.Labels?.[label] !== run) throw new Error("owned-network-mismatch");
      docker.command(["network", "rm", net]);
    }
    await rm(directory, { recursive: true });
    process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
  }
  console.log(JSON.stringify({ scope: "isolated-components-only", suite: args[3], imageId: image.Id, platform: `${image.Os}/${image.Architecture}`, containerId: id, networkId: net, exitCode, cleanupVerified: true, releaseApproved: false }));
  return { exitCode, reason: "isolated-components-only" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runUpgradeComponentTests(process.argv.slice(2)).then(result => {
    if (result.exitCode !== 0) console.error(result.reason);
    process.exitCode = result.exitCode;
  }).catch(() => { console.error("upgrade-component-runner-failed"); process.exitCode = 1; });
}
