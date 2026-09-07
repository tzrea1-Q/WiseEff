import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import * as componentRunner from "./run-upgrade-component-tests";
import { observeCleanUpgradeCheckout, runUpgradeComponentTests, superviseComponentProcess } from "./run-upgrade-component-tests";

it("owns the retirement endpoint topology in the supervising runner before the test child is started", () => {
  expect(typeof componentRunner.withOwnedRetirementEndpoints).toBe("function");
  expect(componentRunner.componentTestCommands("retirement-existing-pg16")[0].slice(-2))
    .toEqual(["server/modules/catalog-cutover/retirement/loginFence.integration.test.ts", "scripts/retirement-endpoint-supervision.docker.test.ts"]);
});

it.each(["child-failure", "unknown-create", "unknown-network", "foreign-identity", "readiness-interrupted"])("cleans only predeclared owned endpoint resources after %s", async fault => {
  const directory = mkdtempSync(join(tmpdir(), "retirement-parent-unit-"));
  const imageId = `sha256:${"f".repeat(64)}`;
  const containers = new Map<string, { Id: string; Name: string; Image: string; Config: { Labels: Record<string, string> }; State: { Running: boolean }; NetworkSettings: { Ports: Record<string, unknown> } }>();
  let network: { Id: string; Name: string; Labels: Record<string, string> } | undefined;
  let serial = 0, bodyCalled = false, authorizationCalls = 0;
  const removed: string[] = [];
  const labelOf = (args: string[]) => {
    const [name, value] = args[args.indexOf("--label") + 1].split("="); return { [name]: value };
  };
  const command = (args: string[]) => {
    const plan = JSON.parse(readFileSync(join(directory, "retirement-endpoints-plan.json"), "utf8"));
    expect(statSync(join(directory, "retirement-endpoints-plan.json")).mode & 0o777).toBe(0o600);
    const output = (value: unknown) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
    if (args[0] === "network" && args[1] === "create") {
      network = { Id: "a".repeat(64), Name: args.at(-1)!, Labels: labelOf(args) };
      expect(plan.networkName).toBe(network.Name);
      if (fault === "unknown-network") throw new Error("private-network-ack-lost");
      return output(network.Id);
    }
    if (args[0] === "create") {
      const name = args[args.indexOf("--name") + 1];
      expect(plan.resources.some((resource: { name: string }) => resource.name === name)).toBe(true);
      const id = (++serial).toString(16).padStart(64, "0");
      containers.set(id, { Id: id, Name: `/${name}`, Image: imageId, Config: { Labels: labelOf(args) },
        State: { Running: true }, NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "15432" }] } } });
      if (serial === 1 && ["unknown-create", "foreign-identity"].includes(fault)) {
        if (fault === "foreign-identity") containers.get(id)!.Config.Labels = {};
        throw new Error("private-create-ack-lost");
      }
      return output(id);
    }
    if (args[0] === "ps") return output([...containers.values()].filter(row => args.at(-1) === `name=^${row.Name}$`).map(row => row.Id).join("\n"));
    if (args[0] === "start" || args[0] === "exec") return output("");
    if (args[0] === "rm") { const id = args.at(-1)!; removed.push(id); containers.delete(id); return output(id); }
    if (args[0] === "network" && args[1] === "inspect") return output([{ ...network, Containers: Object.fromEntries([...containers.keys()].map(id => [id, {}])) }]);
    if (args[0] === "network" && args[1] === "ls") return output(network?.Id ?? "");
    if (args[0] === "network" && args[1] === "rm") { network = undefined; return output(""); }
    throw new Error("unexpected-unit-docker-command");
  };
  const docker = { command, assertOwned(id: string, label: string, run: string) {
    const actual = containers.get(id); if (!actual || actual.Config.Labels[label] !== run) throw new Error("foreign"); return actual;
  } } as unknown as Parameters<typeof componentRunner.withOwnedRetirementEndpoints>[0]["docker"];
  try {
    const result = componentRunner.withOwnedRetirementEndpoints({ docker, directory, imageId, password: "b".repeat(48),
      authorizeCreation: () => { authorizationCalls++; if (fault === "readiness-interrupted" && authorizationCalls === 10) throw new Error("interrupted-before-readiness"); } }, async () => { bodyCalled = true; throw new Error("child-failed"); });
    await expect(result).rejects.toThrow(fault === "foreign-identity" ? "owned-retirement-endpoint-cleanup-incomplete" : fault === "unknown-create" ? "private-create-ack-lost" : fault === "unknown-network" ? "private-network-ack-lost" : fault === "readiness-interrupted" ? "interrupted-before-readiness" : "child-failed");
    expect(bodyCalled).toBe(fault === "child-failure");
    expect(authorizationCalls).toBeGreaterThanOrEqual(1);
    expect(containers.size).toBe(fault === "foreign-identity" ? 1 : 0);
    expect(Boolean(network)).toBe(fault === "foreign-identity");
    expect(removed).toHaveLength(["child-failure", "readiness-interrupted"].includes(fault) ? 4 : fault === "unknown-create" ? 1 : 0);
    const observed = readFileSync(join(directory, "retirement-endpoints-observed.jsonl"), "utf8").trim();
    expect(observed ? observed.split("\n").length : 0).toBe(fault === "unknown-network" ? 0 : ["unknown-create", "foreign-identity"].includes(fault) ? 1 : 5);
  } finally { rmSync(directory, { recursive: true }); }
});

it("refuses creation authorization before any Docker operation, retaining only a private local plan", async () => {
  const directory = mkdtempSync(join(tmpdir(), "retirement-parent-denied-"));
  let dockerCalls = 0;
  const docker = { command: () => { dockerCalls++; throw new Error("must-not-call"); } } as unknown as Parameters<typeof componentRunner.withOwnedRetirementEndpoints>[0]["docker"];
  try {
    await expect(componentRunner.withOwnedRetirementEndpoints({ docker, directory, imageId: `sha256:${"f".repeat(64)}`, password: "a".repeat(48),
      authorizeCreation: () => { throw new Error("admission-denied"); } }, async () => { throw new Error("must-not-start"); })).rejects.toThrow("admission-denied");
    expect(dockerCalls).toBe(0);
    expect(statSync(join(directory, "retirement-endpoints-plan.json")).mode & 0o777).toBe(0o600);
  } finally { rmSync(directory, { recursive: true }); }
});

it.each([
  { deadlineMs: 900001, graceMs: 20, outputBytes: 1024 },
  { deadlineMs: 10, graceMs: 2001, outputBytes: 1024 },
  { deadlineMs: 10, graceMs: 20, outputBytes: 8388609 },
  { deadlineMs: 0, graceMs: 20, outputBytes: 1024 },
])("does not expose an increased test supervisor budget %#", async limits => {
  expect(await runUpgradeComponentTests(["--expected-daemon-id", "owned", "--suite", "retirement-existing-pg16"], { limits }))
    .toEqual({ exitCode: 2, reason: "component-supervision-limits-invalid" });
});

it.each(["untracked migration", "tracked edit", "staged edit", "ignored output"])("binds the real checkout including %s", kind => {
  const directory = mkdtempSync(join(tmpdir(), "upgrade-checkout-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: "pipe" });
  try {
    git("init");
    writeFileSync(join(directory, ".gitignore"), "output/\n");
    writeFileSync(join(directory, "migration.sql"), "SELECT 1;\n");
    git("add", ".");
    git("-c", "user.name=isolated test", "-c", "user.email=isolated@example.invalid", "commit", "-m", "fixture");
    expect(observeCleanUpgradeCheckout(directory)).toBe(git("rev-parse", "HEAD").toString().trim());
    if (kind === "untracked migration") writeFileSync(join(directory, "0141_untracked.sql"), "SELECT 2;\n");
    else if (kind === "ignored output") {
      mkdirSync(join(directory, "output"));
      writeFileSync(join(directory, "output", "build.js"), "build");
    } else {
      writeFileSync(join(directory, "migration.sql"), "SELECT 2;\n");
      if (kind === "staged edit") git("add", "migration.sql");
    }
    if (kind === "ignored output") expect(observeCleanUpgradeCheckout(directory)).toBe(git("rev-parse", "HEAD").toString().trim());
    else expect(() => observeCleanUpgradeCheckout(directory)).toThrow("upgrade-hosted-checkout-unavailable");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it.each(["toString", "__proto__", "constructor"])("rejects inherited suite name %s", async suite => {
  expect(await runUpgradeComponentTests(["--expected-daemon-id", "owned", "--suite", suite])).toMatchObject({ exitCode: 2 });
});

it.each(["deadline", "output"])("terminates a real child on %s without Docker", async kind => {
  const child = spawn(process.execPath, ["-e", `process.on('SIGTERM', () => {}); ${kind === "output" ? "setInterval(() => process.stdout.write('x'.repeat(2048)), 5);" : "setInterval(() => {}, 5);"}`], { detached: true, stdio: ["ignore", "pipe", "pipe"], env: {} });
  const result = await superviseComponentProcess(child, { deadlineMs: 200, graceMs: 20, outputBytes: 1024 }).wait;
  expect(result.exitCode).toBe(1);
  expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(1024);
  expect(child.signalCode).toBe("SIGKILL");
});

it("kills a TERM-resistant descendant even after its leader closes", async () => {
  const descendant = "process.on('SIGTERM',()=>{}); process.send('ready'); setInterval(()=>{},5);";
  const leader = `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','ignore','ignore','ipc']}); c.on('message',()=>process.stdout.write(String(c.pid))); setInterval(()=>{},5);`;
  const child = spawn(process.execPath, ["-e", leader], { detached: true, stdio: ["ignore", "pipe", "pipe"], env: {} });
  const result = await superviseComponentProcess(child, { deadlineMs: 500, graceMs: 30, outputBytes: 1024 }).wait;
  const pid = Number(result.output);
  expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
  let alive = true;
  for (let n = 0; n < 50; n++) {
    try { process.kill(pid, 0); await setTimeout(10); } catch { alive = false; break; }
  }
  // Only the exact child-created PID is eligible for emergency test cleanup.
  if (alive) process.kill(pid, "SIGKILL");
  expect(alive).toBe(false);
  expect(result.exitCode).toBe(1);
  expect(child.signalCode).toBe("SIGTERM");
});

it.each([[], ["--suite", "bindings"], ["--expected-daemon-id", "owned", "--suite", "unknown"], ["--expected-daemon-id", "owned", "--suite", "bindings", "--database-url", "forbidden"]].map(args => ({ args })))("refuses incomplete or external component runner input %#", async ({ args }) => {
  expect(await runUpgradeComponentTests(args)).toMatchObject({ exitCode: 2 });
});
