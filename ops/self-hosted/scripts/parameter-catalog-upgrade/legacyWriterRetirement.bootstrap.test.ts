import { mkdtemp, mkdir, realpath, stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { canonicalJson, sha256Prefixed } from "./journal";
import { retireLegacyApplicationLogins, inspectLegacyApplicationLoginFence, type LegacyLoginRetirementInput } from "./legacyWriterRetirement";

// Root orchestration only. These I/O substitutes do not prove authentic report
// approval, a P12 SQL commit, Docker identity, or a PostgreSQL password rotation.
const io = vi.hoisted(() => ({ apply: vi.fn(), inspect: vi.fn(), transportInspect: vi.fn(), journal: vi.fn(),
  package: vi.fn(), docker: vi.fn(), activation: vi.fn(), report: vi.fn(),
  pools: [] as string[],
  clients: [] as Array<{ kind: string; query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; emit(event: string): boolean }>,
  fault: "", hostRefused: false, sourceConnects: 0, closed: [] as string[], rootEvents: [] as Array<{ payload: unknown }> }));
vi.mock("node:fs/promises", async original => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    const close = handle.close.bind(handle);
    handle.close = async () => { io.closed.push("file"); await close(); };
    return handle;
  } };
});
vi.mock("../../../../scripts/isolated-upgrade-docker", () => ({ createIsolatedUpgradeDocker: () => ({ daemonId: "daemon", command: io.docker }) }));
vi.mock("./legacyWriterSource", () => ({ observeLegacySourceEndpoint: () => ({ endpoint: "fixed", managementPort: "15432" }) }));
vi.mock("./handoff", () => ({ assertHostOperationLockForJournal: async () => {
  if (io.fault === "host-lock") { io.hostRefused = true; throw new Error("private-lock-diagnostic"); }
} }));
vi.mock("./journal", async original => ({ ...await original<typeof import("./journal")>(), loadUpgradeJournal: io.journal }));
vi.mock("../../storage/recoveryPackage", () => ({ verifyRecoveryPackage: io.package }));
vi.mock("../../../../server/modules/catalog-cutover/activation", () => ({ createApplicationReadActivation: io.activation }));
vi.mock("../../../../server/modules/release-verification/report/index", () => ({ createVerificationReportService: () => ({ readReport: io.report }) }));
vi.mock("../../../../server/modules/parameter-bindings/cutoverImport/sourceBoundary", () => ({
  readBindingDatabaseIdentity: async (client: { kind: string }) => ({ systemIdentifier: "100",
    databaseOid: io.fault === "guard-target" && client.kind === "guard" ? "201" : "200" }),
}));
vi.mock("../../../../server/modules/catalog-cutover/retirement/bootstrapCredentialFence", async original => ({
  ...await original<typeof import("../../../../server/modules/catalog-cutover/retirement/bootstrapCredentialFence")>(),
  applyBootstrapCredentialFence: io.apply, inspectBootstrapCredentialFence: io.inspect,
  inspectBootstrapCredentialFenceFromCustodyTransport: io.transportInspect,
}));
vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");
  const { Socket } = await import("node:net");
  class Client extends EventEmitter {
    kind: string;
    // Synthetic pg transport: these socket observations are controlled by the
    // fixture, not evidence of an actual PostgreSQL/Docker connection.
    connection = { stream: new Socket() };
    query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("event_kind=$2 order by sequence_number")) return { rows: [...io.rootEvents], rowCount: io.rootEvents.length };
      if (sql.includes("insert into parameter_catalog.parameter_catalog_cutover_events")) {
        io.rootEvents.push({ payload: JSON.parse(values![3] as string) });
      }
      if (sql.includes("as admitted")) return { rows: [{ oid: "10", name: "postgres", database: "db", admitted: true }], rowCount: 1 };
      if (sql.includes("as same;")) return { rows: [{ pid: 1001, name: "postgres", same: true }], rowCount: 1 };
      if (sql.includes("select pg_backend_pid() as pid")) return { rows: [{ pid: 1002, oid: "20000", same: true }], rowCount: 1 };
      if (sql.includes("count(distinct relation)")) return { rows: [{ count: io.fault === "guard-lock" ? 5 : 6 }], rowCount: 1 };
      if (sql.includes("classid=824014")) return { rows: [{ count: io.fault === "guard-target" ? 0 : 1 }], rowCount: 1 };
      if (sql.includes("as count")) return { rows: [{ count: 1 }], rowCount: 1 };
      if (sql.includes("as held")) return { rows: [{ held: io.fault !== "s7-lock" }], rowCount: 1 };
      if (sql.includes("as safe")) return { rows: [{ safe: io.fault !== "guard-role" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    release = vi.fn(() => { this.emit("end"); if (this.kind === "guard" && io.fault === "reader-release") throw new Error("private-release-diagnostic"); });
    constructor(options: { connectionString?: string } = {}) {
      super(); this.kind = options.connectionString?.includes("guard") ? "guard" : "bootstrap";
      Object.defineProperties(this.connection.stream, {
        remoteAddress: { get: () => io.fault === "inspection-peer-host" ? "127.0.0.2" : "127.0.0.1" },
        remotePort: { get: () => io.fault === "inspection-peer-port" ? 25432 : 15432 },
      });
      io.clients.push(this);
    }
    async connect() { io.sourceConnects++; if (io.fault === "old-secret-rejected") throw new Error("private-authentication-refused"); }
    async end() { this.emit("end"); }
  }
  class Pool extends EventEmitter {
    constructor(private options: { connectionString?: string }) { super(); io.pools.push(options.connectionString ?? "unspecified"); }
    connect(callback: (error: null, client: Client) => void) {
      const client = new Client(this.options); callback(null, client);
      if (client.kind === "guard" && io.fault === "reader-end-at-checkout") client.emit("end");
    }
    end() { io.closed.push("pool"); if (io.fault === "pool-close") throw new Error("private-pool-diagnostic"); return Promise.resolve(); }
  }
  return { default: { Pool, Client, escapeIdentifier: (v: string) => `"${v}"` } };
});

const roots: string[] = [];
beforeEach(() => { vi.clearAllMocks(); io.pools.length = 0; io.clients.length = 0; io.rootEvents.length = 0; io.closed.length = 0; io.fault = ""; io.hostRefused = false; io.sourceConnects = 0; });
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true }); });

async function fixture() {
  const operationRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "bootstrap-retirement-unit-")));
  roots.push(operationRoot);
  const root = path.join(operationRoot, "recovery");
  await mkdir(root, { mode: 0o700 });
  const directory = await stat(root);
  const target = { systemIdentifier: "100", databaseOid: "200" };
  const sha = "a".repeat(40), hash = `sha256:${"b".repeat(64)}`;
  const source = { deploymentId: "deployment", hostFingerprint: "host", postgresIdentity: "pg" };
  const activationIntent = { runId: "cutover", attemptId: "p12", target, planDigest: hash, reportDigest: hash };
  const binding = { version: "pcat-activation-v1", intent: activationIntent, bindingDigest: hash,
    sourceSnapshotFingerprint: hash, catalog: { releaseId: "release", releaseDigest: hash }, mapping: { epoch: hash, headDigest: hash } };
  const inspection = { kind: "applied", binding, currentHeadDigest: hash };
  io.activation.mockReturnValue({ inspect: async () => inspection, inspectOnHeldManagementSession: async () => inspection });
  io.apply.mockResolvedValue({ outcome: "authentication-fenced-not-P13", intentDigest: hash });
  io.inspect.mockResolvedValue({ outcome: "authentication-fenced-not-P13", intentDigest: hash });
  io.transportInspect.mockResolvedValue({ outcome: "authentication-fenced-not-P13", intentDigest: hash });
  io.report.mockResolvedValue({ kind: "present", report: { digest: hash, purpose: "pre-activation", decision: "passed",
    pins: { artifact: { gitSha: sha }, cutover: { planDigest: hash, sourceSnapshotFingerprint: hash },
      catalog: binding.catalog, mappingArchive: { mappingEpoch: hash, mappingHeadDigest: hash },
      recovery: { recoveryPointDigest: hash }, target: { deploymentId: "deployment", hostFingerprint: "host" },
      database: { targetIdentity: "pg" } } } });
  io.journal.mockReturnValue({ ok: true, value: { record: { journalDigest: hash, cutoverRunId: "cutover", entries: [{ seq: 1, action: "recovery-capture-committed",
    recoveryCapture: { outcome: "committed", directory: { path: root, device: String(directory.dev), inode: String(directory.ino) },
      capture: { runId: "hostrun", packageDigest: hash, recoveryPointDigest: hash, source } } }] } } });
  io.package.mockResolvedValue({ digest: hash, bootstrap: { roleName: "postgres" }, roles: [],
    manifest: { recovery: { runId: "hostrun", recoveryPointDigest: hash, target: source } } });
  const applications = ["api", "web", "worker"].map(service => ({ service, containerId: service, imageId: "image", imageReference: "source" }));
  io.docker.mockImplementation((args: string[]) => {
    const service = args[1];
    return Buffer.from(JSON.stringify([{ Id: service, Image: "image", Config: { Image: "source",
      Labels: { "com.docker.compose.project": "project", "com.docker.compose.service": service },
      Env: ["DATABASE_URL=postgres://postgres:old-secret@postgres/db"] },
      State: { Status: "exited", Running: false, Restarting: false } }]));
  });
  const body = { format: "wiseeff-fixed-entry-handoff-v1", inputs: { runId: "hostrun", expectedDaemonId: "daemon",
    journalPath: path.join(operationRoot, "journal.json"), lockRoot: operationRoot,
    source: { project: "project", applications, stores: [{ service: "postgres", containerId: "postgres" }] }, candidate: { sha } }, observation: {} };
  const digest = sha256Prefixed(canonicalJson(body));
  const pg = (await import("pg")).default;
  const custodyDirectory = path.join(operationRoot, "credentials");
  await mkdir(custodyDirectory, { mode: 0o700 });
  const input = { handoff: { ...body, digest }, expectedHandoffDigest: digest, lock: {},
    activation: { target, reports: {}, managementPool: new pg.Pool({ connectionString: "postgres://guard@127.0.0.1/db" }),
      boundary: { verify: async () => {} } }, activationIntent, attemptId: "auth-attempt",
    administrativeConnectionString: "postgres://postgres:old-secret@127.0.0.1:15432/db", recoveryDirectory: root,
    bootstrapCredentialDirectory: custodyDirectory } as unknown as LegacyLoginRetirementInput;
  return { input, custodyDirectory };
}

it("the OID10 root route consumes the controlled authentication fence with its exact custody", async () => {
  const f = await fixture();
  await expect(retireLegacyApplicationLogins(f.input)).resolves.toMatchObject({ status: "bootstrap-authentication-fenced-not-p13" });
  expect(io.apply).toHaveBeenCalledOnce();
  expect(io.apply.mock.calls[0][0]).toMatchObject({ runId: "cutover", attemptId: "auth-attempt", custody: { receipt: { version: expect.stringMatching(/^[a-f0-9]{32}$/) } } });
  expect(io.rootEvents).toHaveLength(1);
  expect(JSON.stringify(io.rootEvents)).not.toContain("old-secret");
  expect(io.clients.every(client => client.kind !== "guard" || client.query.mock.calls.every(([sql]) => !String(sql).includes("s7-orc-cutover-target")))).toBe(true);
  expect(io.clients.flatMap(client => client.query.mock.calls).every(([sql]) => !String(sql).includes("cutover_checkpoints"))).toBe(true);
});

it.each(["guard-target", "guard-role", "guard-lock", "s7-lock"])("refuses %s before recording an intent or invoking the authentication effect", async fault => {
  const f = await fixture(); io.fault = fault;
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("PCAT-UPG-LEGACY-LOGIN-");
  expect(io.apply).not.toHaveBeenCalled(); expect(io.rootEvents).toEqual([]);
  expect(io.clients.find(client => client.kind === "guard")?.release).toHaveBeenCalledOnce();
});

it("never chooses a default credential directory", async () => {
  const f = await fixture(); delete f.input.bootstrapCredentialDirectory;
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("BOOTSTRAP-CUSTODY-REQUIRED");
  expect(io.apply).not.toHaveBeenCalled(); expect(io.rootEvents).toEqual([]);
});

it("destroys the mutating lease when its independent inventory guard disappears and retains unknown", async () => {
  const f = await fixture();
  io.apply.mockImplementationOnce(async () => {
    io.clients.find(client => client.kind === "guard")!.emit("error");
    return { outcome: "authentication-fenced-not-P13", intentDigest: "ignored" };
  });
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("TRANSACTION-OUTCOME-UNKNOWN");
  expect(io.clients[0].release).toHaveBeenCalledOnce();
  expect(io.rootEvents).toHaveLength(1);
});

it("also destroys the mutator on a guard end without an error event", async () => {
  const f = await fixture();
  io.apply.mockImplementationOnce(async () => { io.clients.find(client => client.kind === "guard")!.emit("end"); });
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("TRANSACTION-OUTCOME-UNKNOWN");
  expect(io.clients[0].release).toHaveBeenCalledOnce();
  expect(io.rootEvents).toHaveLength(1);
});

it("installs the root's live host check before the low-level effect can continue", async () => {
  const f = await fixture();
  io.apply.mockImplementationOnce(async command => {
    io.fault = "host-lock";
    await command.beforeEffect();
    throw new Error("must-not-pass-lost-root-boundary");
  });
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("TRANSACTION-OUTCOME-UNKNOWN");
  expect(io.hostRefused).toBe(true);
  expect(io.rootEvents).toHaveLength(1);
});

it("rechecks an expired report projection before the low-level effect can continue", async () => {
  const f = await fixture();
  let continued = false;
  io.apply.mockImplementationOnce(async command => {
    // Simulate the formal projection becoming unavailable after the first
    // intent commit. This is root orchestration coverage, not a passed SQL report.
    io.report.mockResolvedValue({ kind: "absent", reason: "missing" });
    await command.beforeEffect();
    continued = true;
    return { outcome: "authentication-fenced-not-P13", intentDigest: "ignored" };
  });
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("TRANSACTION-OUTCOME-UNKNOWN");
  expect(continued).toBe(false);
  expect(io.rootEvents).toHaveLength(1);
});

it.each([false, true])("attempts every close after a synchronous pool close failure, retaining prior refusal=%s", async priorFailure => {
  const f = await fixture(); io.fault = "pool-close";
  if (priorFailure) io.apply.mockRejectedValueOnce(new Error("private-admission-detail"));
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow(priorFailure ? "TRANSACTION-OUTCOME-UNKNOWN" : "RESOURCE-CLOSE-FAILED");
  const poolClose = io.closed.indexOf("pool");
  expect(poolClose).toBeGreaterThanOrEqual(0);
  // The directory and held custody descriptors must still be closed after the
  // first cleanup operation throws synchronously.
  expect(io.closed.slice(poolClose + 1).filter(value => value === "file").length).toBeGreaterThanOrEqual(3);
});

it("cannot use the source backup directory as new secret custody", async () => {
  const f = await fixture(); f.input.bootstrapCredentialDirectory = f.input.recoveryDirectory;
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("BOOTSTRAP-CUSTODY-DIRECTORY-INVALID");
  expect(io.apply).not.toHaveBeenCalled(); expect(io.rootEvents).toEqual([]);
});

it("does not reach bootstrap preparation when the actual P12 report projection refuses", async () => {
  const f = await fixture(); io.report.mockResolvedValue({ kind: "absent", reason: "unapproved" });
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("P12-REPORT-UNAVAILABLE");
  expect(io.apply).not.toHaveBeenCalled(); expect(io.rootEvents).toEqual([]);
});

it("selects retained custody through the formal facade and never retries rotation during inspection", async () => {
  const f = await fixture();
  await retireLegacyApplicationLogins(f.input);
  const sourceConnections = io.sourceConnects;
  io.fault = "old-secret-rejected";
  // The facade owns actual FD reopen and is covered by its independent PG
  // process tests. The root must neither supply a new secret nor retry apply.
  await expect(inspectLegacyApplicationLoginFence(f.input)).resolves.toMatchObject({
    status: "bootstrap-authentication-inspected-not-p13", outcome: "authentication-fenced-not-P13", attemptId: "auth-attempt",
  });
  expect(io.apply).toHaveBeenCalledOnce();
  expect(io.transportInspect.mock.calls[0][0].expectedRootBinding.custodyDirectory).toBe(f.custodyDirectory);
  expect(io.inspect).toHaveBeenCalledOnce();
  expect(io.sourceConnects).toBe(sourceConnections);
  expect(io.rootEvents).toHaveLength(1);
  io.fault = "";
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("ATTEMPT-REQUIRES-RECONCILE");
  expect(io.apply).toHaveBeenCalledOnce();
  io.transportInspect.mockResolvedValueOnce({ outcome: "unknown" });
  await expect(inspectLegacyApplicationLoginFence({ ...f.input, attemptId: "another-attempt" })).resolves.toMatchObject({ outcome: "unknown" });
  expect(io.transportInspect.mock.calls.at(-1)![0].expectedRootBinding.attemptId).toBe("another-attempt");
  expect(io.apply).toHaveBeenCalledOnce();
});

it("dispatches bootstrap inspection through the borrowed management transport before constructing an old-secret pool", async () => {
  const f = await fixture();
  await retireLegacyApplicationLogins(f.input);
  const poolCount = io.pools.length, clientCount = io.clients.length;
  const originalManagementInput = f.input.administrativeConnectionString;
  io.fault = "old-secret-rejected";
  await expect(inspectLegacyApplicationLoginFence(f.input)).resolves.toMatchObject({
    status: "bootstrap-authentication-inspected-not-p13", outcome: "authentication-fenced-not-P13",
  });
  expect(io.transportInspect).toHaveBeenCalledOnce();
  const selected = io.transportInspect.mock.calls[0][0];
  const retained = (io.rootEvents[0].payload as { request: Record<string, unknown> }).request;
  const { credentials: _credentials, ...expectedRootBinding } = retained;
  expect(selected.expectedRootBinding).toEqual(expectedRootBinding);
  expect(selected.managementClient.kind).toBe("guard");
  expect(io.pools).toHaveLength(poolCount);
  expect(io.clients.slice(clientCount).map(client => client.kind)).toEqual(["guard"]);
  expect(selected.managementClient.release).toHaveBeenCalledOnce();
  expect(f.input.administrativeConnectionString === originalManagementInput).toBe(true);
  expect(io.apply).toHaveBeenCalledOnce();
  expect(io.inspect).toHaveBeenCalledOnce();
});

it.each(["inspection-peer-port", "inspection-peer-host"])("rejects %s despite matching database identity before dispatching private custody", async fault => {
  const f = await fixture(); io.fault = fault;
  await expect(inspectLegacyApplicationLoginFence(f.input)).rejects.toThrow("SOURCE-ENDPOINT-UNPROVEN");
  expect(io.transportInspect).not.toHaveBeenCalled();
  expect(io.clients[0].release).toHaveBeenCalledOnce();
  expect(io.apply).not.toHaveBeenCalled(); expect(io.pools).toHaveLength(1);
});

it.each(["port", "replacement"])("rejects borrowed socket %s drift during the facade's held boundary", async fault => {
  const f = await fixture();
  let continued = false;
  io.transportInspect.mockImplementationOnce(async selected => {
    if (fault === "port") io.fault = "inspection-peer-port";
    else {
      const { Socket } = await import("node:net");
      const stream = new Socket();
      Object.defineProperties(stream, { remoteAddress: { value: "127.0.0.1" }, remotePort: { value: 15432 } });
      selected.managementClient.connection.stream = stream;
    }
    await selected.activation.boundary.verify();
    continued = true;
    return { outcome: "authentication-fenced-not-P13", intentDigest: "ignored" };
  });
  await expect(inspectLegacyApplicationLoginFence(f.input)).rejects.toThrow("SOURCE-ENDPOINT-UNPROVEN");
  expect(continued).toBe(false); expect(io.clients[0].release).toHaveBeenCalledOnce();
  expect(io.apply).not.toHaveBeenCalled(); expect(io.pools).toHaveLength(1);
});

it.each(["report", "package", "host-lock", "source-role", "bootstrap-package"])("rejects inspection %s before dispatch or any new secret transport", async fault => {
  const f = await fixture();
  if (fault === "report") io.report.mockResolvedValue({ kind: "absent", reason: "missing" });
  if (fault === "package") io.package.mockRejectedValue(new Error("private-package-diagnostic"));
  if (fault === "host-lock") io.fault = "host-lock";
  if (fault === "source-role") {
    const inspect = io.docker.getMockImplementation()!;
    io.docker.mockImplementation((args: string[]) => {
      const value = JSON.parse(inspect(args).toString());
      value[0].Config.Env = ["DATABASE_URL=postgres://other:old-secret@postgres/db"];
      return Buffer.from(JSON.stringify(value));
    });
  }
  if (fault === "bootstrap-package") {
    const backup = await io.package(); delete backup.bootstrap; io.package.mockResolvedValue(backup);
  }
  let rejected: unknown;
  try { await inspectLegacyApplicationLoginFence(f.input); } catch (error) { rejected = error; }
  expect(rejected).toMatchObject({ name: "Error", reason: expect.any(String) });
  expect(String(rejected).includes("private-")).toBe(false);
  expect(io.transportInspect).not.toHaveBeenCalled();
  expect(io.pools).toHaveLength(1); // Only the fixture's pre-existing borrowed pool.
  expect(io.apply).not.toHaveBeenCalled();
});

it.each(["report", "host-lock", "source-configuration"])("retains the live root %s check inside the facade's held boundary", async fault => {
  const f = await fixture();
  let continued = false;
  io.transportInspect.mockImplementationOnce(async selected => {
    if (fault === "report") io.report.mockResolvedValue({ kind: "absent", reason: "missing" });
    else if (fault === "host-lock") io.fault = "host-lock";
    else {
      const inspect = io.docker.getMockImplementation()!;
      io.docker.mockImplementation((args: string[]) => {
        const value = JSON.parse(inspect(args).toString());
        value[0].Config.Env = ["DATABASE_URL=postgres://postgres:changed-private-secret@postgres/db"];
        return Buffer.from(JSON.stringify(value));
      });
    }
    await selected.activation.boundary.verify();
    continued = true;
    return { outcome: "authentication-fenced-not-P13", intentDigest: "ignored" };
  });
  await expect(inspectLegacyApplicationLoginFence(f.input)).rejects.toThrow("PCAT-UPG-LEGACY-LOGIN-");
  expect(continued).toBe(false);
  expect(io.clients[0].release).toHaveBeenCalledOnce();
  expect(io.closed).not.toContain("pool");
  expect(io.apply).not.toHaveBeenCalled(); expect(io.rootEvents).toEqual([]);
});

it("refuses report drift after facade readback and releases only the borrowed lease", async () => {
  const f = await fixture();
  io.transportInspect.mockImplementationOnce(async () => {
    io.report.mockResolvedValue({ kind: "absent", reason: "missing" });
    return { outcome: "authentication-fenced-not-P13", intentDigest: "ignored" };
  });
  await expect(inspectLegacyApplicationLoginFence(f.input)).rejects.toThrow("P12-REPORT-UNAVAILABLE");
  expect(io.clients[0].release).toHaveBeenCalledOnce(); expect(io.closed).not.toContain("pool");
});

it("refuses a changed current P12 binding after facade readback without retrying authentication", async () => {
  const f = await fixture();
  io.transportInspect.mockImplementationOnce(async () => {
    io.activation.mock.results[0].value.inspect = async () => ({ kind: "not-applied" });
    return { outcome: "authentication-fenced-not-P13", intentDigest: "ignored" };
  });
  await expect(inspectLegacyApplicationLoginFence(f.input)).rejects.toThrow("P12-CURRENT-STATE-DRIFT");
  expect(io.clients[0].release).toHaveBeenCalledOnce();
  expect(io.apply).not.toHaveBeenCalled(); expect(io.pools).toHaveLength(1);
});

it("returns the borrowed management lease before the final P12 read needs the same max-one pool", async () => {
  const f = await fixture();
  const activation = io.activation.getMockImplementation()!();
  const inspect = activation.inspect;
  activation.inspect = async () => {
    if (io.clients.some(client => client.kind === "guard" && client.release.mock.calls.length === 0)) {
      throw new Error("management-pool-capacity-held-by-inspection");
    }
    return inspect();
  };
  io.activation.mockReturnValue(activation);
  await expect(inspectLegacyApplicationLoginFence(f.input)).resolves.toMatchObject({ outcome: "authentication-fenced-not-P13" });
  expect(io.clients[0].release).toHaveBeenCalledOnce();
  expect(io.closed).not.toContain("pool");
});

it("retains the original activation boundary within inspection and snapshots caller selection", async () => {
  const f = await fixture();
  const original = vi.fn(async () => {});
  f.input.activation.boundary.verify = original;
  io.transportInspect.mockImplementationOnce(async selected => {
    const previousCalls = original.mock.calls.length;
    f.input.attemptId = "changed-after-dispatch";
    Object.assign(f.input.activationIntent, { runId: "changed-after-dispatch" });
    await selected.activation.boundary.verify();
    expect(original.mock.calls.length).toBeGreaterThan(previousCalls);
    expect(selected.expectedRootBinding.attemptId).toBe("auth-attempt");
    expect(selected.expectedRootBinding.activationIntent.runId).toBe("cutover");
    return { outcome: "unknown" };
  });
  await expect(inspectLegacyApplicationLoginFence(f.input)).resolves.toMatchObject({ outcome: "unknown", attemptId: "auth-attempt" });
  expect(io.apply).not.toHaveBeenCalled(); expect(io.pools).toHaveLength(1);
});

it("observes borrowed-client end synchronously during checkout before dispatch", async () => {
  const f = await fixture(); io.fault = "reader-end-at-checkout";
  await expect(inspectLegacyApplicationLoginFence(f.input)).rejects.toThrow("CONNECTION-FAILED");
  expect(io.transportInspect).not.toHaveBeenCalled();
  expect(io.clients[0].release).toHaveBeenCalledOnce(); expect(io.closed).not.toContain("pool");
});

it.each([false, true])("attempts file cleanup after borrowed release fails, retaining prior refusal=%s", async priorFailure => {
  const f = await fixture(); io.fault = "reader-release";
  if (priorFailure) io.transportInspect.mockRejectedValueOnce(new Error("private-facade-diagnostic"));
  await expect(inspectLegacyApplicationLoginFence(f.input)).rejects.toThrow(priorFailure ? "OPERATION-FAILED" : "RESOURCE-CLOSE-FAILED");
  expect(io.clients[0].release).toHaveBeenCalledOnce();
  expect(io.closed).toContain("file"); expect(io.closed).not.toContain("pool");
});
