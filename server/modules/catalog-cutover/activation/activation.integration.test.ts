import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCheckedEmptyDatabase, type ParameterCatalogDatabase } from "../../../testing/upgradeComponents";
import { createPostgresDatabase, type RootDatabase } from "../../../shared/database/client";
import { applyMigrations } from "../../../shared/database/migrations";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { classifyFrozenP0Graph, type FrozenP0Graph } from "../classifier";
import { appendMappingVersion, readCurrentMappingHead } from "../mapping";
import { createLocalArchiveObjectStore } from "../archive";
import { executeCutover, planCutover } from "../orchestrator";
import { createApplicationReadActivation, createActivationIntent, type ActivationOptions, type ActivationIdentity } from "./index";
import { physicalIdentity, readFacts, persistActivation } from "./postgres";
import { decodeBinding } from "./records";
import { digestOf } from "../../release-verification/core/digest";
import { assertHostOperationLock, withHostOperationLock, type HostOperationLock } from "../../../../ops/self-hosted/scripts/parameter-catalog-upgrade/handoff";

/** Storage component evidence only. Actual S7 P0–P10 is executed over two
 * archived legacy definitions; its older no-Binding P2 path is not a production
 * quiescence proof. No passing verification report or approval is fabricated.
 * The private SQL transaction test below cannot authorize the public apply API,
 * candidate startup, queue delivery or traffic. */
describe("existing 0137 activation storage on independently owned PG16", () => {
  let database: ParameterCatalogDatabase;
  let admin: pg.Pool;
  let management: pg.Pool;
  let reports: RootDatabase;
  let root: string;
  let runId: string;
  let planDigest: string;
  let target: ActivationIdentity;
  let held: HostOperationLock | undefined;
  let source: pg.PoolClient | undefined;
  let module: ReturnType<typeof createApplicationReadActivation>;
  const role = `activation_${randomUUID().replaceAll("-", "")}`;
  const reportRole = `${role}_reports`;
  const graph: FrozenP0Graph = {
    catalog: "parameter-catalog-p0-graph",
    identities: ["status", "unknown"].map(name => ({ id: `identity-${name}`, sourceSystem: "synthetic-activation",
      sourceKind: "parameter-spec", ownerScopeKind: "platform", ownerScopeId: "platform", sourceId: `spec-${name}` })),
    specs: ["status", "unknown"].map(name => ({ id: `spec-${name}`, organizationId: null, sourceKind: "dts",
      specificationKey: `synthetic.${name}`, attributionSubjectId: null, definitionLifecycle: "active",
      propertyKey: name === "status" ? "status" : "synthetic,unknown" })),
    specVersions: ["status", "unknown"].map(name => ({ id: `version-${name}`, parameterSpecId: `spec-${name}`,
      version: 1, lifecycle: "active", versionStatus: "active" })),
    subjects: [], driverRegistrations: [], nodeTypeDefinitions: [], driverSchemas: [], driverSchemaVersions: [],
    dtsPropertySpecs: [], modules: [], placements: [], bindings: [], bindingRevisions: [],
  };
  const counts = async () => (await admin.query(`select
    (select count(*)::int from parameter_catalog.parameter_catalog_cutover_events) as events,
    (select count(*)::int from parameter_catalog.parameter_catalog_cutover_checkpoints) as checkpoints`)).rows[0];
  const appendArchiveEvidence = async (include: boolean) => {
    // Deliberate isolated source drift. This is a new checksum of real source
    // bytes, not an approval of the old P0 plan or comparison report.
    await admin.query("update public.parameter_spec_versions set description=$1 where id='version-status'", [include ? "Synthetic revised" : "Synthetic"]);
    const sourceChecksum = digestOf((await admin.query(`select to_jsonb(s) as definition,to_jsonb(v) as revision
      from public.parameter_specs s join public.parameter_spec_versions v on v.parameter_spec_id=s.id where s.id='spec-status' order by v.id`)).rows);
    const client = await management.connect();
    try {
      await client.query("set role catalog_migration_owner");
      const classification = classifyFrozenP0Graph(graph);
      const current = await readCurrentMappingHead({ client, identityId: "identity-status" });
      if (!classification.ok || !current.ok || !current.value?.version.archiveId) throw new Error("missing-real-archive-mapping");
      const appended = await appendMappingVersion({ client, cutoverRunId: runId, classification: classification.value,
        identityId: "identity-status", sourceChecksum,
        expectedHead: { casVersion: current.value.casVersion, versionId: current.value.currentVersionId },
        outcome: { kind: "archived", archiveId: current.value.version.archiveId } });
      expect(appended.ok && appended.value.status).toBe("appended");
    } finally { client.release(true); }
  };
  const boundary: ActivationOptions["boundary"] = {
    async withLockedBoundary(body) {
      return withHostOperationLock(root, async lock => {
        held = lock;
        source = await admin.connect();
        try {
          await source.query("begin");
          await source.query("lock table public.parameter_specs,public.parameter_spec_versions in share mode");
          return await body();
        } finally {
          try { await source.query("rollback"); } finally { source.release(true); source = undefined; held = undefined; }
        }
      });
    },
    async verify() {
      if (!held || !source) throw new Error("activation-test-boundary-released");
      await assertHostOperationLock(held, root);
      const checked = await source.query(`select count(*)::int as n from pg_locks where pid=pg_backend_pid()
        and granted and mode='ShareLock' and relation=any(array['public.parameter_specs'::regclass,'public.parameter_spec_versions'::regclass])`);
      if (checked.rows[0]?.n !== 2) throw new Error("activation-test-source-lock-lost");
    },
    async observe() { throw new Error("complete-release-target-producer-not-installed-in-storage-test"); },
  };
  beforeAll(async () => {
    database = await createCheckedEmptyDatabase("activationexisting");
    root = await mkdtemp(path.join(await realpath(os.tmpdir()), "activation-existing-"));
    const old = path.join(root, "old-migrations"); await mkdir(old);
    const sourceSha = "82344044b436a8dafecefbb85dfd724cecb05e3f";
    const names = execFileSync("git", ["ls-tree", "--name-only", `${sourceSha}:server/migrations`], { encoding: "utf8" })
      .trim().split("\n").filter(name => name.endsWith(".sql"));
    for (const name of names) await writeFile(path.join(old, name), execFileSync("git", ["show", `${sourceSha}:server/migrations/${name}`]));
    const migrate = createPostgresDatabase(database.url);
    try {
      await applyMigrations(migrate, old);
      for (const spec of graph.specs) await migrate.query(`insert into public.parameter_specs
        (id,source_kind,specification_key,definition_lifecycle,property_key) values($1,'dts',$2,'active',$3)`, [spec.id, spec.specificationKey, spec.propertyKey]);
      for (const version of graph.specVersions) await migrate.query(`insert into public.parameter_spec_versions
        (id,parameter_spec_id,version,display_name,description,value_shape,lifecycle,version_status)
        values($1,$2,1,'Synthetic','Synthetic','{}','active','active')`, [version.id, version.parameterSpecId]);
      await applyMigrations(migrate, path.resolve("server/migrations"));
    } finally { await migrate.close(); }
    admin = new pg.Pool({ connectionString: database.url, max: 4 });
    for (const identity of graph.identities) await admin.query(`insert into parameter_catalog.legacy_identities
      (id,source_system,source_kind,owner_scope_kind,owner_scope_id,source_id) values($1,$2,$3,$4,$5,$6)`,
    [identity.id, identity.sourceSystem, identity.sourceKind, identity.ownerScopeKind, identity.ownerScopeId, identity.sourceId]);
    const full = validCatalogReleaseBundle();
    const bundle = { ...full, targetReleaseId: full.releases[0].manifest.release.id, releases: [full.releases[0]] };
    const catalogReleaseSource = jsonCatalogReleaseSource(bundle);
    const planned = await planCutover({ graph, targetArtifactSha: "e".repeat(40), targetCatalogReleaseDigest: bundle.releases[0].manifest.release.digest, catalogReleaseSource });
    if (!planned.ok) throw new Error(planned.error.code);
    const executed = await executeCutover({ pool: admin, graph, plan: planned.value, catalogReleaseSource,
      archiveObjectStore: createLocalArchiveObjectStore(path.join(root, "archive")), archiveEncryptionKey: randomBytes(32), operatorAuditRef: "synthetic-storage-only" });
    if (!executed.ok) throw new Error(executed.error.code);
    expect(executed.value.checkpoints.map(row => row.phase)).toEqual(["P0", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"]);
    runId = executed.value.runId; planDigest = planned.value.planDigest;
    const identity = await admin.connect();
    try { target = await physicalIdentity(identity); } finally { identity.release(); }
    const password = randomUUID();
    await admin.query(`create role ${pg.escapeIdentifier(role)} login noinherit nosuperuser nobypassrls nocreatedb nocreaterole password ${pg.escapeLiteral(password)}`);
    await admin.query(`grant catalog_migration_owner to ${pg.escapeIdentifier(role)} with inherit false, set true, admin false`);
    const url = new URL(database.url); url.username = role; url.password = password;
    management = new pg.Pool({ connectionString: url.toString(), max: 1 });
    await admin.query(`create role ${pg.escapeIdentifier(reportRole)} login inherit nosuperuser nobypassrls nocreatedb nocreaterole password ${pg.escapeLiteral(password)}`);
    await admin.query(`grant catalog_verifier_role to ${pg.escapeIdentifier(reportRole)} with inherit true, set false, admin false`);
    url.username = reportRole; reports = createPostgresDatabase(url.toString());
    module = createApplicationReadActivation({ managementPool: management, reports, target, boundary,
      journal: { async pending() { throw new Error("storage-tests-never-issue-release-intent"); }, async committed() { throw new Error("unexpected-release"); }, async unknown() {} } });
  });
  afterAll(async () => {
    await management?.end(); await reports?.close();
    if (admin) {
      await admin.query(`drop role if exists ${pg.escapeIdentifier(reportRole)}`);
      await admin.query(`drop role if exists ${pg.escapeIdentifier(role)}`);
      await admin.end();
    }
    await database?.close(); if (root) await rm(root, { recursive: true, force: true });
  });
  it("inspects real P0–P10 and does not mint an epoch or switch reads", async () => {
    const before = await counts();
    const facts = await module.inspectFacts(runId, planDigest);
    expect(facts.mappingEpoch).toBeNull(); expect(facts.currentBinding).toBeNull();
    expect(facts.run.current_phase).toBe("P10"); expect(await counts()).toEqual(before);
  });
  it("explicitly prepares a stable epoch over the actual mapping inventory without writing a P11 checkpoint", async () => {
    const before = await counts();
    const first = await module.prepareMappingEpoch(runId, planDigest);
    expect(first.mappingEpoch).toMatch(/^sha256:[a-f0-9]{64}$/);
    const second = await module.prepareMappingEpoch(runId, planDigest);
    expect(second.mappingEpoch).toBe(first.mappingEpoch);
    expect(await counts()).toEqual({ events: before.events + 1, checkpoints: before.checkpoints });
    expect((await module.inspectFacts(runId, planDigest)).mappingEpoch).toBe(first.mappingEpoch);
  });
  it("resolves a lost COMMIT acknowledgment by inspection without duplicating the mapping preparation event", async () => {
    await appendArchiveEvidence(true);
    const faultPool = new pg.Pool({ ...management.options, max: 1 });
    let commitSent = false;
    faultPool.on("connect", client => {
      const query = client.query.bind(client) as (sql: string, values?: unknown[]) => Promise<pg.QueryResult>;
      client.query = (async (sql: string, values?: unknown[]) => {
        const result = await query(sql, values);
        if (sql === "commit") { commitSent = true; throw new Error("simulated-private-transport-ack-lost"); }
        return result;
      }) as typeof client.query;
    });
    const before = await counts();
    const previous = await module.inspectFacts(runId, planDigest);
    const fail = async () => { throw new Error("unexpected-release-journal"); };
    try {
      const uncertain = createApplicationReadActivation({ managementPool: faultPool, reports, target, boundary,
        journal: { pending: fail, committed: fail, unknown: fail } });
      await expect(uncertain.prepareMappingEpoch(runId, planDigest)).rejects.toThrow("OUTCOME-UNKNOWN");
      expect(commitSent).toBe(true);
    } finally { await faultPool.end(); }
    const inspected = await module.inspectFacts(runId, planDigest);
    expect(previous.mappingEpoch).toBeNull();
    expect(inspected.mappingEpoch).toMatch(/^sha256:[a-f0-9]{64}$/);
    await module.prepareMappingEpoch(runId, planDigest);
    expect(await counts()).toEqual({ events: before.events + 1, checkpoints: before.checkpoints });
  });
  it("invalidates an old epoch after an actual owner mapping append and requires explicit new preparation", async () => {
    const previous = await module.inspectFacts(runId, planDigest);
    await appendArchiveEvidence(false);
    const before = await counts();
    const drifted = await module.inspectFacts(runId, planDigest);
    expect(drifted.mappingEpoch).toBeNull(); expect(drifted.headDigest).not.toBe(previous.headDigest);
    expect(await counts()).toEqual(before);
    const prepared = await module.prepareMappingEpoch(runId, planDigest);
    expect(prepared.mappingEpoch).not.toBe(previous.mappingEpoch);
    expect(await counts()).toEqual({ events: before.events + 1, checkpoints: before.checkpoints });
  });
  it("rejects wrong database identity and an unavailable source boundary before any storage mutation", async () => {
    const before = await counts();
    const noEffect = async () => { throw new Error("unexpected-journal-effect"); };
    const options: ActivationOptions = { managementPool: management, reports, target: { ...target, databaseOid: "1" }, boundary,
      journal: { pending: noEffect, committed: noEffect, unknown: noEffect } };
    await expect(createApplicationReadActivation(options).prepareMappingEpoch(runId, planDigest)).rejects.toThrow("TARGET-MISMATCH");
    await expect(createApplicationReadActivation({ ...options, target, boundary: { ...boundary, verify: async () => { throw new Error("secret"); } } })
      .prepareMappingEpoch(runId, planDigest)).rejects.toThrow("PCAT-ACTIVATION-");
    expect(await counts()).toEqual(before);
  });
  it("contends with the actual S7 lock and never advances a competing controller", async () => {
    const lock = await admin.connect();
    try {
      await lock.query("select pg_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
      const before = await counts();
      await expect(module.prepareMappingEpoch(runId, planDigest)).rejects.toThrow("LOCK-UNAVAILABLE");
      expect(await counts()).toEqual(before);
    } finally { lock.release(true); }
  });
  it("requires a real current target producer before reading approval or applying a P12 effect", async () => {
    const before = await counts();
    const intent = createActivationIntent({ runId, attemptId: "no-producer", target, planDigest,
      predecessorBindingDigest: null, reportDigest: digestOf("missing-report"), expectedObservationDigest: digestOf("no-observation") });
    await expect(module.apply(intent)).rejects.toThrow("BOUNDARY-UNAVAILABLE");
    expect(await counts()).toEqual(before);
  });
  it("queries the formal report projection with its actual reader login and refuses a missing report without journal or SQL effects", async () => {
    const before = await counts();
    let journalCalls = 0;
    const noEffect = async () => { journalCalls++; throw new Error("unexpected-journal"); };
    const selected = createApplicationReadActivation({ managementPool: management, reports, target,
      // Deliberately incomplete negative input: never represents a successful
      // live producer or a legitimate release plan.
      boundary: { ...boundary, observe: async () => ({}) as never },
      journal: { pending: noEffect, committed: noEffect, unknown: noEffect } });
    const intent = createActivationIntent({ runId, attemptId: "missing-report", target, planDigest,
      predecessorBindingDigest: null, reportDigest: digestOf("missing-report"), expectedObservationDigest: digestOf("negative-only") });
    await expect(selected.apply(intent)).rejects.toThrow("REPORT-MISSING");
    expect(journalCalls).toBe(0); expect(await counts()).toEqual(before);
  });
  it("SQL component atomically persists one explicit P12 binding and readback without claiming report approval", async () => {
    const lease = await management.connect();
    let binding: ReturnType<typeof decodeBinding>;
    try {
      await lease.query("select pg_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
      await lease.query("begin"); await lease.query("set local role catalog_migration_owner");
      const facts = await readFacts(lease, target, runId, planDigest);
      const intent = createActivationIntent({ runId, attemptId: "storage-only-not-release", target, planDigest,
        predecessorBindingDigest: null, reportDigest: digestOf("unapproved-storage-reference"), expectedObservationDigest: digestOf("no-release-observation") });
      const body = { version: "pcat-activation-v1" as const, intent, mode: "canonical" as const,
        sourceSnapshotFingerprint: facts.run.source_snapshot_fingerprint, catalog: facts.catalog,
        mapping: { epoch: facts.mappingEpoch!, headDigest: facts.headDigest }, comparisonReportDigest: digestOf("unapproved-storage-comparison") };
      binding = decodeBinding({ ...body, bindingDigest: digestOf(body) });
      await persistActivation(lease, facts, binding);
      await lease.query("rollback");
      // A partial SQL transaction is not a committed read switch.
      await lease.query("begin"); await lease.query("set local role catalog_migration_owner");
      expect((await readFacts(lease, target, runId, planDigest)).currentBinding).toBeNull();
      await persistActivation(lease, facts, binding); await lease.query("commit");
    } finally { await lease.query("rollback"); lease.release(true); }
    const inspected = await module.inspect(binding.intent);
    expect(inspected).toEqual({ kind: "applied", binding, currentHeadDigest: binding.bindingDigest });
    const before = await counts();
    const { inputDigest: _inputDigest, ...originalIntent } = binding.intent;
    await expect(module.inspect(createActivationIntent({ ...originalIntent, attemptId: "different-attempt" })))
      .rejects.toThrow("ACTIVATION-CONFLICT");
    expect(await counts()).toEqual(before);
  });
  it("never treats a missing mapping head as a zero inventory or silently renews the epoch", async () => {
    await admin.query(`insert into public.parameter_specs(id,source_kind,specification_key,definition_lifecycle,property_key)
      values('unclassified-new-source','dts','synthetic.new','active','synthetic,new')`);
    await admin.query(`insert into parameter_catalog.legacy_identities
      (id,source_system,source_kind,owner_scope_kind,owner_scope_id,source_id)
      values('missing-head','synthetic-activation','parameter-spec','platform','platform','unclassified-new-source')`);
    const before = await counts();
    await expect(module.inspectFacts(runId, planDigest)).rejects.toThrow("MAPPING-INCOMPLETE");
    await expect(module.prepareMappingEpoch(runId, planDigest)).rejects.toThrow("MAPPING-INCOMPLETE");
    expect(await counts()).toEqual(before);
  });
});
