import { beforeEach, expect, it, vi } from "vitest";
import type { HandoffInputs } from "./handoff";

const seam = vi.hoisted(() => ({ command: vi.fn(), daemonId: "owned-daemon" }));
vi.mock("../../../../scripts/isolated-upgrade-docker", () => ({ createIsolatedUpgradeDocker: () => seam }));
// The first Red records the absent production owner, not a real-store failure.
const module = await import("./handoffDataSource").catch(() => ({}));
const create = (...args: unknown[]) => {
  const factory = Reflect.get(module, "createOwnedHandoffDataObserver");
  expect(factory).toBeTypeOf("function");
  return factory(...args);
};

function fixture() {
  const id = (n: number) => String(n).repeat(64);
  const project = "owned-handoff", composeFile = "/private/old/ops/self-hosted/compose.yaml";
  const services = ["api", "worker", "web", "postgres", "minio", "redis", "mc"];
  const inputs = { runId: "run", expectedDaemonId: seam.daemonId,
    source: { project, composeFile, applications: services.slice(0, 3).map((service, n) => ({ service, containerId: id(n + 1) })),
      stores: services.slice(3, 6).map((service, n) => ({ service, containerId: id(n + 4), volumeName: `volume-${service}`,
        destination: service === "postgres" ? "/var/lib/postgresql/data" : "/data" })) },
  } as HandoffInputs;
  const containers = services.map((service, n) => ({ Id: id(n + 1), Image: `sha256:${id(n + 1)}`,
    Config: { Labels: { "com.docker.compose.project": project, "com.docker.compose.service": service,
      "com.docker.compose.project.config_files": composeFile, "com.docker.compose.project.working_dir": "/private/old/ops/self-hosted" } },
    State: { Running: true, Restarting: false, StartedAt: "2026-09-08T00:00:00Z" },
    Mounts: n >= 3 && n <= 5 ? [{ Type: "volume", Name: `volume-${service}`, Destination: n === 3 ? "/var/lib/postgresql/data" : "/data" }] : [],
    HostConfig: { NetworkMode: "owned-network" },
    NetworkSettings: { Networks: { owned: { NetworkID: id(8), IPAddress: `172.30.0.${n + 2}` } } },
  }));
  const volumes = inputs.source.stores.map(store => ({ Name: store.volumeName, Driver: "local", Options: null,
    CreatedAt: "2026-09-08T00:00:00Z", Mountpoint: `/var/lib/docker/volumes/${store.volumeName}/_data`,
    Labels: { "com.docker.compose.project": project } }));
  const network = { Id: id(8), Driver: "bridge", Internal: false,
    Options: { "com.docker.network.bridge.enable_ip_masquerade": "false" },
    Labels: { "com.docker.compose.project": project }, Containers: Object.fromEntries(containers.map(c => [c.Id, {}])) };
  const options = { inputs, objectClient: { containerId: id(7), imageId: `sha256:${id(7)}` },
    postgres: { database: "postgres", user: "postgres", password: "private-pg ' $() \\\"" },
    objects: { bucket: "isolated", accessKey: "private-access", secretKey: "private-objects ' $() \\\"" },
    redis: { database: 0, auth: { kind: "none" as const } } };
  const info = { postgres: { systemIdentifier: "123456789", databaseOid: "5", database: "postgres", user: "postgres", version: 160010 },
    deployment: { status: "success", info: { deploymentID: "actual-minio-deployment" } },
    buckets: { status: "success", key: "isolated/", lastModified: "2026-09-08T00:00:00Z" },
    versioning: { status: "success", versioning: { status: "" } },
    redis: "redis_version:7.4.0\r\nrun_id:" + "a".repeat(40) + "\r\n",
    persistence: "appendonly\nyes\nappendfsync\neverysec\nsave\n3600 1\ndir\n/data\ndbfilename\ndump.rdb\nappendfilename\nappendonly.aof\nappenddirname\nappendonlydir\ndatabases\n16\n",
    client: "id=42 addr=127.0.0.1:1234 db=0 user=default\n" };
  let beforeExec: (() => void) | undefined;
  seam.command.mockImplementation((args: string[]) => {
    if (args[0] === "inspect") return Buffer.from(JSON.stringify(args.slice(1).map(i => containers.find(c => c.Id === i))));
    if (args[0] === "volume") return Buffer.from(JSON.stringify(args.slice(2).map(name => volumes.find(v => v.Name === name))));
    if (args[0] === "network") return Buffer.from(JSON.stringify([network]));
    if (args[0] === "ps") return Buffer.from(inputs.source.stores.find(s => args.includes(`volume=${s.volumeName}`))!.containerId + "\n");
    if (args[0] === "exec") {
      beforeExec?.();
      if (args.includes("handoff-postgres")) return Buffer.from(JSON.stringify(info.postgres));
      if (args.includes("handoff-minio")) return Buffer.from(JSON.stringify(args.includes("admin") ? info.deployment : args.includes("version") ? info.versioning : info.buckets));
      if (args.includes("INFO")) return Buffer.from(info.redis);
      if (args.includes("CONFIG")) return Buffer.from(info.persistence);
      if (args.includes("CLIENT")) return Buffer.from(info.client);
    }
    throw new Error("private-command-failure");
  });
  return { options, containers, volumes, network, info, onExec(action: () => void) { beforeExec = action; } };
}
beforeEach(() => { seam.command.mockReset(); });

it("observes three store identities and the actual Redis database namespace without emitting private values", async () => {
  const f = fixture(); const observer = create(f.options);
  const first = await observer.observeDataIdentity(f.options.inputs);
  expect(first).toEqual({ postgres: expect.stringMatching(/^sha256:[a-f0-9]{64}$/), objectStore: expect.stringMatching(/^sha256:[a-f0-9]{64}$/), redis: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) });
  expect(await observer.observeDataIdentity(f.options.inputs)).toEqual(first);
  const argv = JSON.stringify(seam.command.mock.calls.map(call => call[0]));
  for (const secret of [f.options.postgres.password, f.options.objects.accessKey, f.options.objects.secretKey]) {
    expect(argv.includes(secret)).toBe(false); expect(JSON.stringify(first).includes(secret)).toBe(false);
  }
  expect(seam.command.mock.calls.some(call => call[1] instanceof Buffer && call[1].includes(f.options.postgres.password))).toBe(true);
});

it.each(["foreign-volume", "shared-volume", "wrong-helper", "foreign-network-member", "daemon"])("refuses %s before dispatching credentials", async fault => {
  const f = fixture();
  if (fault === "foreign-volume") f.volumes[0]!.Labels["com.docker.compose.project"] = "foreign";
  if (fault === "shared-volume") {
    const previous = seam.command.getMockImplementation()!;
    seam.command.mockImplementation((args, input) => args[0] === "ps" ? Buffer.from("9".repeat(64)) : previous(args, input));
  }
  if (fault === "wrong-helper") f.containers[6]!.Image = `sha256:${"9".repeat(64)}`;
  if (fault === "foreign-network-member") f.network.Containers["9".repeat(64)] = {};
  if (fault === "daemon") f.options.inputs.expectedDaemonId = "foreign";
  await expect(async () => create(f.options).observeDataIdentity(f.options.inputs)).rejects.toThrow(/^handoff-data-/);
  expect(seam.command.mock.calls.filter(call => call[0][0] === "exec")).toHaveLength(0);
});

it.each(["postgres", "minio", "redis", "namespace", "persistence"])("refuses an unsupported actual %s observation", async fault => {
  const f = fixture();
  if (fault === "postgres") f.info.postgres.database = "other";
  if (fault === "minio") f.info.deployment.info.deploymentID = "";
  if (fault === "redis") f.info.redis = "NOAUTH Authentication required\n";
  if (fault === "namespace") f.info.client = "db=1 user=default\n";
  if (fault === "persistence") f.info.persistence = "appendonly\nno\n";
  await expect(async () => create(f.options).observeDataIdentity(f.options.inputs)).rejects.toThrow(/^handoff-data-/);
});

it("refuses resource drift after a successful private command", async () => {
  const f = fixture(); f.onExec(() => { f.containers[3]!.State.Restarting = true; });
  await expect(create(f.options).observeDataIdentity(f.options.inputs)).rejects.toThrow(/^handoff-data-/);
});

it.each(["\n", "\r", "\0"])("rejects unsupported credential framing %j before reading resources", value => {
  const f = fixture(); f.options.postgres.password += value;
  expect(() => create(f.options)).toThrow(/^handoff-data-/);
  expect(seam.command).not.toHaveBeenCalled();
});

it("pins caller configuration and refuses a different handoff selection", async () => {
  const f = fixture(); const observer = create(f.options);
  f.options.inputs.source.stores[0]!.containerId = "9".repeat(64);
  await expect(observer.observeDataIdentity(f.options.inputs)).rejects.toThrow(/^handoff-data-/);
  expect(seam.command).not.toHaveBeenCalled();
});
