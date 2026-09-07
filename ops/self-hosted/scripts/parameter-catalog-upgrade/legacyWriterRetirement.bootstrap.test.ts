import { mkdtemp, mkdir, realpath, stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { canonicalJson, sha256Prefixed } from "./journal";
import { retireLegacyApplicationLogins, inspectLegacyApplicationLoginFence, type LegacyLoginRetirementInput } from "./legacyWriterRetirement";

// Root orchestration only. These I/O substitutes do not prove authentic report
// approval, a P12 SQL commit, Docker identity, or a PostgreSQL password rotation.
const io = vi.hoisted(() => ({ apply: vi.fn(), inspect: vi.fn(), journal: vi.fn(),
  package: vi.fn(), docker: vi.fn(), activation: vi.fn(), report: vi.fn(),
  clients: [] as Array<{ kind: string; query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; emit(event: string): boolean }>,
  fault: "", rootEvents: [] as Array<{ payload: unknown }> }));
vi.mock("../../../../scripts/isolated-upgrade-docker", () => ({ createIsolatedUpgradeDocker: () => ({ daemonId: "daemon", command: io.docker }) }));
vi.mock("./legacyWriterSource", () => ({ observeLegacySourceEndpoint: () => ({ endpoint: "fixed" }) }));
vi.mock("./handoff", () => ({ assertHostOperationLockForJournal: async () => {} }));
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
}));
vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");
  class Client extends EventEmitter {
    kind: string;
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
    release = vi.fn(() => { this.emit("end"); });
    constructor(options: { connectionString?: string } = {}) { super(); this.kind = options.connectionString?.includes("guard") ? "guard" : "bootstrap"; io.clients.push(this); }
    async connect() {}
    async end() { this.emit("end"); }
  }
  class Pool extends EventEmitter {
    constructor(private options: { connectionString?: string }) { super(); }
    connect(callback: (error: null, client: Client) => void) { callback(null, new Client(this.options)); }
    async end() {}
  }
  return { default: { Pool, Client, escapeIdentifier: (v: string) => `"${v}"` } };
});

const roots: string[] = [];
beforeEach(() => { vi.clearAllMocks(); io.clients.length = 0; io.rootEvents.length = 0; io.fault = ""; });
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
    administrativeConnectionString: "postgres://postgres:old-secret@127.0.0.1/db", recoveryDirectory: root,
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

it("reopens only the recorded original custody for root inspection and never rotates again", async () => {
  const f = await fixture();
  await retireLegacyApplicationLogins(f.input);
  const first = io.apply.mock.calls[0][0].custody;
  await expect(inspectLegacyApplicationLoginFence(f.input)).resolves.toMatchObject({
    status: "bootstrap-authentication-inspected-not-p13", outcome: "authentication-fenced-not-P13", attemptId: "auth-attempt",
  });
  expect(io.apply).toHaveBeenCalledOnce();
  const reopened = io.inspect.mock.calls.at(-1)![0].custody;
  expect(reopened).not.toBe(first);
  expect(reopened.receipt).toEqual(first.receipt);
  expect(io.rootEvents).toHaveLength(1);
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("ATTEMPT-REQUIRES-RECONCILE");
  expect(io.apply).toHaveBeenCalledOnce();
  await expect(inspectLegacyApplicationLoginFence({ ...f.input, attemptId: "another-attempt" })).rejects.toThrow("BOOTSTRAP-ROOT-INTENT-MISMATCH");
  expect(io.apply).toHaveBeenCalledOnce();
});
