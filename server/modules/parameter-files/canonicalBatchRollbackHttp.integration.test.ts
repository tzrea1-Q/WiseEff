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
import { parseDtsValue } from "../dts";
import { installConfigurationSourceFixture, captureConfigurationSourceState } from "../../testing/parameterCatalog/configurationSource";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { loadLegacyBindingIdentity } from "../parameter-bindings/binding/migrationAdapter";
import { loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";
import { submitCanonicalBatchValueChange, approveCanonicalBatchValueChange } from "../parameter-bindings/drafts/batchChangeService";
import { createCanonicalValueDraft } from "../parameter-bindings/drafts/service";
import { createConfigSet, addConfigSetFile } from "./configSetService";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { uploadProjectParameterFile } from "./service";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../parameter-topology/types";
import { createCandidate } from "./candidateService";
import { getCanonicalSourceWorkflow, previewCanonicalCandidate } from "./canonicalFileWorkflow";
import { registerCatalogProjectValueConsumerRoutes } from "../parameter-bindings/catalogProjectValueRoutes";
import { canonicalBatchRollbackPrepareResponseSchema, canonicalBatchRollbackSubmitResponseSchema } from "../contracts/dtoSchemas/canonicalBatchRollback";
import { registerParameterFileRoutes } from "./routes";

const ORG = "org-906-batch-rollback";
const PROJECT = "project-906-batch-rollback";
const ADMIN = "user-906-batch-rollback-admin";
const REVIEWER = "user-906-batch-rollback-reviewer";
const OTHER_REVIEWER = "user-906-batch-rollback-other-reviewer";
const DEF = "pdef_acme_power_iin_max";
const admin = makeTestAuthContext({ userId: ADMIN, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });
const reviewer = makeTestAuthContext({ userId: REVIEWER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: PROJECT }] });
const otherReviewer = makeTestAuthContext({ userId: OTHER_REVIEWER, organizationId: ORG,
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
  await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true),($4,$2,'other reviewer','Reviewer',true)", [ADMIN, ORG, REVIEWER, OTHER_REVIEWER]);
  await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Batch rollback','BR906','initialized')", [PROJECT, ORG]);
  await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('rollback-admin',$1,$2,null,'admin'),('rollback-reviewer',$3,$2,$4,'software-committer'),('rollback-other-reviewer',$5,$2,$4,'software-committer')", [ADMIN, ORG, REVIEWER, PROJECT, OTHER_REVIEWER]);
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
  const current = (await listCatalogBindingRowsForProject(db, admin, { projectId: PROJECT }))[0]!;
  const pin = await loadOwnedProjectValueSourcePin(db, { organizationId: ORG, projectId: PROJECT,
    bindingId: current.id, projectValueId: current.currentValueId });
  if (!pin) throw new Error("Current source pin unavailable");
  await createCanonicalValueDraft(db, otherReviewer, {
    projectId: PROJECT, bindingId: current.id,
    ...(format === "json" ? { sourceTarget: { format: "json" as const, sourceText: "88" } }
      : { targetValue: parseDtsValue("iin_max", "<88>").value }),
    reason: "Other author's unfinished work", baseRevisionId: pin.configRevisionId,
    baseCurrentValueId: current.currentValueId
  }, { objectStore: storage, invocation: createUserInvocation(otherReviewer),
    requestId: `906-${format}-other-author-draft`, refusalSink: createTrustedRefusalAuditSink(db) });
  return { db, storage, directory, fileId: uploaded.file.id, fileName, baseVersionId: uploaded.version.id,
    activeVersionId, workflowProofToken: workflow.proofToken, before, after, candidateId: candidate.id };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Prepared = { candidateId: string; proofToken: string; batchProofDigest: string;
  targets: Array<{ bindingId: string }>; cohort: Array<{ bindingId: string }>; replayed: boolean };
type Submitted = { candidateId: string; requestId: string; status: string; batchProofDigest: string; replayed: boolean };

function route(f: Fixture, auth = admin, storage = f.storage) {
  const router = createRouter();
  const options = { db: f.db, objectStore: storage, getCurrentAuthContext: () => auth };
  registerParameterFileRoutes(router, options);
  registerCatalogProjectValueConsumerRoutes(router, options);
  return createHttpServer(router);
}

const basePath = (f: Fixture) =>
  `/api/v1/projects/${PROJECT}/parameter-files/${f.fileId}/source-batch-rollback`;
const reviewPath = (requestId: string) =>
  `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${requestId}`;
const prepareBody = (f: Fixture) => ({
  versionId: f.baseVersionId, expectedCurrentVersionId: f.activeVersionId,
  expectedWorkflowProofToken: f.workflowProofToken
});
const submitBody = (f: Fixture, prepared: Prepared) => ({
  ...prepareBody(f), candidateId: prepared.candidateId,
  expectedCandidateProofToken: prepared.proofToken,
  expectedBatchProofDigest: prepared.batchProofDigest,
  assignedToUserId: REVIEWER, reason: "Restore exact historical cohort"
});

async function prepare(f: Fixture, key: string, storage = f.storage) {
  return requestJson<{ item: Prepared; error?: { code: string; details?: { reason: string } } }>(
    route(f, admin, storage), `${basePath(f)}/prepare`, {
      method: "POST", headers: { "X-Request-Id": key }, body: JSON.stringify(prepareBody(f))
    });
}

async function submit(f: Fixture, prepared: Prepared, key: string, storage = f.storage,
  override: Record<string, unknown> = {}) {
  return requestJson<{ item: Submitted; error?: { code: string; details?: { reason: string } } }>(
    route(f, admin, storage), `${basePath(f)}/submit`, {
      method: "POST", headers: { "X-Request-Id": key },
      body: JSON.stringify({ ...submitBody(f, prepared), ...override })
    });
}

async function review(f: Fixture, submitted: Submitted, decision: "approve" | "reject",
  auth = reviewer, storage = f.storage) {
  return requestJson<{ item: { status: string } }>(route(f, auth, storage),
    `${reviewPath(submitted.requestId)}/review`, {
      method: "POST", body: JSON.stringify({ decision, batchProofDigest: submitted.batchProofDigest })
    });
}

describe("#906 canonical historical batch rollback HTTP", () => {
  it.each(["json", "dts"] as const)("prepares, discovers and approves one %s two-Binding request", async (format) => {
    const f = await fixture(format);
    const before = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const preparedResponse = await prepare(f, `906-http-${format}-prepare`);
    expect(preparedResponse.status, JSON.stringify(preparedResponse.body)).toBe(201);
    canonicalBatchRollbackPrepareResponseSchema.parse(preparedResponse.body);
    const prepared = preparedResponse.body.item;
    expect(prepared.targets).toHaveLength(2);
    expect(prepared.cohort).toHaveLength(2);
    expect(prepared.targets.map((target) => target.bindingId))
      .toEqual([...prepared.targets.map((target) => target.bindingId)].sort());
    expect((await prepare(f, `906-http-${format}-prepare`)).body.item)
      .toMatchObject({ candidateId: prepared.candidateId, replayed: true });
    const afterPrepare = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    expect(afterPrepare.values).toEqual(before.values);
    expect(afterPrepare.pins).toEqual(before.pins);
    expect(afterPrepare.history).toEqual(before.history);
    expect(afterPrepare.versions).toEqual(before.versions);
    const submittedResponse = await submit(f, prepared, `906-http-${format}-submit`);
    expect(submittedResponse.status, JSON.stringify(submittedResponse.body)).toBe(201);
    canonicalBatchRollbackSubmitResponseSchema.parse(submittedResponse.body);
    const submitted = submittedResponse.body.item;
    expect(submitted).toMatchObject({ status: "pending", candidateId: prepared.candidateId,
      batchProofDigest: prepared.batchProofDigest });
    expect((await submit(f, prepared, `906-http-${format}-submit`)).body.item)
      .toMatchObject({ requestId: submitted.requestId, replayed: true });
    const pending = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    expect(pending.values).toEqual(before.values);
    expect(pending.pins).toEqual(before.pins);
    expect(pending.history).toEqual(before.history);
    expect((await submit(f, prepared, `906-http-${format}-submit`, f.storage,
      { reason: "Changed retry" })).status).toBe(409);
    expect((await requestJson(route(f, reviewer), `${reviewPath(submitted.requestId)}/review`, {
      method: "POST", body: JSON.stringify({ decision: "approve", batchProofDigest: "0".repeat(64) })
    })).status).toBe(409);
    const afterBadProof = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    expect(afterBadProof.values).toEqual(pending.values);
    expect(afterBadProof.pins).toEqual(pending.pins);
    expect(afterBadProof.history).toEqual(pending.history);
    const queue = await requestJson<{ items: Array<{ id: string }> }>(route(f, reviewer),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches?status=pending`);
    expect(queue.status).toBe(200);
    expect(queue.body.items.map((item) => item.id)).toContain(submitted.requestId);
    const detail = await requestJson<{ item: { targets: Array<{ ordinal: number; bindingId: string }> } }>(
      route(f, reviewer), `${reviewPath(submitted.requestId)}/batch`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.item.targets.map((target) => target.ordinal)).toEqual([0, 1]);
    expect(detail.body.item.targets.map((target) => target.bindingId))
      .toEqual(prepared.targets.map((target) => target.bindingId));
    const diff = await requestJson<{ item: { format: string; batchProofDigest: string;
      targets: Array<{ ordinal: number }> } }>(route(f, reviewer),
      `${reviewPath(submitted.requestId)}/source-diff`);
    expect(diff.status, JSON.stringify(diff.body)).toBe(200);
    expect(diff.body.item).toMatchObject({ format, batchProofDigest: prepared.batchProofDigest });
    expect(diff.body.item.targets.map((target) => target.ordinal)).toEqual([0, 1]);
    expect((await review(f, submitted, "approve")).status).toBe(200);
    expect((await review(f, submitted, "approve")).body.item.status).toBe("approved");
    const after = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    expect(after.values).toHaveLength(pending.values.length + 2);
    expect(after.drafts).toEqual(pending.drafts);
    expect(after.pins).toHaveLength(pending.pins.length + 2);
    expect(after.history).toHaveLength(pending.history.length + 2);
    expect(after.versions).toHaveLength(pending.versions.length + 1);
    const versionId = after.files.find((file) => file.id === f.fileId)!.currentVersionId!;
    const pins = await Promise.all(prepared.cohort.map(async (member) => {
      const binding = after.bindings.find((row) => row.id === member.bindingId)!;
      return loadOwnedProjectValueSourcePin(f.db, { organizationId: ORG, projectId: PROJECT,
        bindingId: member.bindingId, projectValueId: binding.currentValueId });
    }));
    expect(pins.every((pin) => pin?.fileVersionId === versionId)).toBe(true);
    const key = (await f.db.query<{ storage_key: string }>(
      "select storage_key from project_parameter_file_versions where id=$1", [versionId])).rows[0]!.storage_key;
    expect((await f.storage.get(key)).toString()).toBe(f.before);
    expect((await submit(f, prepared, `906-http-${format}-submit`)).body.item)
      .toMatchObject({ requestId: submitted.requestId, status: "approved", replayed: true });
    expect(await Promise.all(prepared.targets.map((target) =>
      loadLegacyBindingIdentity(getRootPostgresPool(f.db)!, target.bindingId)))).toEqual([null, null]);
  }, 120_000);

  it.each(["json", "dts"] as const)("keeps %s proof, authorization, reject and withdrawal atomic", async (format) => {
    const f = await fixture(format);
    const initial = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const initialObjects = await objects(f.directory);
    for (const auth of [reviewer, foreign]) {
      const denied = await requestJson(route(f, auth), `${basePath(f)}/prepare`, {
        method: "POST", body: JSON.stringify(prepareBody(f))
      });
      expect(denied.status).toBe(auth === reviewer ? 403 : 404);
    }
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT }))
      .toEqual(initial);
    expect(await objects(f.directory)).toEqual(initialObjects);
    const prepared = (await prepare(f, `906-http-${format}-deny-prepare`)).body.item;
    const afterPrepare = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const preparedObjects = await objects(f.directory);
    expect((await submit(f, prepared, `906-http-${format}-bad-proof`, f.storage,
      { expectedBatchProofDigest: "0".repeat(64) })).status).toBe(409);
    for (const auth of [reviewer, foreign]) {
      const denied = await requestJson(route(f, auth), `${basePath(f)}/submit`, {
        method: "POST", body: JSON.stringify(submitBody(f, prepared))
      });
      expect(denied.status).toBe(auth === reviewer ? 403 : 404);
    }
    expect((await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT })).values)
      .toEqual(afterPrepare.values);
    const submitted = (await submit(f, prepared, `906-http-${format}-reject`)).body.item;
    const pending = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    expect(pending.values).toEqual(afterPrepare.values);
    expect(pending.pins).toEqual(afterPrepare.pins);
    expect(pending.history).toEqual(afterPrepare.history);
    for (const auth of [otherReviewer, foreign]) {
      expect((await requestJson(route(f, auth), `${reviewPath(submitted.requestId)}/batch`)).status).toBe(404);
      expect((await requestJson(route(f, auth), `${reviewPath(submitted.requestId)}/source-diff`)).status).toBe(404);
      expect((await review(f, submitted, "approve", auth)).status).toBe(404);
    }
    await f.db.query("delete from user_role_bindings where id='rollback-reviewer'");
    expect((await requestJson(route(f, reviewer), `${reviewPath(submitted.requestId)}/batch`)).status).toBe(403);
    expect((await review(f, submitted, "approve")).status).toBe(403);
    await f.db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('rollback-reviewer',$1,$2,$3,'software-committer')",
      [REVIEWER, ORG, PROJECT]);
    expect((await review(f, submitted, "reject")).body.item.status).toBe("rejected");
    const rejected = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    expect(rejected.values).toEqual(pending.values);
    expect(rejected.pins).toEqual(pending.pins);
    expect(rejected.history).toEqual(pending.history);
    expect(rejected.versions).toEqual(pending.versions);
    expect((await review(f, submitted, "reject")).body.item.status).toBe("rejected");
    const next = (await submit(f, prepared, `906-http-${format}-withdraw`)).body.item;
    expect(next.requestId).not.toBe(submitted.requestId);
    const withdraw = () => requestJson<{ item: { status: string } }>(route(f),
      `${reviewPath(next.requestId)}/withdraw`, { method: "POST" });
    expect((await withdraw()).body.item.status).toBe("withdrawn");
    expect((await withdraw()).body.item.status).toBe("withdrawn");
    const withdrawn = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    expect(withdrawn.values).toEqual(pending.values);
    expect(withdrawn.pins).toEqual(pending.pins);
    expect(withdrawn.history).toEqual(pending.history);
    expect(withdrawn.versions).toEqual(pending.versions);
    expect(await objects(f.directory)).toEqual(preparedObjects);
  }, 120_000);

  it.each(["json", "dts"] as const)("rejects stale %s proof after a newer HTTP-approved source", async (format) => {
    const f = await fixture(format);
    const prepared = (await prepare(f, `906-http-${format}-stale-prepare`)).body.item;
    const changed = format === "json"
      ? Buffer.from('{ "settings": { "limit": 70 }, "other": { "limit": 80 } }\n')
      : Buffer.from(f.after.replace("<50>", "<70>").replace("<60>", "<80>"));
    const candidate = await createCandidate(f.db, f.storage, admin, {
      projectId: PROJECT, fileId: f.fileId, fileName: f.fileName, bytes: changed
    });
    const preview = await previewCanonicalCandidate(f.db, f.storage, admin,
      { projectId: PROJECT, candidateId: candidate.id });
    const newer = await requestJson<{ item: { id: string; batchProofDigest: string } }>(route(f),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
        method: "POST", headers: { "X-Request-Id": `906-http-${format}-newer-submit` },
        body: JSON.stringify({ candidateId: candidate.id, expectedProofToken: preview.proofToken,
          assignedToUserId: REVIEWER, reason: "Advance whole source" })
      });
    expect(newer.status, JSON.stringify(newer.body)).toBe(201);
    expect((await requestJson(route(f, reviewer),
      `${reviewPath(newer.body.item.id)}/review`, {
        method: "POST", body: JSON.stringify({
          decision: "approve", batchProofDigest: newer.body.item.batchProofDigest
        })
      })).status).toBe(200);
    const current = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const stored = await objects(f.directory);
    const stale = await submit(f, prepared, `906-http-${format}-stale-submit`);
    expect(stale.status, JSON.stringify(stale.body)).toBe(409);
    expect(stale.body.error?.details?.reason).toBe("source-proof-stale");
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT }))
      .toEqual(current);
    expect(await objects(f.directory)).toEqual(stored);
  }, 120_000);

  it.each(["json", "dts"] as const)("rejects changed %s historical bytes at every HTTP boundary", async (format) => {
    const f = await fixture(format);
    const key = (await f.db.query<{ storage_key: string }>(
      "select storage_key from project_parameter_file_versions where id=$1", [f.baseVersionId])).rows[0]!.storage_key;
    const poisoned = { ...f.storage,
      getBounded: async (storageKey: string, maxBytes: number) => storageKey === key
        ? Buffer.from("tampered historical bytes") : f.storage.getBounded!(storageKey, maxBytes)
    };
    const initial = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const initialObjects = await objects(f.directory);
    const deniedPrepare = await prepare(f, `906-http-${format}-poisoned-prepare`, poisoned);
    expect(deniedPrepare.status).toBe(409);
    expect(deniedPrepare.body.error?.details?.reason).toBe("historical-version-stale");
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT }))
      .toEqual(initial);
    expect(await objects(f.directory)).toEqual(initialObjects);
    const prepared = (await prepare(f, `906-http-${format}-valid-prepare`)).body.item;
    const afterPrepare = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const preparedObjects = await objects(f.directory);
    const deniedSubmit = await submit(f, prepared, `906-http-${format}-poisoned-submit`, poisoned);
    expect(deniedSubmit.status).toBe(409);
    expect(deniedSubmit.body.error?.details?.reason).toBe("historical-version-stale");
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT }))
      .toEqual(afterPrepare);
    expect(await objects(f.directory)).toEqual(preparedObjects);
    const submitted = (await submit(f, prepared, `906-http-${format}-valid-submit`)).body.item;
    const pending = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const deniedReview = await review(f, submitted, "approve", reviewer, poisoned);
    expect(deniedReview.status).toBe(409);
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT }))
      .toEqual(pending);
    expect(await objects(f.directory)).toEqual(preparedObjects);
  }, 120_000);

  it.each(["json", "dts"] as const)("rolls back late %s HTTP approval and retries one request", async (format) => {
    const f = await fixture(format);
    const prepared = (await prepare(f, `906-http-${format}-retry-prepare`)).body.item;
    const submitted = (await submit(f, prepared, `906-http-${format}-retry-submit`)).body.item;
    const pending = await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT });
    const preparedObjects = await objects(f.directory);
    await f.db.query(`create function public.reject_rollback_http_apply() returns trigger language plpgsql as $$
      begin if new.action='value-change-applied' then raise exception 'late HTTP apply failure'; end if;
      return new; end $$`);
    await f.db.query("create trigger reject_rollback_http_apply before insert on audit_events for each row execute function public.reject_rollback_http_apply()");
    const failed = await review(f, submitted, "approve");
    expect(failed.status).toBe(500);
    expect(await captureConfigurationSourceState(f.db, { organizationId: ORG, projectId: PROJECT }))
      .toEqual(pending);
    expect(await objects(f.directory)).toEqual(preparedObjects);
    await f.db.query("drop trigger reject_rollback_http_apply on audit_events");
    await f.db.query("drop function public.reject_rollback_http_apply()");
    const approved = await review(f, submitted, "approve");
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.item.status).toBe("approved");
  }, 120_000);
});

type Fixture = Awaited<ReturnType<typeof fixture>>;
