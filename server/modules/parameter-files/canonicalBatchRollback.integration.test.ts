import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { createLocalObjectStore } from "../logs/objectStore";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import { installConfigurationSourceFixture, captureConfigurationSourceState } from "../../testing/parameterCatalog/configurationSource";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { loadLegacyBindingIdentity } from "../parameter-bindings/binding/migrationAdapter";
import { loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";
import { submitCanonicalBatchValueChange, approveCanonicalBatchValueChange } from "../parameter-bindings/drafts/batchChangeService";
import { createConfigSet, addConfigSetFile } from "./configSetService";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { uploadProjectParameterFile } from "./service";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../parameter-topology/types";
import { createCandidate } from "./candidateService";
import { getCanonicalSourceWorkflow, prepareCanonicalBatchRollbackCandidate,
  previewCanonicalCandidate, submitCanonicalBatchRollback } from "./canonicalFileWorkflow";
import { registerParameterFileRoutes } from "./routes";

const ORG = "org-906-batch-rollback";
const PROJECT = "project-906-batch-rollback";
const ADMIN = "user-906-batch-rollback-admin";
const REVIEWER = "user-906-batch-rollback-reviewer";
const DEF = "pdef_acme_power_iin_max";
const admin = makeTestAuthContext({ userId: ADMIN, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });
const reviewer = makeTestAuthContext({ userId: REVIEWER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: PROJECT }] });
const foreign = makeTestAuthContext({ userId: "foreign-admin", organizationId: "foreign-org",
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });

const jsonBefore = '{ "settings": { "limit": 36.5 }, "other": { "limit": 48 } }\n';
const jsonAfter = '{ "settings": { "limit": 50 }, "other": { "limit": 60 } }\n';
const dtsBefore = `/dts-v1/;\n/ {\n  charger: device@0 { compatible = "acme,power"; iin_max = <36>; };\n  backup: device@1 { compatible = "acme,power"; iin_max = <36>; };\n};\n`;
const dtsAfter = dtsBefore.replace("iin_max = <36>", "iin_max = <50>").replace("iin_max = <36>", "iin_max = <60>");
type Format = "json" | "dts";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

async function objects(directory: string) {
  const entries = (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile());
  return Promise.all(entries.map(async (entry) => ({
    key: relative(directory, join(entry.parentPath, entry.name)),
    bytes: (await readFile(join(entry.parentPath, entry.name))).toString("base64")
  }))).then((rows) => rows.sort((a, b) => a.key.localeCompare(b.key)));
}

async function fixture(format: Format) {
  const lane = await createEphemeralTestDatabase(`issue906-${format}-batch-rollback`);
  const db = createPostgresDatabase(lane.url);
  const directory = await mkdtemp(join(tmpdir(), `wiseeff-906-${format}-rollback-`));
  const storage = createLocalObjectStore(directory);
  cleanups.push(async () => { await db.close(); await lane.drop(); await rm(directory, { recursive: true, force: true }); });
  await db.query("insert into organizations(id,name) values ($1,'#906 batch rollback')", [ORG]);
  await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true)", [ADMIN, ORG, REVIEWER]);
  await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Batch rollback','BR906','initialized')", [PROJECT, ORG]);
  await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('rollback-admin',$1,$2,null,'admin'),('rollback-reviewer',$3,$2,$4,'software-committer')", [ADMIN, ORG, REVIEWER, PROJECT]);
  if (format === "json") {
    await installConfigurationSourceFixture(db, admin, { subjectId: "csub_906_batch_rollback", schemaId: "wiseeff.906.batch-rollback" });
  } else {
    await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power",
      businessName: "#906 DTS rollback", driverName: "Acme power", idempotencyKey: "906-dts-rollback-fixture", reason: "Issue 906 rollback" });
  }
  const set = await createConfigSet(db, admin, { projectId: PROJECT, name: "Rollback" });
  const fileName = format === "json" ? "settings.json" : "board.dts";
  const before = format === "json" ? jsonBefore : dtsBefore;
  const after = format === "json" ? jsonAfter : dtsAfter;
  const uploaded = await uploadProjectParameterFile(db, storage, admin, { projectId: PROJECT, fileName, bytes: Buffer.from(before) });
  await addConfigSetFile(db, admin, { configSetId: set.id, fileId: uploaded.file.id, role: "base", sortOrder: 0 });
  const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
  if (!catalog) throw new Error("Published Catalog fixture unavailable");
  if (format === "json") {
    await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, catalog, {
      projectId: PROJECT, configSetId: set.id, fileId: uploaded.file.id, fileVersionId: uploaded.version.id,
      configurationSchemaId: "wiseeff.906.batch-rollback", rootPointer: "",
      mappings: [{ definitionId: DEF, pointer: "/settings/limit" }],
      invocation: createUserInvocation(admin), requestId: "906-rollback-register-first", refusalSink: createTrustedRefusalAuditSink(db)
    }));
    await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, catalog, {
      projectId: PROJECT, configSetId: set.id, fileId: uploaded.file.id, fileVersionId: uploaded.version.id,
      configurationSchemaId: "wiseeff.906.batch-rollback", rootPointer: "/other",
      mappings: [{ definitionId: DEF, pointer: "/other/limit" }],
      invocation: createUserInvocation(admin), requestId: "906-rollback-register-second", refusalSink: createTrustedRefusalAuditSink(db)
    }));
  } else {
    const manifest: ConfigRevisionManifest = { organizationId: ORG, projectId: PROJECT, configSetId: set.id,
      entryFile: fileName, includeSearchPaths: ["."], overlayOrder: [],
      members: [{ fileId: uploaded.file.id, fileVersionId: uploaded.version.id, fileName,
        sourceName: fileName, role: "base", sortOrder: 0, content: before }] };
    const revision = await ingestConfigRevision(db, manifest, admin, { legacyProjection: "skip" });
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog, {
      organizationId: ORG, projectId: PROJECT, configSetId: set.id, configRevisionId: revision.id
    }));
  }
  const bindings = await listCatalogBindingRowsForProject(db, admin, { projectId: PROJECT });
  expect(bindings).toHaveLength(2);
  expect(await Promise.all(bindings.map((binding) => loadLegacyBindingIdentity(getRootPostgresPool(db)!, binding.id))))
    .toEqual([null, null]);
  const candidate = await createCandidate(db, storage, admin, {
    projectId: PROJECT, fileId: uploaded.file.id, fileName, bytes: Buffer.from(after)
  });
  const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: PROJECT, candidateId: candidate.id });
  expect(preview.bindings).toHaveLength(2);
  const submitted = await submitCanonicalBatchValueChange(db, storage, admin, {
    projectId: PROJECT, candidateId: candidate.id, expectedProofToken: preview.proofToken!,
    reason: "establish two-target history", assignedToUserId: REVIEWER,
    invocation: createUserInvocation(admin), requestId: `906-${format}-history-submit`, refusalSink: createTrustedRefusalAuditSink(db)
  });
  expect(submitted.status).toBe("pending");
  expect((await db.transaction((tx) => approveCanonicalBatchValueChange(tx, storage, reviewer, catalog, {
    projectId: PROJECT, requestId: submitted.id, batchProofDigest: submitted.batchProofDigest,
    invocation: createUserInvocation(reviewer), traceId: `906-${format}-history-review`, refusalSink: createTrustedRefusalAuditSink(db)
  }))).status).toBe("approved");
  const activeVersionId = (await db.query<{ current_version_id: string }>(
    "select current_version_id from project_parameter_files where id=$1", [uploaded.file.id])).rows[0]!.current_version_id;
  expect(activeVersionId).not.toBe(uploaded.version.id);
  const workflow = await getCanonicalSourceWorkflow(db, admin, { projectId: PROJECT, fileId: uploaded.file.id });
  if (!workflow.proofToken) throw new Error("Canonical rollback workflow proof missing");
  return { db, storage, directory, fileId: uploaded.file.id, fileName, baseVersionId: uploaded.version.id,
    activeVersionId, workflowProofToken: workflow.proofToken, before, after, candidateId: candidate.id };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function advanceSource(f: Fixture, format: Format) {
  const bytes = format === "json"
    ? Buffer.from(jsonAfter.replace("limit\": 50", "limit\": 70").replace("limit\": 60", "limit\": 80"))
    : Buffer.from(dtsAfter.replace("iin_max = <50>", "iin_max = <70>").replace("iin_max = <60>", "iin_max = <80>"));
  const candidate = await createCandidate(f.db, f.storage, admin, {
    projectId: PROJECT, fileId: f.fileId, fileName: f.fileName, bytes
  });
  const preview = await previewCanonicalCandidate(f.db, f.storage, admin, {
    projectId: PROJECT, candidateId: candidate.id
  });
  expect(preview.bindings).toHaveLength(2);
  const submitted = await submitCanonicalBatchValueChange(f.db, f.storage, admin, {
    projectId: PROJECT, candidateId: candidate.id, expectedProofToken: preview.proofToken!,
    reason: "advance source after rollback preparation", assignedToUserId: REVIEWER,
    invocation: createUserInvocation(admin), requestId: `906-${format}-advance-source`,
    refusalSink: createTrustedRefusalAuditSink(f.db)
  });
  const catalog = await loadPublishedCatalog(getRootPostgresPool(f.db)!);
  if (!catalog) throw new Error("Published Catalog fixture unavailable");
  expect((await f.db.transaction((tx) => approveCanonicalBatchValueChange(tx, f.storage, reviewer, catalog, {
    projectId: PROJECT, requestId: submitted.id, batchProofDigest: submitted.batchProofDigest,
    invocation: createUserInvocation(reviewer), traceId: `906-${format}-advance-review`,
    refusalSink: createTrustedRefusalAuditSink(f.db)
  }))).status).toBe("approved");
}

describe("#906 exact historical double-Binding rollback", () => {
  it.each(["json", "dts"] as const)("rechecks current %s /source-rollback over real HTTP", async (format) => {
    const f = await fixture(format);
    const router = createRouter();
    registerParameterFileRoutes(router, { db: f.db, objectStore: f.storage, getCurrentAuthContext: () => admin });
    const before = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const stored = await objects(f.directory);
    const response = await requestJson<{ error: { code: string; details?: { reason?: string } } }>(
      createHttpServer(router), `/api/v1/projects/${PROJECT}/parameter-files/${f.fileId}/source-rollback`,
      { method: "POST", body: JSON.stringify({ versionId: f.baseVersionId,
        expectedCurrentVersionId: f.activeVersionId, expectedProofToken: f.workflowProofToken,
        reason: "restore exact historical cohort" }) }
    );
    expect(response).toMatchObject({ status: 409,
      body: { error: { code: "CONFLICT", details: { reason: "canonical-batch-writer-unavailable" } } } });
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect(await objects(f.directory)).toEqual(stored);
  }, 120_000);

  it.each(["json", "dts"] as const)("prepares and submits one reviewed %s historical cohort atomically", async (format) => {
    const f = await fixture(format);
    const input = { projectId: PROJECT, fileId: f.fileId, versionId: f.baseVersionId,
      expectedCurrentVersionId: f.activeVersionId, expectedWorkflowProofToken: f.workflowProofToken,
      requestId: `906-${format}-rollback-prepare` };
    const before = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const prepared = await prepareCanonicalBatchRollbackCandidate(f.db, f.storage, admin, input);
    expect(prepared).toMatchObject({ kind: "canonical-source-batch", format, historicalVersionId: f.baseVersionId,
      expectedCurrentVersionId: f.activeVersionId, expectedWorkflowProofToken: f.workflowProofToken,
      replayed: false });
    expect(prepared.targets).toHaveLength(2);
    expect(prepared.cohort).toHaveLength(2);
    expect(prepared.targets.map((target) => target.bindingId)).toEqual(
      [...prepared.targets.map((target) => target.bindingId)].sort());
    const afterPrepare = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    expect(afterPrepare.values).toEqual(before.values);
    expect(afterPrepare.pins).toEqual(before.pins);
    expect(afterPrepare.history).toEqual(before.history);
    expect(afterPrepare.versions).toEqual(before.versions);
    expect(afterPrepare.requests).toEqual(before.requests);
    const preparedObjects = await objects(f.directory);
    expect(await prepareCanonicalBatchRollbackCandidate(f.db, f.storage, admin, input))
      .toMatchObject({ candidateId: prepared.candidateId, replayed: true, batchProofDigest: prepared.batchProofDigest });
    expect(await objects(f.directory)).toEqual(preparedObjects);
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(afterPrepare);
    const submit = { projectId: PROJECT, fileId: f.fileId, versionId: f.baseVersionId,
      candidateId: prepared.candidateId, expectedCurrentVersionId: f.activeVersionId,
      expectedWorkflowProofToken: f.workflowProofToken, expectedCandidateProofToken: prepared.proofToken,
      expectedBatchProofDigest: prepared.batchProofDigest, reason: "restore exact historical cohort",
      assignedToUserId: REVIEWER, requestId: `906-${format}-rollback-submit`,
      refusalSink: createTrustedRefusalAuditSink(f.db) };
    await expect(submitCanonicalBatchRollback(f.db, f.storage, admin, {
      ...submit, expectedBatchProofDigest: "stale-proof"
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(afterPrepare);
    await f.db.query(`create function public.reject_rollback_receipt() returns trigger language plpgsql as $$
      begin if new.metadata ? 'canonicalRollbackVersionId' then raise exception 'late rollback receipt failure'; end if;
      return new; end $$`);
    await f.db.query("create trigger reject_rollback_receipt before insert on audit_events for each row execute function public.reject_rollback_receipt()");
    await expect(submitCanonicalBatchRollback(f.db, f.storage, admin, submit))
      .rejects.toThrow("late rollback receipt failure");
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(afterPrepare);
    expect(await objects(f.directory)).toEqual(preparedObjects);
    await f.db.query("drop trigger reject_rollback_receipt on audit_events");
    await f.db.query("drop function public.reject_rollback_receipt()");
    const submitted = await submitCanonicalBatchRollback(f.db, f.storage, admin, submit);
    expect(submitted).toMatchObject({ status: "pending", replayed: false, candidateId: prepared.candidateId,
      batchProofDigest: prepared.batchProofDigest });
    const pending = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    expect(pending.values).toEqual(before.values);
    expect(pending.pins).toEqual(before.pins);
    expect(pending.history).toEqual(before.history);
    expect(pending.versions).toEqual(before.versions);
    await expect(submitCanonicalBatchRollback(f.db, f.storage, admin, {
      ...submit, reason: "different retry"
    })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "rollback-replay-mismatch" } });
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(pending);
    expect(await submitCanonicalBatchRollback(f.db, f.storage, admin, submit))
      .toEqual({ ...submitted, replayed: true });
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(pending);
    const catalog = await loadPublishedCatalog(getRootPostgresPool(f.db)!);
    if (!catalog) throw new Error("Published Catalog fixture unavailable");
    await f.db.query(`create function public.reject_rollback_apply() returns trigger language plpgsql as $$
      begin if new.action='value-change-applied' then raise exception 'late rollback apply failure'; end if;
      return new; end $$`);
    await f.db.query("create trigger reject_rollback_apply before insert on audit_events for each row execute function public.reject_rollback_apply()");
    await expect(f.db.transaction((tx) => approveCanonicalBatchValueChange(tx, f.storage, reviewer, catalog, {
      projectId: PROJECT, requestId: submitted.requestId, batchProofDigest: prepared.batchProofDigest,
      invocation: createUserInvocation(reviewer), traceId: `906-${format}-rollback-review-fault`,
      refusalSink: createTrustedRefusalAuditSink(f.db)
    }))).rejects.toThrow("late rollback apply failure");
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(pending);
    expect(await objects(f.directory)).toEqual(preparedObjects);
    await f.db.query("drop trigger reject_rollback_apply on audit_events");
    await f.db.query("drop function public.reject_rollback_apply()");
    const applied = await f.db.transaction((tx) => approveCanonicalBatchValueChange(tx, f.storage, reviewer, catalog, {
      projectId: PROJECT, requestId: submitted.requestId, batchProofDigest: prepared.batchProofDigest,
      invocation: createUserInvocation(reviewer), traceId: `906-${format}-rollback-review`,
      refusalSink: createTrustedRefusalAuditSink(f.db)
    }));
    expect(applied.status).toBe("approved");
    const after = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    expect(after.values.length).toBe(pending.values.length + 2);
    expect(after.pins.length).toBe(pending.pins.length + 2);
    expect(after.history.length).toBe(pending.history.length + 2);
    expect(after.versions.length).toBe(pending.versions.length + 1);
    const activeVersionId = after.files.find((file) => file.id === f.fileId)!.currentVersionId!;
    const activePins = await Promise.all(after.bindings.map((binding) => loadOwnedProjectValueSourcePin(f.db, {
      organizationId: ORG, projectId: PROJECT, bindingId: binding.id,
      projectValueId: binding.currentValueId
    })));
    expect(activePins.every((pin) => pin?.fileVersionId === activeVersionId)).toBe(true);
    const activeKey = (await f.db.query<{ storage_key: string }>(
      "select storage_key from project_parameter_file_versions where id=$1", [activeVersionId])).rows[0]!.storage_key;
    expect((await f.storage.get(activeKey)).toString()).toBe(f.before);
    expect(await submitCanonicalBatchRollback(f.db, f.storage, admin, submit))
      .toEqual({ ...submitted, status: "approved", replayed: true });
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(after);
  }, 120_000);

  it.each(["json", "dts"] as const)("rejects stale %s rollback proof after a real source advance", async (format) => {
    const f = await fixture(format);
    const prepared = await prepareCanonicalBatchRollbackCandidate(f.db, f.storage, admin, {
      projectId: PROJECT, fileId: f.fileId, versionId: f.baseVersionId,
      expectedCurrentVersionId: f.activeVersionId, expectedWorkflowProofToken: f.workflowProofToken,
      requestId: `906-${format}-stale-prepare`
    });
    await advanceSource(f, format);
    const drifted = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const stored = await objects(f.directory);
    await expect(submitCanonicalBatchRollback(f.db, f.storage, admin, {
      projectId: PROJECT, fileId: f.fileId, versionId: f.baseVersionId,
      candidateId: prepared.candidateId, expectedCurrentVersionId: f.activeVersionId,
      expectedWorkflowProofToken: f.workflowProofToken, expectedCandidateProofToken: prepared.proofToken,
      expectedBatchProofDigest: prepared.batchProofDigest, reason: "stale rollback", assignedToUserId: REVIEWER,
      requestId: `906-${format}-stale-submit`, refusalSink: createTrustedRefusalAuditSink(f.db)
    })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "source-proof-stale" } });
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(drifted);
    expect(await objects(f.directory)).toEqual(stored);
  }, 120_000);

  it.each(["json", "dts"] as const)("rejects changed %s historical object at prepare, submit and review", async (format) => {
    const f = await fixture(format);
    const key = (await f.db.query<{ storage_key: string }>(
      "select storage_key from project_parameter_file_versions where id=$1", [f.baseVersionId])).rows[0]!.storage_key;
    const poisoned = { ...f.storage,
      getBounded: async (storageKey: string, maxBytes: number) => storageKey === key
        ? Buffer.from("tampered historical bytes") : f.storage.getBounded!(storageKey, maxBytes)
    };
    const prepareInput = { projectId: PROJECT, fileId: f.fileId, versionId: f.baseVersionId,
      expectedCurrentVersionId: f.activeVersionId, expectedWorkflowProofToken: f.workflowProofToken,
      requestId: `906-${format}-historical-prepare` };
    const initial = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const initialObjects = await objects(f.directory);
    await expect(prepareCanonicalBatchRollbackCandidate(f.db, poisoned, admin, prepareInput))
      .rejects.toMatchObject({ code: "CONFLICT", details: { reason: "historical-version-stale" } });
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(initial);
    expect(await objects(f.directory)).toEqual(initialObjects);
    const prepared = await prepareCanonicalBatchRollbackCandidate(f.db, f.storage, admin, prepareInput);
    const submitInput = { projectId: PROJECT, fileId: f.fileId, versionId: f.baseVersionId,
      candidateId: prepared.candidateId, expectedCurrentVersionId: f.activeVersionId,
      expectedWorkflowProofToken: f.workflowProofToken, expectedCandidateProofToken: prepared.proofToken,
      expectedBatchProofDigest: prepared.batchProofDigest, reason: "restore history",
      assignedToUserId: REVIEWER, requestId: `906-${format}-historical-submit`,
      refusalSink: createTrustedRefusalAuditSink(f.db) };
    const afterPrepare = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const preparedObjects = await objects(f.directory);
    await expect(submitCanonicalBatchRollback(f.db, poisoned, admin, submitInput))
      .rejects.toMatchObject({ code: "CONFLICT", details: { reason: "historical-version-stale" } });
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(afterPrepare);
    expect(await objects(f.directory)).toEqual(preparedObjects);
    const submitted = await submitCanonicalBatchRollback(f.db, f.storage, admin, submitInput);
    const pending = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const catalog = await loadPublishedCatalog(getRootPostgresPool(f.db)!);
    if (!catalog) throw new Error("Published Catalog fixture unavailable");
    await expect(f.db.transaction((tx) => approveCanonicalBatchValueChange(tx, poisoned, reviewer, catalog, {
      projectId: PROJECT, requestId: submitted.requestId, batchProofDigest: prepared.batchProofDigest,
      invocation: createUserInvocation(reviewer), traceId: `906-${format}-historical-review-fault`,
      refusalSink: createTrustedRefusalAuditSink(f.db)
    }))).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "historical-version-stale" } });
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(pending);
    expect(await objects(f.directory)).toEqual(preparedObjects);
    expect(pending.requests.find((request) => request.id === submitted.requestId)?.status).toBe("pending");
  }, 120_000);

  it("rejects cross-tenant and non-admin rollback preparation without writes", async () => {
    const f = await fixture("json");
    const input = { projectId: PROJECT, fileId: f.fileId, versionId: f.baseVersionId,
      expectedCurrentVersionId: f.activeVersionId, expectedWorkflowProofToken: f.workflowProofToken,
      requestId: "906-json-permission-prepare" };
    const before = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const stored = await objects(f.directory);
    await expect(prepareCanonicalBatchRollbackCandidate(f.db, f.storage, reviewer, input))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(prepareCanonicalBatchRollbackCandidate(f.db, f.storage, foreign, input))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect(await objects(f.directory)).toEqual(stored);
    const prepared = await prepareCanonicalBatchRollbackCandidate(f.db, f.storage, admin, input);
    const submit = { projectId: PROJECT, fileId: f.fileId, versionId: f.baseVersionId,
      candidateId: prepared.candidateId, expectedCurrentVersionId: f.activeVersionId,
      expectedWorkflowProofToken: f.workflowProofToken, expectedCandidateProofToken: prepared.proofToken,
      expectedBatchProofDigest: prepared.batchProofDigest, reason: "permission probe",
      assignedToUserId: REVIEWER, requestId: "906-json-permission-submit",
      refusalSink: createTrustedRefusalAuditSink(f.db) };
    const afterPrepare = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const preparedObjects = await objects(f.directory);
    await expect(submitCanonicalBatchRollback(f.db, f.storage, reviewer, submit))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(submitCanonicalBatchRollback(f.db, f.storage, foreign, submit))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(afterPrepare);
    expect(await objects(f.directory)).toEqual(preparedObjects);
  }, 120_000);

  it("cleans an acknowledged candidate object after a late preparation failure", async () => {
    const f = await fixture("json");
    const before = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const stored = await objects(f.directory);
    await f.db.query(`create function public.reject_rollback_candidate_marker() returns trigger language plpgsql as $$
      begin if new.impact ? 'canonicalBatchRollback' then raise exception 'late rollback candidate failure'; end if;
      return new; end $$`);
    await f.db.query("create trigger reject_rollback_candidate_marker before update on project_parameter_file_candidates for each row execute function public.reject_rollback_candidate_marker()");
    await expect(prepareCanonicalBatchRollbackCandidate(f.db, f.storage, admin, {
      projectId: PROJECT, fileId: f.fileId, versionId: f.baseVersionId,
      expectedCurrentVersionId: f.activeVersionId, expectedWorkflowProofToken: f.workflowProofToken,
      requestId: "906-json-late-candidate-failure"
    })).rejects.toThrow("late rollback candidate failure");
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect(await objects(f.directory)).toEqual(stored);
  }, 120_000);

  it("does not approve a rollback candidate submitted without D's historical receipt", async () => {
    const f = await fixture("json");
    const prepared = await prepareCanonicalBatchRollbackCandidate(f.db, f.storage, admin, {
      projectId: PROJECT, fileId: f.fileId, versionId: f.baseVersionId,
      expectedCurrentVersionId: f.activeVersionId, expectedWorkflowProofToken: f.workflowProofToken,
      requestId: "906-json-no-rollback-receipt-prepare"
    });
    const request = await submitCanonicalBatchValueChange(f.db, f.storage, admin, {
      projectId: PROJECT, candidateId: prepared.candidateId, expectedProofToken: prepared.proofToken,
      reason: "unattested historical candidate", assignedToUserId: REVIEWER,
      invocation: createUserInvocation(admin), requestId: "906-json-no-rollback-receipt-submit",
      refusalSink: createTrustedRefusalAuditSink(f.db)
    });
    const pending = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const stored = await objects(f.directory);
    const catalog = await loadPublishedCatalog(getRootPostgresPool(f.db)!);
    if (!catalog) throw new Error("Published Catalog fixture unavailable");
    await expect(f.db.transaction((tx) => approveCanonicalBatchValueChange(tx, f.storage, reviewer, catalog, {
      projectId: PROJECT, requestId: request.id, batchProofDigest: prepared.batchProofDigest,
      invocation: createUserInvocation(reviewer), traceId: "906-json-no-rollback-receipt-review",
      refusalSink: createTrustedRefusalAuditSink(f.db)
    }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).toEqual(pending);
    expect(await objects(f.directory)).toEqual(stored);
    expect(pending.requests.find((row) => row.id === request.id)?.status).toBe("pending");
  }, 120_000);
});
