import { mkdtemp, mkdir, realpath, stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { canonicalJson, sha256Prefixed, openUpgradeJournal, commitJournalTransition, loadUpgradeJournal } from "./journal";
import { createActivationIntent } from "../../../../server/modules/catalog-cutover/activation/records";
import { retireLegacyApplicationLogins, inspectLegacyApplicationLoginFence, type LegacyLoginRetirementInput } from "./legacyWriterRetirement";

// Root orchestration only. These I/O substitutes do not prove authentic report
// approval, a P12 SQL commit, Docker identity, or a PostgreSQL password rotation.
const io = vi.hoisted(() => ({ apply: vi.fn(), sqlPrivilegeEffect: vi.fn(), runtimeRoles: vi.fn(), inspect: vi.fn(), transportInspect: vi.fn(), journal: vi.fn(),
  package: vi.fn(), docker: vi.fn(), activation: vi.fn(), report: vi.fn(),
  ordinary: false, ordinaryFenced: false, pools: [] as string[],
  clients: [] as Array<{ kind: string; query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; emit(event: string): boolean }>,
  fault: "", fsyncDirectoryInode: -1, hostRefused: false, sourceConnects: 0, closed: [] as string[], rootEvents: [] as Array<{ payload: unknown }> }));
vi.mock("node:fs", async original => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, fsyncSync(fd: number) {
    if (io.fault === "host-fsync" || io.fault === "host-directory-fsync" && actual.fstatSync(fd).ino === io.fsyncDirectoryInode) throw new Error("private-fsync-diagnostic");
    return actual.fsyncSync(fd);
  } };
});
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
vi.mock("../../../../server/modules/catalog-cutover/retirement/legacySqlPrivilegeFence", () => ({
  applyLegacySqlPrivilegeFence: io.sqlPrivilegeEffect,
}));
vi.mock("../../../../server/modules/catalog-cutover/retirement/loginFence", async original => ({
  ...await original<typeof import("../../../../server/modules/catalog-cutover/retirement/loginFence")>(),
  assertNoSharedLegacyRoleUse: async () => {},
  applyLegacyLoginFence: async () => { io.ordinaryFenced = true; },
}));
vi.mock("./runtimeRoleSource", () => ({ openRuntimeRoleSource: async () => ({ close: async () => { io.closed.push("runtime-source"); } }),
  observeRuntimeRoles: io.runtimeRoles,
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
      if (io.ordinary && sql.includes("r.rolname=any($1::text[])")) return { rows: [{ oid: "20003", name: "old_application",
        login: !io.ordinaryFenced, inherit: true, privileged: false, members: [], callers: [{ oid: "20003", name: "old_application" }] }], rowCount: 1 };
      if (sql.includes("event_kind=$2 order by sequence_number")) return { rows: [...io.rootEvents], rowCount: io.rootEvents.length };
      if (sql.includes("insert into parameter_catalog.parameter_catalog_cutover_events")) {
        io.rootEvents.push({ payload: JSON.parse(values![3] as string) });
      }
      if (sql.includes("as admitted")) return { rows: [{ oid: "10", name: "postgres", database: "db", admitted: true }], rowCount: 1 };
      if (sql.includes("as same;")) return { rows: [{ pid: 1001, name: io.ordinary ? "old_application" : "postgres", same: true }], rowCount: 1 };
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
beforeEach(() => { vi.clearAllMocks(); io.ordinary = false; io.ordinaryFenced = false; io.pools.length = 0; io.clients.length = 0; io.rootEvents.length = 0; io.closed.length = 0; io.fault = ""; io.hostRefused = false; io.sourceConnects = 0; });
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true }); });

async function fixture() {
  const operationRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "bootstrap-retirement-unit-")));
  roots.push(operationRoot);
  const root = path.join(operationRoot, "recovery");
  await mkdir(root, { mode: 0o700 });
  const directory = await stat(root);
  const target = { systemIdentifier: "100", databaseOid: "200" };
  const sha = "a".repeat(40), hash = `sha256:${"b".repeat(64)}`;
  io.sqlPrivilegeEffect.mockImplementation(async command => {
    await command.persistHostIntent({ intentDigest: hash }); await command.beforeEffect();
    await command.persistHostStep(hash);
    return { outcome: "legacy-sql-privileges-fenced-not-P13", intentDigest: hash };
  });
  const source = { deploymentId: "deployment", hostFingerprint: "host", postgresIdentity: "pg", objectStoreIdentity: "objects", redisIdentity: "redis" };
  const activationIntent = structuredClone(createActivationIntent({ runId: "cutover", attemptId: "p12", target, planDigest: hash, reportDigest: hash,
    predecessorBindingDigest: null, expectedObservationDigest: hash }));
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
  const actualJournal = await vi.importActual<typeof import("./journal")>("./journal");
  io.journal.mockImplementation(actualJournal.loadUpgradeJournal);
  const opened = openUpgradeJournal({ journalPath: path.join(operationRoot, "journal.json"), runId: "hostrun" });
  if (!opened.ok) throw new Error("fixture-journal-unavailable");
  expect(commitJournalTransition(opened.value, { action: "bind-cutover", inputDigest: "bind", cutoverRunId: "cutover",
    planDigest: hash, toState: "idle", nextAction: "plan" }).ok).toBe(true);
  const pending = { runId: "hostrun", attemptId: "capture", outcome: "pending" as const, source,
    directory: { path: root, device: String(directory.dev), inode: String(directory.ino) } };
  const capture = { runId: "hostrun", packageDigest: "b".repeat(64), recoveryPointDigest: hash, source, boundaryDigest: "c".repeat(64) };
  for (const event of [pending, { ...pending, outcome: "committed" as const, capture }]) {
    expect(commitJournalTransition(opened.value, { action: event.outcome === "pending" ? "recovery-capture-pending" : "recovery-package-captured",
      inputDigest: sha256Prefixed(canonicalJson(event.outcome === "pending" ? event : capture)), toState: "idle", nextAction: "plan",
      outcome: event.outcome === "pending" ? "crashed" : "committed", recoveryCapture: event }).ok).toBe(true);
  }
  io.package.mockResolvedValue({ digest: capture.packageDigest, bootstrap: { roleName: "postgres" }, roles: [],
    manifest: { recovery: { runId: "hostrun", recoveryPointDigest: hash, target: source } } });
  const applications = ["api", "web", "worker"].map(service => ({ service, containerId: service, imageId: "image", imageReference: "source" }));
  io.docker.mockImplementation((args: string[]) => {
    const service = args[1];
    return Buffer.from(JSON.stringify([{ Id: service, Image: "image", Config: { Image: "source",
      Labels: { "com.docker.compose.project": "project", "com.docker.compose.service": service },
      Env: [`DATABASE_URL=postgres://${io.ordinary ? "old_application" : "postgres"}:old-secret@postgres/db`] },
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
  io.runtimeRoles.mockResolvedValue({ scope: "management-time-configured-logins-only", runId: "hostrun", handoffDigest: digest,
    target, roles: [{ service: "api", purpose: "application", oid: "20001", name: "candidate_api" },
      { service: "worker", purpose: "application", oid: "20002", name: "candidate_worker" }] });
  return { input, custodyDirectory };
}

const retirementEvents = (input: LegacyLoginRetirementInput) => {
  const loaded = loadUpgradeJournal({ journalPath: input.handoff.inputs.journalPath, runId: "hostrun" });
  if (!loaded.ok) throw new Error("fixture-journal-unavailable");
  return loaded.value.record.entries.filter(entry => entry.action.startsWith("bootstrap-retirement-"));
};

it("continues ordinary LOGIN retirement through the existing SQL effect using observed candidate roles", async () => {
  const f = await fixture();
  io.ordinary = true;
  delete f.input.bootstrapCredentialDirectory;
  const originalPackage = await io.package();
  io.package.mockResolvedValue({ ...originalPackage, roles: [
    { name: "old_application", login: true, inherit: true, members: [] },
    { name: "candidate_api", login: true, inherit: true, members: [] },
    { name: "candidate_worker", login: true, inherit: true, members: [] },
  ] });
  const original = io.sqlPrivilegeEffect.getMockImplementation()!;
  io.sqlPrivilegeEffect.mockImplementationOnce(async command => {
    expect(io.ordinaryFenced).toBe(true);
    expect(io.apply).not.toHaveBeenCalled();
    expect(command.runtimeRoles).toEqual([{ oid: "20001", name: "candidate_api" }, { oid: "20002", name: "candidate_worker" }]);
    expect(command.client).toBe(io.clients[0]);
    return original(command);
  });
  const result = await retireLegacyApplicationLogins(f.input);
  expect(io.ordinaryFenced).toBe(true);
  expect(io.sqlPrivilegeEffect).toHaveBeenCalledOnce();
  expect(io.runtimeRoles).toHaveBeenCalled();
  expect(result.status).toBe("legacy-logins-fenced-not-p13");
});

it("persists the root intent before SQL and the actual inspection step after SQL, without declaring P13", async () => {
  const f = await fixture();
  io.apply.mockImplementationOnce(async () => {
    expect(retirementEvents(f.input).map(entry => entry.action)).toEqual(["bootstrap-retirement-pending"]);
    return { outcome: "authentication-fenced-not-P13", intentDigest: `sha256:${"b".repeat(64)}` };
  });
  await expect(retireLegacyApplicationLogins(f.input)).resolves.toMatchObject({ status: "bootstrap-authentication-fenced-not-p13" });
  expect(retirementEvents(f.input).map(entry => entry.action)).toEqual(["bootstrap-retirement-pending", "bootstrap-retirement-credential-step"]);
  expect(JSON.stringify(retirementEvents(f.input))).not.toContain("old-secret");
});

it("dispatches the legacy SQL privilege effect only after actual credential inspection and its durable root step", async () => {
  const f = await fixture();
  const original = io.sqlPrivilegeEffect.getMockImplementation()!;
  io.sqlPrivilegeEffect.mockImplementationOnce(async command => {
    expect(io.apply).toHaveBeenCalledOnce(); expect(io.inspect).toHaveBeenCalledOnce();
    expect(retirementEvents(f.input).at(-1)?.action).toBe("bootstrap-retirement-credential-step");
    return original(command);
  });
  await expect(retireLegacyApplicationLogins(f.input)).resolves.toMatchObject({ status: "bootstrap-authentication-fenced-not-p13" });
  expect(io.sqlPrivilegeEffect).toHaveBeenCalledOnce();
});

it("does not reach REVOKE when the SQL host intent fsync fails after credential retirement", async () => {
  const f = await fixture(); let revokes = 0;
  io.sqlPrivilegeEffect.mockImplementationOnce(async command => {
    io.fault = "host-fsync";
    await command.persistHostIntent({ intentDigest: `sha256:${"c".repeat(64)}` });
    revokes++;
  });
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("TRANSACTION-OUTCOME-UNKNOWN");
  expect(revokes).toBe(0); expect(io.apply).toHaveBeenCalledOnce();
  expect(retirementEvents(f.input).at(-1)?.action).toBe("bootstrap-retirement-credential-step");
});

it("retains the SQL pending record after a real-root effect error and refuses credential or SQL replay", async () => {
  const f = await fixture(); let revokes = 0;
  io.sqlPrivilegeEffect.mockImplementationOnce(async command => {
    await command.persistHostIntent({ intentDigest: `sha256:${"c".repeat(64)}` });
    revokes++; throw new Error("private-commit-acknowledgment-lost");
  });
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("TRANSACTION-OUTCOME-UNKNOWN");
  const loaded = loadUpgradeJournal({ journalPath: f.input.handoff.inputs.journalPath, runId: "hostrun" });
  if (!loaded.ok) throw new Error("fixture-journal-unavailable");
  expect(loaded.value.record.entries.filter(entry => entry.action.startsWith("legacy-sql-privileges-")).map(entry => entry.action))
    .toEqual(["legacy-sql-privileges-pending"]);
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("ATTEMPT-REQUIRES-RECONCILE");
  expect(revokes).toBe(1); expect(io.apply).toHaveBeenCalledOnce(); expect(io.sqlPrivilegeEffect).toHaveBeenCalledOnce();
});

it("binds the runtime-role source to the actual root target before rotating credentials", async () => {
  const f = await fixture(), observed = await io.runtimeRoles();
  io.runtimeRoles.mockResolvedValue({ ...observed, target: { ...observed.target, databaseOid: "other" } });
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("RUNTIME-ROLE-SOURCE-MISMATCH");
  expect(io.apply).not.toHaveBeenCalled(); expect(io.sqlPrivilegeEffect).not.toHaveBeenCalled();
});

it("does not dispatch any SQL intent or credential effect when host pending fsync fails", async () => {
  const f = await fixture(); io.fault = "host-fsync";
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("PCAT-UPG-LEGACY-LOGIN-");
  expect(io.rootEvents).toEqual([]); expect(io.apply).not.toHaveBeenCalled();
});

it.each(["pending", "credential-step"])("does not persist %s after host-lock loss during the final report await", async stage => {
  const f = await fixture(), permitted = await io.report();
  let lost = false;
  io.report.mockImplementation(async () => {
    await Promise.resolve();
    const lastSql = io.clients.find(client => client.kind === "bootstrap")?.query.mock.calls.at(-1)?.[0];
    // Guard verification reads the report inside its RR transaction. The
    // append's last report read occurs after that transaction rolls back.
    if (!lost && lastSql === "rollback" && (stage === "pending" ? io.rootEvents.length === 0 : io.inspect.mock.calls.length === 1)) {
      lost = true; io.fault = "host-lock";
    }
    return permitted;
  });
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("PCAT-UPG-LEGACY-LOGIN-");
  expect(lost).toBe(true);
  expect(retirementEvents(f.input).map(entry => entry.action)).toEqual(stage === "pending" ? [] : ["bootstrap-retirement-pending"]);
  if (stage === "pending") { expect(io.rootEvents).toEqual([]); expect(io.apply).not.toHaveBeenCalled(); }
  else expect(io.apply).toHaveBeenCalledOnce();
});

it("does not report success if the post-commit report await loses the host lock", async () => {
  const f = await fixture(), permitted = await io.report();
  let lost = false;
  io.report.mockImplementation(async () => {
    await Promise.resolve();
    if (retirementEvents(f.input).at(-1)?.action === "bootstrap-retirement-credential-step") {
      lost = true; io.fault = "host-lock";
    }
    return permitted;
  });
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("TRANSACTION-OUTCOME-UNKNOWN");
  expect(lost).toBe(true);
  // This acknowledgment was durable before lock loss. Keep it intact for
  // actual inspection; do not overwrite it or retry the credential mutation.
  expect(retirementEvents(f.input).map(entry => entry.action)).toEqual(["bootstrap-retirement-pending", "bootstrap-retirement-credential-step"]);
  expect(io.apply).toHaveBeenCalledOnce();
});

it.each(["host-fsync", "host-lock"])("retains pending and refuses a blind retry after SQL when %s is lost", async fault => {
  const f = await fixture();
  io.inspect.mockImplementationOnce(async () => { io.fault = fault; return { outcome: "authentication-fenced-not-P13", intentDigest: `sha256:${"b".repeat(64)}` }; });
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("TRANSACTION-OUTCOME-UNKNOWN");
  expect(retirementEvents(f.input).map(entry => entry.action)).toEqual(["bootstrap-retirement-pending"]);
  io.fault = "";
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("PCAT-UPG-LEGACY-LOGIN-");
  expect(io.apply).toHaveBeenCalledOnce();
});

it("treats a renamed credential-step as unsettled when the directory fsync acknowledgment is lost", async () => {
  const f = await fixture();
  io.fsyncDirectoryInode = (await stat(f.input.handoff.inputs.lockRoot)).ino;
  io.inspect.mockImplementationOnce(async () => { io.fault = "host-directory-fsync";
    return { outcome: "authentication-fenced-not-P13", intentDigest: `sha256:${"b".repeat(64)}` }; });
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("TRANSACTION-OUTCOME-UNKNOWN");
  expect(retirementEvents(f.input).map(entry => entry.action)).toEqual(["bootstrap-retirement-pending", "bootstrap-retirement-credential-step"]);
  expect(loadUpgradeJournal({ journalPath: f.input.handoff.inputs.journalPath, runId: "hostrun", requireSettled: true }).ok).toBe(false);
  io.fault = "";
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("JOURNAL-UNAVAILABLE");
  expect(io.apply).toHaveBeenCalledOnce();
});

it("retains the exact host intent as unknown after an uncertain SQL effect, without retrying it", async () => {
  const f = await fixture();
  io.apply.mockRejectedValueOnce(new Error("private-SQL-COMMIT-acknowledgment"));
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("TRANSACTION-OUTCOME-UNKNOWN");
  const events = retirementEvents(f.input);
  expect(events.map(entry => entry.action)).toEqual(["bootstrap-retirement-pending", "bootstrap-retirement-unknown"]);
  expect(events[1].bootstrapRetirement?.intent).toEqual(events[0].bootstrapRetirement?.intent);
  expect(events[0].bootstrapRetirement?.intent.rootRequestDigest).toBe((io.rootEvents[0].payload as { requestDigest: string }).requestDigest);
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("ATTEMPT-REQUIRES-RECONCILE");
  expect(io.apply).toHaveBeenCalledOnce();
});

it.each(["different-inspection", "missing-inspection", "changed-root", "duplicate-root"])("does not turn %s into a credential-step", async fault => {
  const f = await fixture();
  io.inspect.mockImplementationOnce(async () => {
    if (fault === "changed-root") io.rootEvents[0] = { payload: { private: "changed" } };
    if (fault === "duplicate-root") io.rootEvents.push(io.rootEvents[0]);
    return fault === "missing-inspection" ? { outcome: "unknown" } :
      { outcome: "authentication-fenced-not-P13", intentDigest: `sha256:${(fault === "different-inspection" ? "c" : "b").repeat(64)}` };
  });
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("TRANSACTION-OUTCOME-UNKNOWN");
  expect(retirementEvents(f.input).map(entry => entry.action)).toEqual(["bootstrap-retirement-pending", "bootstrap-retirement-unknown"]);
});

it("does not adopt an unrelated full-record journal append between SQL and host acknowledgment", async () => {
  const f = await fixture();
  io.inspect.mockImplementationOnce(async () => {
    const opened = loadUpgradeJournal({ journalPath: f.input.handoff.inputs.journalPath, runId: "hostrun" });
    if (!opened.ok) throw new Error("fixture-journal-unavailable");
    expect(commitJournalTransition(opened.value, { action: "unrelated-observation", inputDigest: "unrelated",
      toState: opened.value.record.state, nextAction: opened.value.record.nextAction }).ok).toBe(true);
    return { outcome: "authentication-fenced-not-P13", intentDigest: `sha256:${"b".repeat(64)}` };
  });
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("TRANSACTION-OUTCOME-UNKNOWN");
  expect(retirementEvents(f.input).map(entry => entry.action)).toEqual(["bootstrap-retirement-pending"]);
});

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

it("stops the next SQL effect if the last report await loses the issued host lock", async () => {
  const f = await fixture(), permitted = await io.report();
  let continued = false;
  io.apply.mockImplementationOnce(async command => {
    io.report.mockImplementationOnce(async () => { await Promise.resolve(); io.fault = "host-lock"; return permitted; });
    await command.beforeEffect();
    continued = true;
    return { outcome: "authentication-fenced-not-P13", intentDigest: `sha256:${"b".repeat(64)}` };
  });
  await expect(retireLegacyApplicationLogins(f.input)).rejects.toThrow("TRANSACTION-OUTCOME-UNKNOWN");
  expect(continued).toBe(false);
  expect(retirementEvents(f.input).map(entry => entry.action)).toEqual(["bootstrap-retirement-pending"]);
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
  expect(selected.sqlSuccessor).toEqual({ journalPath: f.input.handoff.inputs.journalPath,
    hostRunId: f.input.handoff.inputs.runId, lock: f.input.lock });
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
