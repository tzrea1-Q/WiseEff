import { createHash } from "node:crypto";
import { lstat, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { expect, it, vi } from "vitest";
import * as handoff from "./handoff";
import { canonicalJson, openUpgradeJournal, sha256Prefixed } from "./journal";
import { openComparisonPlanSource } from "./comparisonSource";

// Real private files and issued OS holder; explicit PG/Docker/inventory ports.
// These cases prove lifecycle refusals, not actual P0 data or PG permission.
const state = vi.hoisted(() => ({ endpointActual: false, foreignHelper: false, endpointIds: [] as string[], stoppedContract: false, s7: true, manager: true, acquisitions: 0, relations: [] as string[], lockCount: 0, closed: 0, released: 0, poolClosed: 0, observed: {} as unknown,
  sourceSnapshot: { sourceInventoryFingerprint: `sha256:${"1".repeat(64)}`, records: [{ sourceKind: "parameter-spec", sourceId: "spec-1", payload: { id: "spec-1", marker: "source" }, sqlNullColumns: [] }] } }));
vi.mock("pg", async original => {
  const actual = await original<typeof import("pg")>();
  const { EventEmitter } = await import("node:events");
  class Pool extends EventEmitter {
    connect(callback: (error: undefined, client: unknown) => void) {
      const client = new actual.default.Client();
      Object.defineProperties(client.connection.stream, { remoteAddress: { value: "127.0.0.1" }, remotePort: { value: 5544 } });
      Object.assign(client, {
        release: () => { state.released++; }, end: async () => { state.closed++; },
        query: async (sql: string) => {
          if (sql.includes("current_schemas")) return { rows: [{ schemas: ["pg_catalog", "public"] }] };
          if (sql.includes("rolname as name")) return { rows: [{ oid: "10", name: "manager" }] };
          if (sql.includes("pg_control_system")) return { rowCount: 1, rows: [{ system_identifier: "123", database_oid: "99" }] };
          if (sql.includes("pg_try_advisory_lock")) { state.acquisitions++; return { rows: [{ acquired: true }] }; }
          if (sql.startsWith("lock table ")) { state.relations = sql.slice(11).split(" in share")[0]!.split(","); state.lockCount = state.relations.length; }
          if (sql.includes("from pg_catalog.pg_locks")) return { rows: [{ locked: state.lockCount, s7: state.s7, manager: state.manager }] };
          return { rows: [], rowCount: 0 };
        },
      });
      callback(undefined, client);
    }
    async end() { state.poolClosed++; }
  }
  return { ...actual, default: { ...actual.default, Pool } };
});
vi.mock("../../../../scripts/isolated-upgrade-docker", () => ({ createIsolatedUpgradeDocker: () => ({ daemonId: "synthetic-daemon",
  command: (args: string[]) => {
    if (args[0] === "inspect" && args.length > 2) return Buffer.from(JSON.stringify(args.slice(1).map(id => ({
      Id: id, Config: { Labels: { "wiseeff.controlled-recovery-run": id === "9".repeat(64) || state.foreignHelper && id === "f".repeat(64) ? "2".repeat(24) : "1".repeat(24) } },
      State: { Running: id === "a".repeat(64) }, NetworkSettings: { Networks: { fixed: { NetworkID: "8".repeat(64), IPAddress: "172.20.0.2" } } },
    }))));
    if (args[0] === "network") return Buffer.from(JSON.stringify([{ Id: "8".repeat(64), Driver: "bridge",
      Labels: { "wiseeff.controlled-recovery-run": "1".repeat(24) }, Options: { "com.docker.network.bridge.enable_ip_masquerade": "false" },
      Containers: Object.fromEntries(["a", "b", "c", "f"].map(id => [id.repeat(64), {}])),
    }]));
    throwIfResolverRead(args);
    return Buffer.from(JSON.stringify([{ Id: "a".repeat(64), Image: "synthetic-image", State: { Running: true, StartedAt: "fixed" },
    Mounts: [{ Name: "synthetic-volume", Destination: "/data" }], NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "5544" }] } } }]));
  } }) }));
vi.mock("./legacyWriterSource", async original => {
  const actual = await original<typeof import("./legacyWriterSource")>();
  return { ...actual, observeLegacySourceEndpoint: (input: Parameters<typeof actual.observeLegacySourceEndpoint>[0]) => {
    state.endpointIds = [...input.registeredIds];
    return state.endpointActual ? actual.observeLegacySourceEndpoint(input) : { managementPort: "5544" };
  } };
});

function throwIfResolverRead(args: string[]) {
  if (args[0] !== "inspect") throw new Error("unexpected-resolver-read-before-identity-refusal");
}
vi.mock("./handoff", async original => ({ ...await original<typeof import("./handoff")>(),
  inspectHandoff: async () => {
    if (state.stoppedContract) throw new Error("handoff-source-running-artifact-mismatch");
    return structuredClone(state.observed);
  },
  verifyStoppedHandoff: async () => structuredClone(state.observed),
}));
vi.mock("../../../../server/modules/catalog-cutover/mapping", () => ({ readLegacySourceRegistry: async () => [] }));
vi.mock("../../../../server/modules/catalog-cutover/conversionManifest", async original => ({
  ...await original<typeof import("../../../../server/modules/catalog-cutover/conversionManifest")>(),
  captureConversionSourceSnapshot: async () => structuredClone(state.sourceSnapshot),
}));
vi.mock("../../../../server/modules/catalog-cutover/comparisonRules", () => ({ captureComparisonP0Graph: async () => ({ catalog: "p0-graph-double" }) }));
vi.mock("../../../../server/modules/release-verification/comparison/planInventory", () => ({
  captureComparisonPlanInventory: async (_database: unknown, boundary: { observe(): Promise<unknown> }) => { await boundary.observe(); return Object.freeze({}); },
  assertComparisonPlanInventoryCurrent: async () => { throw new Error("unused-double"); },
}));

async function fixture(namespace = "synthetic-wiseeff-legacy") {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "comparison-source-")));
  const names = ["main", "api", "worker", "management"];
  const bodies = [`WISEEFF_API_ENV_FILE=${directory}/api\nWISEEFF_WORKER_ENV_FILE=${directory}/worker\nWISEEFF_MANAGEMENT_ENV_FILE=${directory}/management\n`,
    "DATABASE_URL=postgres://api:synthetic@postgres:5432/source\n", "DATABASE_URL=postgres://worker:synthetic@postgres:5432/source\n", `DATABASE_URL=postgres://restricted:synthetic@postgres:5432/source\nWISEEFF_UPGRADE_SOURCE_SYSTEM=${namespace}\n`];
  const bindings = [];
  for (let index = 0; index < names.length; index++) {
    const filename = path.join(directory, names[index]!);
    await writeFile(filename, bodies[index]!, { mode: 0o600, flag: "wx" });
    const stat = await lstat(filename);
    bindings.push({ path: filename, device: String(stat.dev), inode: String(stat.ino), digest: `sha256:${createHash("sha256").update(bodies[index]!).digest("hex")}` });
  }
  const body = { format: "wiseeff-fixed-entry-handoff-v1", inputs: { runId: "1".repeat(24), lockRoot: directory,
    journalPath: path.join(directory, "journal.json"), privateConfigPath: bindings[0]!.path, expectedDaemonId: "synthetic-daemon",
    candidate: { sha: "c".repeat(40) }, source: { sha: "b".repeat(40),
      applications: [{ service: "api", containerId: "d".repeat(64) }, { service: "worker", containerId: "e".repeat(64) }, { service: "web", containerId: "7".repeat(64) }],
      stores: [{ service: "postgres", containerId: "a".repeat(64), volumeName: "synthetic-volume", destination: "/data" },
        { service: "minio", containerId: "b".repeat(64) }, { service: "redis", containerId: "c".repeat(64) }] } },
    observation: { stores: [{ service: "postgres", id: "a".repeat(64), imageId: "synthetic-image" }], privateConfigurations: {
      main: bindings[0], runtime: { WISEEFF_API_ENV_FILE: bindings[1], WISEEFF_WORKER_ENV_FILE: bindings[2], WISEEFF_MANAGEMENT_ENV_FILE: bindings[3] } } } };
  const plan = { ...body, digest: sha256Prefixed(canonicalJson(body)) } as unknown as handoff.HandoffPlan;
  const opened = openUpgradeJournal({ journalPath: plan.inputs.journalPath, runId: plan.inputs.runId });
  if (!opened.ok) throw new Error("fixture-journal-unavailable");
  state.observed = plan.observation;
  return { directory, plan, registeredSourceContainerIds: ["a", "b", "c", "d", "e", "7", "f"].map(id => id.repeat(64)) };
}

it("refuses loss of the original S7 while the source relation locks still exist", async () => {
  const f = await fixture(); state.s7 = true; state.closed = state.released = state.poolClosed = 0;
  try {
    await handoff.withHostOperationLock(f.directory, async lock => {
      const lease = await openComparisonPlanSource({ ...f, handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock,
        observer: {} as handoff.HandoffObserver, administrativeConnectionString: "postgres://manager:synthetic@127.0.0.1:5544/source" });
      try { state.s7 = false; await expect(lease.verify()).rejects.toThrow("SOURCE-FENCE-LOST"); }
      finally { await lease.close(); }
      await expect(lease.verify()).rejects.toThrow("CONNECTION-LOST");
    });
  } finally { await rm(f.directory, { recursive: true }); }
  expect([state.closed, state.released, state.poolClosed]).toEqual([1, 1, 1]);
});

it("reopens under the existing manager and leaves its P0 registry writable while retaining source locks", async () => {
  const f = await fixture(); state.s7 = state.manager = true; state.acquisitions = 0;
  const ended = vi.fn();
  const manager = Object.assign(new pg.Client(), {
    query: vi.fn(async (sql: string) => sql.includes("pg_control_system") ?
      { rowCount: 1, rows: [{ system_identifier: "123", database_oid: "99" }] } : { rows: [{ pid: 1001 }] }),
    release: vi.fn(), end: ended,
  }) as unknown as pg.PoolClient;
  try {
    await handoff.withHostOperationLock(f.directory, async lock => {
      const plan = await openComparisonPlanSource({ ...f, handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock,
        observer: {} as handoff.HandoffObserver, administrativeConnectionString: "postgres://manager:synthetic@127.0.0.1:5544/source" });
      expect(state.relations).toContain("parameter_catalog.legacy_identities");
      await expect(plan.openForExecution(manager)).rejects.toThrow("PLAN-LEASE-STILL-OPEN");
      await plan.close();
      const executing = await plan.openForExecution(manager);
      try {
        expect(state.acquisitions).toBe(1);
        expect(state.relations).not.toContain("parameter_catalog.legacy_identities");
        expect(state.relations).toContain("public.parameter_specs");
        expect(state.relations).toContain("public.audit_events");
        state.manager = false;
        await expect(executing.verify()).rejects.toThrow("SOURCE-FENCE-LOST");
      } finally { await executing.close(); }
      expect(manager.release).not.toHaveBeenCalled();
      expect(ended).not.toHaveBeenCalled();
      expect(manager.listenerCount("error")).toBe(0);
    });
  } finally { await rm(f.directory, { recursive: true }); }
});

it("uses the original stopped-source management boundary rather than requiring the old applications to run", async () => {
  const f = await fixture(); state.s7 = state.manager = true; state.stoppedContract = true;
  try {
    await handoff.withHostOperationLock(f.directory, async lock => {
      const source = await openComparisonPlanSource({ ...f, handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock,
        observer: {} as handoff.HandoffObserver, administrativeConnectionString: "postgres://manager:synthetic@127.0.0.1:5544/source" });
      try { await expect(source.verify()).resolves.toMatchObject({ sourceSystem: "synthetic-wiseeff-legacy" }); }
      finally { await source.close(); }
    });
  } finally { state.stoppedContract = false; await rm(f.directory, { recursive: true }); }
});

it.each(["wrong-helper", "extra-foreign", "cross-run-helper"] as const)("uses actual endpoint admission for the original helper set: %s", async fault => {
  const f = await fixture(); state.s7 = state.manager = state.endpointActual = true;
  state.poolClosed = 0;
  state.foreignHelper = fault === "cross-run-helper";
  const registeredSourceContainerIds = fault === "wrong-helper" ? f.registeredSourceContainerIds.map(id => id === "f".repeat(64) ? "9".repeat(64) : id) :
    fault === "extra-foreign" ? [...f.registeredSourceContainerIds, "9".repeat(64)] : f.registeredSourceContainerIds;
  try {
    await handoff.withHostOperationLock(f.directory, async lock => {
      await expect(openComparisonPlanSource({ ...f, registeredSourceContainerIds, handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock,
        observer: {} as handoff.HandoffObserver, administrativeConnectionString: "postgres://manager:synthetic@127.0.0.1:5544/source" })).rejects.toThrow("OPEN-UNAVAILABLE");
      expect(state.endpointIds).toEqual(registeredSourceContainerIds);
      expect(state.poolClosed).toBe(0);
    });
  } finally { state.endpointActual = state.foreignHelper = false; await rm(f.directory, { recursive: true }); }
});

it("captures the original registered set before its first await", async () => {
  const f = await fixture(); state.s7 = state.manager = true;
  const original = [...f.registeredSourceContainerIds];
  try {
    await handoff.withHostOperationLock(f.directory, async lock => {
      const opening = openComparisonPlanSource({ ...f, handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock,
        observer: {} as handoff.HandoffObserver, administrativeConnectionString: "postgres://manager:synthetic@127.0.0.1:5544/source" });
      f.registeredSourceContainerIds.push("9".repeat(64));
      const source = await opening;
      try { await source.verify(); expect(state.endpointIds).toEqual(original); }
      finally { await source.close(); }
    });
  } finally { await rm(f.directory, { recursive: true }); }
});

it("does not let a caller-mutated source snapshot change the later producer view", async () => {
  const f = await fixture(); state.s7 = state.manager = true;
  try {
    await handoff.withHostOperationLock(f.directory, async lock => {
      const source = await openComparisonPlanSource({ ...f, handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock,
        observer: {} as handoff.HandoffObserver, administrativeConnectionString: "postgres://manager:synthetic@127.0.0.1:5544/source" });
      try {
        const callerView = source.conversionSourceSnapshot;
        Reflect.set(callerView.records[0]!.payload, "marker", "caller-tamper");
        Reflect.apply(Array.prototype.push, callerView.records as unknown as unknown[], [{ sourceKind: "parameter-spec", sourceId: "invented", payload: { id: "invented" }, sqlNullColumns: [] }]);
        expect(source.conversionSourceSnapshot).toEqual(state.sourceSnapshot);
      } finally { await source.close(); }
    });
  } finally { await rm(f.directory, { recursive: true }); }
});

it.each(["duplicate", "missing-source"] as const)("rejects an incomplete or ambiguous original registration: %s", async fault => {
  const f = await fixture(); state.s7 = state.manager = true;
  try {
    await handoff.withHostOperationLock(f.directory, async lock => {
      const registeredSourceContainerIds = fault === "duplicate" ? [...f.registeredSourceContainerIds, f.registeredSourceContainerIds[0]!] : f.registeredSourceContainerIds.slice(1);
      await expect(openComparisonPlanSource({ ...f, registeredSourceContainerIds, handoff: f.plan, expectedHandoffDigest: f.plan.digest, lock,
        observer: {} as handoff.HandoffObserver, administrativeConnectionString: "postgres://manager:synthetic@127.0.0.1:5544/source" })).rejects.toThrow("SOURCE-REGISTRATION-UNAVAILABLE");
    });
  } finally { await rm(f.directory, { recursive: true }); }
});
