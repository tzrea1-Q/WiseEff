import { beforeEach, expect, it, vi } from "vitest";
import { chmod, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const calls = vi.hoisted(() => ({ docker: vi.fn(), admission: vi.fn(), git: vi.fn() }));
vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), spawnSync: (...args: unknown[]) => calls.git(...args) }));
vi.mock("../../../../scripts/isolated-upgrade-docker", () => ({ createIsolatedUpgradeDocker: calls.docker }));
vi.mock("../../../../scripts/upgrade-test-target", () => ({ assertOwnedUpgradeTestTarget: calls.admission }));
const module = await import("./handoffLegacySource.fixture").catch(() => ({}));
beforeEach(() => { vi.clearAllMocks(); });
it("materializes the fixed candidate commit without changing its Git-only custody repository", async () => {
  const native = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  calls.git.mockImplementation(native.spawnSync);
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "candidate-checkout-test-")));
  const repository = path.join(directory, "original");
  mkdirSync(repository);
  const git = (...args: string[]) => {
    const result = native.spawnSync("git", ["-C", repository, ...args], { encoding: "utf8" });
    expect(result.status).toBe(0);
    return result.stdout.trim();
  };
  try {
    git("init", "--quiet");
    await writeFile(path.join(repository, "tracked.txt"), "original commit bytes\n");
    git("add", "tracked.txt");
    git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture");
    const sha = git("rev-parse", "HEAD"), tree = git("rev-parse", "HEAD^{tree}");
    git("rm", "--cached", "tracked.txt");
    const originalStatus = git("status", "--porcelain", "--untracked-files=no");
    expect(originalStatus).toBe("D  tracked.txt");
    const prepare = Reflect.get(module, "prepareLegacyCandidateCheckout");
    expect(prepare).toBeTypeOf("function");
    const candidate = await prepare({ repository, sha, tree, privateRoot: directory });
    try {
      expect(candidate.checkout).not.toBe(repository);
      expect(readFileSync(path.join(candidate.checkout, "tracked.txt"), "utf8")).toBe("original commit bytes\n");
      const status = native.spawnSync("git", ["-C", candidate.checkout, "status", "--porcelain"], { encoding: "utf8" });
      expect(status.status).toBe(0); expect(status.stdout).toBe("");
      expect(git("status", "--porcelain", "--untracked-files=no")).toBe(originalStatus);
    } finally { await candidate.close(); }
    expect(existsSync(candidate.checkout)).toBe(false);
    expect(git("rev-parse", "HEAD")).toBe(sha);
    await expect(prepare({ repository, sha, tree: "0".repeat(40), privateRoot: directory }))
      .rejects.toThrow("legacy-source-candidate-checkout-mismatch");
    expect(readdirSync(directory)).toEqual(["original"]);
    expect(git("status", "--porcelain", "--untracked-files=no")).toBe(originalStatus);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
// Only the fixture's stop command/state observations are doubled here; this
// does not manufacture successful auth/business setup or real process exits.
it.each([
  { exitCode: 0, oom: false, expected: "stopped" },
  { exitCode: 1, oom: false, expected: "unknown" },
  { exitCode: 137, oom: false, expected: "unknown" },
  { exitCode: 0, oom: true, expected: "unknown" },
])("validates the original stop outcome without retry: $exitCode/$oom", async ({ exitCode, oom, expected }) => {
  const commands: string[] = [], stoppedApplications = new Set<string>();
  const state = { State: { Status: "exited", Running: false, Restarting: false, OOMKilled: oom, ExitCode: exitCode, Error: "" }, Config: {} };
  const pause = vi.fn(async () => ({ paused: true, active: 0 }));
  const stop = Reflect.get(module, "createLegacySourceApplicationStop")({
    verify: async () => undefined, pause,
    own: (service: string) => commands.includes(service) ? state : { State: { Running: true, Restarting: false } },
    stop: (service: string) => { commands.push(service); },
    recordStopped: (service: string) => { stoppedApplications.add(service); },
  });
  const first = stop();
  expect(stop()).toBe(first);
  const outcome = await first.then(() => "stopped", () => "unknown");
  expect(outcome).toBe(expected);
  expect(stop()).toBe(first);
  expect(pause).toHaveBeenCalledTimes(1);
  expect(commands.length).toBe(expected === "stopped" ? 3 : 1);
  expect(stoppedApplications.size).toBe(expected === "stopped" ? 3 : 0);
});
it("does not stop an application when the actual queue did not drain", async () => {
  const stopCommand = vi.fn();
  const stop = Reflect.get(module, "createLegacySourceApplicationStop")({ verify: async () => undefined,
    pause: async () => ({ paused: true, active: 1 }), own: vi.fn(), stop: stopCommand, recordStopped: vi.fn() });
  await expect(stop()).rejects.toThrow("legacy-source-queue-not-drained");
  expect(stopCommand).not.toHaveBeenCalled();
});
it.each([
  { service: "web", exitCode: 143, signal: undefined, oom: false, changedStart: false, expected: "stopped" },
  { service: "web", exitCode: 143, signal: "SIGTERM", oom: false, changedStart: false, expected: "stopped" },
  { service: "api", exitCode: 143, signal: undefined, oom: false, changedStart: false, expected: "unknown" },
  { service: "worker", exitCode: 143, signal: undefined, oom: false, changedStart: false, expected: "unknown" },
  { service: "web", exitCode: 137, signal: undefined, oom: false, changedStart: false, expected: "unknown" },
  { service: "web", exitCode: 1, signal: undefined, oom: false, changedStart: false, expected: "unknown" },
  { service: "web", exitCode: 143, signal: undefined, oom: true, changedStart: false, expected: "unknown" },
  { service: "web", exitCode: 143, signal: "SIGKILL", oom: false, changedStart: false, expected: "unknown" },
  { service: "web", exitCode: 143, signal: undefined, oom: false, changedStart: true, expected: "unknown" },
  { service: "web", exitCode: 143, signal: undefined, oom: false, changedStart: false, changedId: true, expected: "unknown" },
  { service: "web", exitCode: 143, signal: undefined, oom: false, changedStart: false, staleFinish: true, expected: "unknown" },
])("only accepts this original web's observed SIGTERM termination: $service/$exitCode/$signal/$oom/$changedStart", async selection => {
  const commands: string[] = [], stopped: string[] = [];
  const startedAt = "2026-09-08T00:00:00.000000000Z";
  const stop = Reflect.get(module, "createLegacySourceApplicationStop")({ verify: async () => undefined,
    pause: async () => ({ paused: true, active: 0 }),
    own: (service: string) => {
      const finished = commands.includes(service), selected = service === selection.service;
      return { Id: selected && finished && "changedId" in selection ? "different-container" : service,
        Config: { StopSignal: selected ? selection.signal : undefined }, State: {
        Running: !finished, Restarting: false, Status: finished ? "exited" : "running", Error: "",
        StartedAt: finished && selected && selection.changedStart ? "2026-09-08T00:00:01.000000000Z" : startedAt,
        FinishedAt: finished && !(selected && "staleFinish" in selection) ? "2026-09-08T00:00:02.000000000Z" : "0001-01-01T00:00:00Z",
        ExitCode: finished && selected ? selection.exitCode : 0, OOMKilled: selected && selection.oom,
      } };
    }, stop: (service: string) => { commands.push(service); }, recordStopped: (service: string) => { stopped.push(service); } });
  const operation = stop();
  expect(await operation.then(() => "stopped", () => "unknown")).toBe(selection.expected);
  expect(stop()).toBe(operation);
  expect(stopped).toEqual(selection.expected === "stopped" ? ["worker", "api", "web"] :
    ["worker", "api", "web"].slice(0, ["worker", "api", "web"].indexOf(selection.service)));
});
it("rejects a non-private source preparation selection before creating resources", async () => {
  const prepare = Reflect.get(module, "prepareLegacySourceFixture");
  expect(prepare).toBeTypeOf("function");
  await expect(prepare({ expectedDaemonId: "", privateRoot: "relative" })).rejects.toThrow("legacy-source-input-invalid");
  expect(calls.docker).not.toHaveBeenCalled();
  expect(calls.admission).not.toHaveBeenCalled();
});
it("does not expose a nonexistent private-root path in a preparation error", async () => {
  const missing = path.join(os.tmpdir(), "private-root-canary-missing", "secret-selection");
  const error = await Reflect.get(module, "prepareLegacySourceFixture")({ expectedDaemonId: "owned-daemon", privateRoot: missing }).catch((error: unknown) => error);
  expect(error.message).toBe("legacy-source-preparation-failed");
  expect(String(error)).not.toContain(missing);
  expect(error.cause).toBeUndefined();
  expect(calls.docker).not.toHaveBeenCalled();
});

// This command double stops at CREATE/identity verification. It cannot return
// production health, authentication or business success. Real services live in
// the separate owned integration test.
function installStoppedCreateFault(fault: "tag-changed" | "cleanup-failed" | "foreign-label" | "created-network" | "running-network-missing" | "migration-failed" | "migration-completed" |
  `batch-${"container" | "volume"}-${"missing" | "duplicate" | "foreign"}`) {
  const image = "sha256:a7c1fd128b60ea545d483b285ab88d349de26a491d1e6a826a413a075cd4737d";
  const sha = "82344044b436a8dafecefbb85dfd724cecb05e3f";
  const names = ["api", "worker", "web", "postgres", "minio", "redis", "mc"];
  const commands: string[][] = [];
  const containers = new Map<string, any>();
  const volumes = new Map<string, any>();
  let network: any, project = "", composeFile = "", alias = "", created = false, model: any;
  calls.git.mockImplementation((_bin: string, args: string[]) => {
    if (args.includes("rev-parse")) return { status: 0, stdout: "6dd92c36c4eb41bcaaba5a7a756befb9239d9120\n" };
    const add = args.indexOf("add");
    if (add >= 0) mkdirSync(path.join(args[add + 2]!, "ops/self-hosted"), { recursive: true });
    const remove = args.indexOf("remove");
    if (remove >= 0) rmSync(args[remove + 1]!, { recursive: true, force: true });
    return { status: 0, stdout: "" };
  });
  const command = (args: string[]) => {
    commands.push([...args]);
    const json = (value: unknown) => Buffer.from(JSON.stringify(value));
    if (args[0] === "image") {
      if (args[1] === "inspect") return json([{ Id: image, Config: { Labels: { "org.opencontainers.image.revision": sha, "org.wiseeff.build-tls-policy": "verify" } } }]);
      if (args[1] === "tag") alias = args[3]!;
      return Buffer.from("");
    }
    if (args[0] === "compose") {
      project = args[args.indexOf("-p") + 1]!; composeFile = args[args.indexOf("-f") + 1]!;
      if (args.includes("up") || args.includes("create")) {
        created = true;
        model = JSON.parse(readFileSync(composeFile, "utf8"));
        const run = model.networks.default.labels?.["wiseeff.controlled-recovery-run"];
        expect(run).toMatch(/^[a-f0-9]{24}$/);
        expect(Object.values(model.services).every((service: any) => service.labels?.["wiseeff.controlled-recovery-run"] === run)).toBe(true);
        expect(Object.values(model.volumes).every((volume: any) => volume.labels?.["wiseeff.controlled-recovery-run"] === run)).toBe(true);
        for (const [index, name] of names.entries()) {
          const id = (index + 1).toString(16).repeat(64);
          const logical = name === "postgres" ? "pg" : name === "minio" ? "objects" : name === "redis" ? "redis" : undefined;
          const mount = logical ? [{ Type: "volume", Name: `${project}_${logical}`, Destination: name === "postgres" ? "/var/lib/postgresql/data" : "/data" }] : [];
          containers.set(id, { Id: id, Created: "fixed-created", Image: name === "api" && !fault.startsWith("batch-") && !["created-network", "running-network-missing", "migration-failed", "migration-completed"].includes(fault) ? `sha256:${"f".repeat(64)}` : image,
            Config: { Image: model.services[name].image, Labels: { ...model.services[name].labels, "com.docker.compose.project": project, "com.docker.compose.service": name, "com.docker.compose.project.config_files": composeFile } },
            Mounts: mount, HostConfig: { Privileged: false, NetworkMode: `${project}_default`, Devices: [],
              PortBindings: model.services[name].ports ? { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "" }] } : {} },
            State: { Status: "created", Running: false, Restarting: false }, NetworkSettings: { Networks: { [`${project}_default`]: { NetworkID: "" } } } });
          if (logical) volumes.set(`${project}_${logical}`, { Name: `${project}_${logical}`, Driver: "local", Options: {}, CreatedAt: "fixed-created", Mountpoint: `/volumes/${logical}`,
            Labels: { ...model.volumes[logical].labels, "com.docker.compose.project": project, "com.docker.compose.volume": logical } });
        }
        network = { Id: "n".repeat(64), Name: `${project}_default`, Created: "fixed-created", Driver: "bridge", Internal: true, Containers: {},
          Options: { "com.docker.network.bridge.enable_ip_masquerade": "false" }, Labels: { ...model.networks.default.labels, "com.docker.compose.project": project, "com.docker.compose.network": "default" } };
      }
      if (args.includes("ps")) return Buffer.from([...containers.values()].filter(c => c.Config.Labels["com.docker.compose.service"] === args.at(-1)).map(c => c.Id).join("\n"));
      return Buffer.from("");
    }
    const batch = (rows: any[], resource: "container" | "volume") => {
      if (rows.length > 1 && fault.startsWith(`batch-${resource}-`)) {
        if (fault.endsWith("missing")) rows.pop();
        if (fault.endsWith("duplicate")) rows[1] = rows[0];
        if (fault.endsWith("foreign")) rows[0] = { ...rows[0], [resource === "container" ? "Id" : "Name"]: "foreign" };
      }
      return json(rows);
    };
    if (args[0] === "inspect") return batch(args.slice(1).map(id => containers.get(id)), "container");
    if (args[0] === "ps") {
      const volume = args.find(arg => arg.startsWith("volume="))?.slice("volume=".length);
      return Buffer.from([...containers.values()].filter(c => !volume || c.Mounts.some((m: any) => m.Name === volume)).map(c => c.Id)
        .concat(fault === "foreign-label" && created ? ["e".repeat(64)] : []).join("\n"));
    }
    if (args[0] === "start") {
      if (fault === "created-network" || fault.startsWith("batch-")) throw new Error("command-double-stops-before-execution");
      if (fault.startsWith("migration-") && args.includes("1".repeat(64))) throw new Error("command-double-stops-before-api-execution");
      for (const id of args.slice(1)) {
        const c = containers.get(id)!; c.State = { Status: "running", Running: true, Restarting: false };
        if(c.Config.Labels["com.docker.compose.service"] === "postgres") c.NetworkSettings.Ports = { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] };
        if (fault.startsWith("migration-")) {
          c.NetworkSettings.Networks[network.Name].NetworkID = network.Id; network.Containers[id] = {};
        }
      }
      return Buffer.from("");
    }
    if (args[0] === "exec" && fault.startsWith("migration-")) {
      if (args.includes("db:migrate")) {
        if (fault === "migration-failed") throw new Error("private-migration-failure");
        return Buffer.from("Applied 1 migration(s): source\nEnsured Xiaoze LangGraph checkpoint tables.\n");
      }
      return Buffer.from("");
    }
    if (args[0] === "exec" && fault === "running-network-missing") return Buffer.from("");
    if (args[0] === "rm") {
      if (fault === "cleanup-failed") throw new Error("private-cleanup-canary");
      containers.delete(args.at(-1)!); return Buffer.from("");
    }
    if (args[0] === "volume") {
      if (args[1] === "ls") return Buffer.from([...volumes.keys()].join("\n"));
      if (args[1] === "inspect") return batch(args.slice(2).map(name => volumes.get(name)), "volume");
      if (args[1] === "rm") volumes.delete(args[2]!);
      return Buffer.from("");
    }
    if (args[0] === "network") {
      if (args[1] === "ls") return Buffer.from(network ? args.includes("--format") ? network.Name : network.Id : "");
      if (args[1] === "inspect") return json([network]);
      if (args[1] === "rm") network = undefined;
      return Buffer.from("");
    }
    throw new Error("unsupported-command-double");
  };
  calls.docker.mockReturnValue({ daemonId: "owned-daemon", command });
  return { commands, get alias() { return alias; }, get model() { return model; } };
}
it.each(["container", "volume"] as const)("rejects an incomplete, duplicate or foreign %s batch before START", async resource => {
  for (const fault of ["missing", "duplicate", "foreign"] as const) {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "legacy-batch-test-")));
    const fake = installStoppedCreateFault(`batch-${resource}-${fault}`);
    try {
      const error = await Reflect.get(module, "prepareLegacySourceFixture")({ expectedDaemonId: "owned-daemon", privateRoot: directory }).catch((error: unknown) => error);
      expect(error.message).toBe(`legacy-source-${resource}-batch-mismatch`);
      expect(fake.commands.some(args => args[0] === "start" || args[0] === "exec")).toBe(false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

it("retains both pre-START boundaries with two complete bounded inspect calls each", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "legacy-batch-test-")));
  const fake = installStoppedCreateFault("created-network");
  try {
    await Reflect.get(module, "prepareLegacySourceFixture")({ expectedDaemonId: "owned-daemon", privateRoot: directory }).catch(() => undefined);
    const start = fake.commands.findIndex(args => args[0] === "start");
    const batch = fake.commands.findIndex(args => args[0] === "inspect" && args.length === 8);
    expect(batch).toBeGreaterThan(-1); expect(start).toBeGreaterThan(batch);
    const inspections = fake.commands.slice(batch, start).filter(args => args[0] === "inspect" || args[0] === "volume" && args[1] === "inspect");
    // The original post-CREATE and immediate pre-START checks both remain.
    expect(inspections.map(args => args.length)).toEqual([8, 5, 8, 5]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("keeps source schema initialization outside the original API readiness command", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "legacy-source-init-")));
  const fake = installStoppedCreateFault("created-network");
  try {
    await Reflect.get(module, "prepareLegacySourceFixture")({ expectedDaemonId: "owned-daemon", privateRoot: directory }).catch(() => undefined);
    expect(fake.model.services.api.command).toEqual(["sh", "-lc", "npx tsx server/index.ts"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it("keeps the strict internal source without published host management ports", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "legacy-source-port-")));
  const fake = installStoppedCreateFault("created-network");
  try {
    await Reflect.get(module, "prepareLegacySourceFixture")({ expectedDaemonId: "owned-daemon", privateRoot: directory }).catch(() => undefined);
    expect(fake.model.networks.default.internal).toBe(true);
    expect(Object.values(fake.model.services).every((model: any) => model.ports === undefined)).toBe(true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it.each(["migration-failed", "migration-completed"] as const)("starts the original API only after the original migration command exits successfully: %s", async fault => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "legacy-source-migration-")));
  const fake = installStoppedCreateFault(fault);
  try {
    await Reflect.get(module, "prepareLegacySourceFixture")({ expectedDaemonId: "owned-daemon", privateRoot: directory }).catch(() => undefined);
    const migration = fake.commands.findIndex(args => args[0] === "exec" && args.includes("db:migrate"));
    expect(migration).toBeGreaterThan(-1);
    const apiStart = fake.commands.findIndex(args => args[0] === "start" && args.includes("1".repeat(64)));
    if (fault === "migration-completed") expect(apiStart).toBeGreaterThan(migration);
    else expect(apiStart).toBe(-1);
    expect(fake.commands.some(args => args[0] === "start" && args.includes("2".repeat(64)))).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it.each(["tag-changed", "cleanup-failed", "foreign-label"] as const)("never executes the changed image and preserves unknown cleanup evidence: %s", async fault => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "legacy-source-create-")));
  const fake = installStoppedCreateFault(fault);
  try {
    const error = await Reflect.get(module, "prepareLegacySourceFixture")({ expectedDaemonId: "owned-daemon", privateRoot: directory }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(fake.commands.some(args => args[0] === "compose" && args.includes("create"))).toBe(true);
    expect(fake.commands.some(args => args[0] === "start" || args[0] === "exec" || args.includes("up"))).toBe(false);
    expect(fake.commands.filter(args => args[0] === "rm").some(args => args.includes("e".repeat(64)))).toBe(false);
    expect(String(error)).not.toContain("private-cleanup-canary");
    if (fault === "tag-changed") expect(readdirSync(directory)).toEqual([]);
    else {
      expect(error.message).toBe("legacy-source-operation-and-cleanup-failed");
      const retained = path.join(directory, readdirSync(directory)[0]!);
      expect(existsSync(path.join(retained, "api.env"))).toBe(true);
      expect(existsSync(path.join(retained, "resources.json"))).toBe(true);
      expect(existsSync(path.join(retained, "checkout/ops/self-hosted/legacy-owned-fixture.json"))).toBe(true);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it.each(["created-network", "running-network-missing"] as const)("separates a stopped network declaration from a running endpoint: %s", async fault => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "legacy-source-network-")));
  const fake = installStoppedCreateFault(fault);
  try {
    const error = await Reflect.get(module, "prepareLegacySourceFixture")({ expectedDaemonId: "owned-daemon", privateRoot: directory }).catch((error: unknown) => error);
    const starts = fake.commands.filter(args => args[0] === "start");
    expect(starts).toEqual([["start", ...[4, 5, 6, 7].map(value => value.toString(16).repeat(64))]]);
    expect(error.message).toBe(fault === "created-network" ? "legacy-source-stores-failed" : "legacy-source-container-state-changed");
    // Neither mode can start the old application with an unproven endpoint.
    expect(starts.flat()).not.toContain("1".repeat(64));
    expect(readdirSync(directory)).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it("rejects actual non-private and aliased directories before consulting Docker", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "legacy-source-private-")));
  const link = `${directory}-alias`;
  const prepare = Reflect.get(module, "prepareLegacySourceFixture");
  try {
    await chmod(directory, 0o755);
    await expect(prepare({ expectedDaemonId: "owned-daemon", privateRoot: directory })).rejects.toThrow("legacy-source-private-root-invalid");
    await chmod(directory, 0o700);
    await symlink(directory, link);
    await expect(prepare({ expectedDaemonId: "owned-daemon", privateRoot: link })).rejects.toThrow("legacy-source-private-root-invalid");
    expect(calls.docker).not.toHaveBeenCalled();
    expect(calls.admission).not.toHaveBeenCalled();
  } finally { await rm(link, { force: true }); await rm(directory, { recursive: true, force: true }); }
});
