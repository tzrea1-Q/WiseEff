import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { installDriverSourceFixture } from "../../../testing/parameterCatalog/driverSource";
import { captureConfigurationSourceState } from "../../../testing/parameterCatalog/configurationSource";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { createRouter } from "../../../shared/http/router";
import { createHttpServer } from "../../../shared/http/server";
import { requestJson } from "../../../test/testClient";
import { createLocalObjectStore } from "../../logs/objectStore";
import { createTrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { parseDtsValue } from "../../dts";
import { ingestConfigRevision } from "../../parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../../parameter-topology/types";
import { createConfigSet, addConfigSetFile } from "../../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { registerParameterFileRoutes } from "../../parameter-files/routes";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog,
  syncPublishedCatalogProjectValuesInTransaction } from "../catalogProjectValueSync";
import { loadLegacyBindingIdentity } from "../binding/migrationAdapter";
import { registerCatalogProjectValueConsumerRoutes } from "../catalogProjectValueRoutes";
import { createCanonicalValueDraft, removeCanonicalValueDraft } from "./service";
import { catalogBatchValueChangeRequestResponseSchema,
  catalogValueChangeSourceDiffResponseSchema } from "../../contracts/dtoSchemas/parameterCatalog";

const ORG = "org-906-c-mixed-http-dts";
const PROJECT = "project-906-c-mixed-http-dts";
const ADMIN = "user-906-c-mixed-http-admin";
const REVIEWER = "user-906-c-mixed-http-reviewer";
const OTHER = "user-906-c-mixed-http-other";
const AUTHOR = "user-906-c-mixed-http-author";
const BASE = '/dts-v1/;\n/ {\n  first: device@0 { compatible = "acme,power"; iin_max = <10>; };\n  second: device@1 { compatible = "acme,power"; iin_max = <20>; };\n  third: device@2 { compatible = "acme,power"; iin_max = <30>; };\n};\n';
const UPLOAD = BASE.replace("iin_max = <10>", "iin_max = <50>").replace("iin_max = <20>", "iin_max = <60>");
const admin = makeTestAuthContext({ userId: ADMIN, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });
const reviewer = makeTestAuthContext({ userId: REVIEWER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: PROJECT }] });
const other = makeTestAuthContext({ userId: OTHER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: PROJECT }] });
const author = makeTestAuthContext({ userId: AUTHOR, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit"],
  roles: [{ roleId: "software-user", projectId: PROJECT }] });
const foreign = makeTestAuthContext({ userId: "foreign-reviewer", organizationId: "foreign-org",
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: PROJECT }] });

async function objects(directory: string) {
  const names = (await readdir(directory, { recursive: true })).sort();
  return Promise.all(names.map(async (name) => [name,
    (await stat(join(directory, name))).isFile() ? (await readFile(join(directory, name))).toString("base64") : null]));
}

describe("#906 C mixed DTS batch over production HTTP", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let directory: string;
  let fileId: string;

  beforeEach(async () => {
    lane = await createEphemeralTestDatabase("c906-mixed-http-dts");
    db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-c906-mixed-http-dts-"));
    storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'C mixed DTS')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true),($4,$2,'other','Reviewer',true),($5,$2,'author','Author',true)",
      [ADMIN, ORG, REVIEWER, OTHER, AUTHOR]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'C mixed DTS','C906M','initialized')", [PROJECT, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('c906-mix-admin',$1,$2,null,'admin'),('c906-mix-reviewer',$3,$2,$4,'software-committer'),('c906-mix-other',$5,$2,$4,'software-committer'),('c906-mix-author',$6,$2,$4,'software-user')",
      [ADMIN, ORG, REVIEWER, PROJECT, OTHER, AUTHOR]);
    await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power",
      businessName: "C mixed DTS", driverName: "Acme power", idempotencyKey: "c906-mixed-dts-driver", reason: "C mixed DTS" });
    const set = await createConfigSet(db, admin, { projectId: PROJECT, name: "C mixed DTS" });
    const uploaded = await uploadProjectParameterFile(db, storage, admin,
      { projectId: PROJECT, fileName: "board.dts", bytes: Buffer.from(BASE) });
    fileId = uploaded.file.id;
    await addConfigSetFile(db, admin, { configSetId: set.id, fileId, role: "base", sortOrder: 0 });
    const manifest: ConfigRevisionManifest = { organizationId: ORG, projectId: PROJECT, configSetId: set.id,
      entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [],
      members: [{ fileId, fileVersionId: uploaded.version.id, fileName: "board.dts",
        sourceName: "board.dts", role: "base", sortOrder: 0, content: BASE }] };
    const revision = await ingestConfigRevision(db, manifest, admin, { legacyProjection: "skip" });
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Published Catalog fixture is unavailable");
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog,
      { organizationId: ORG, projectId: PROJECT, configSetId: set.id, configRevisionId: revision.id }));
    const bindings = await listCatalogBindingRowsForProject(db, admin, { projectId: PROJECT });
    expect(bindings).toHaveLength(3);
    expect(await Promise.all(bindings.map((binding) => loadLegacyBindingIdentity(getRootPostgresPool(db)!, binding.id))))
      .toEqual([null, null, null]);
  }, 120_000);

  afterEach(async () => {
    await db?.close();
    await lane?.drop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  function route(auth = admin) {
    const router = createRouter();
    registerParameterFileRoutes(router, { db, objectStore: storage, getCurrentAuthContext: () => auth });
    registerCatalogProjectValueConsumerRoutes(router, { db, objectStore: storage,
      getCurrentAuthContext: () => auth });
    return createHttpServer(router);
  }

  async function draft(bindingId: string, value = 88) {
    const base = (await db.query<{ current_value_id: string; config_revision_id: string }>(`
      select binding.current_value_id,value.config_revision_id
        from parameter_catalog.project_parameter_bindings binding
        join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
       where binding.id=$1`, [bindingId])).rows[0]!;
    return createCanonicalValueDraft(db, author, { projectId: PROJECT, bindingId,
      targetValue: parseDtsValue("iin_max", `<${value}>`).value,
      reason: `Other author ${value}`, baseRevisionId: base.config_revision_id,
      baseCurrentValueId: base.current_value_id
    }, { objectStore: storage, invocation: createUserInvocation(author),
      requestId: `c906-mixed-http-draft-${bindingId}-${value}`,
      refusalSink: createTrustedRefusalAuditSink(db) });
  }

  async function prepare(upload = UPLOAD, requestId = "c906-mixed-http-dts-prepare") {
    const workflow = await requestJson<{ item: { proofToken: string } }>(route(),
      `/api/v1/projects/${PROJECT}/parameter-files/${fileId}/source-workflow`);
    expect(workflow.status).toBe(200);
    const version = (await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId])).rows[0]!.current_version_id;
    const prepared = await requestJson<{ item: { candidateId: string; proofToken: string;
      targets: Array<{ bindingId: string; targetText: string }> } }>(route(),
      `/api/v1/projects/${PROJECT}/parameter-files/${fileId}/source-manual-sync/prepare`, {
        method: "POST", headers: { "X-Request-Id": requestId },
        body: JSON.stringify({ contentBase64: Buffer.from(upload).toString("base64"),
          expectedCurrentVersionId: version, expectedWorkflowProofToken: workflow.body.item.proofToken })
      });
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(201);
    expect(prepared.body.item.targets).toHaveLength(2);
    return prepared.body.item;
  }

  async function submit(prepared: Awaited<ReturnType<typeof prepare>>, selectedId: string,
    requestId = "c906-mixed-http-dts-submit") {
    const first = prepared.targets.find((target) => target.targetText === "<50>")!;
    const body = { candidateId: prepared.candidateId, expectedProofToken: prepared.proofToken,
      reason: "Mixed DTS review", assignedToUserId: REVIEWER,
      targetDecisions: prepared.targets.map((target) => target.bindingId === first.bindingId
        ? { bindingId: target.bindingId, choice: "draft", draftId: selectedId }
        : { bindingId: target.bindingId, choice: "file" }) };
    return { body, response: await requestJson<{ item: { id: string; candidateId: string;
      batchProofDigest: string; draftImpactDigest: string; decisionProofDigest: string;
      uploadCandidateId: string; draftImpact: Array<{ role: string; decision: string;
        selectedDraftId?: string; drafts: Array<{ draftId: string }> }>;
      targets: Array<{ bindingId: string; decision: string; draftId: string | null }> } }>(route(),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
        method: "POST", headers: { "X-Request-Id": requestId }, body: JSON.stringify(body)
      }) };
  }

  const path = (id: string) => `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${id}`;
  const approval = (item: { batchProofDigest: string; draftImpactDigest: string; decisionProofDigest: string }) => ({
    decision: "approve", batchProofDigest: item.batchProofDigest,
    draftImpactDigest: item.draftImpactDigest, decisionProofDigest: item.decisionProofDigest
  });

  it("reviews 50/60/30 upload as 88/60/30 with one request and one atomic cohort", async () => {
    const prepared = await prepare();
    const first = prepared.targets.find((target) => target.targetText === "<50>")!;
    const second = prepared.targets.find((target) => target.targetText === "<60>")!;
    const selected = await draft(first.bindingId);
    const unselected = await draft(second.bindingId, 77);
    const allBindings = await listCatalogBindingRowsForProject(db, admin, { projectId: PROJECT });
    const sibling = allBindings.find((binding) => !prepared.targets.some((target) => target.bindingId === binding.id))!;
    const siblingDraft = await draft(sibling.id, 99);
    const beforeSubmit = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objectsBeforeSubmit = await objects(directory);
    const omitted = await requestJson(route(), `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
      method: "POST", body: JSON.stringify({ candidateId: prepared.candidateId,
        expectedProofToken: prepared.proofToken, reason: "Mixed DTS review", assignedToUserId: REVIEWER })
    });
    expect(omitted).toMatchObject({ status: 409, body: { error: {
      details: { reason: "canonical-batch-target-decision-required" } } } });
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(beforeSubmit);
    expect(await objects(directory)).toEqual(objectsBeforeSubmit);
    const submitted = await submit(prepared, selected.id);
    expect(submitted.response.status, JSON.stringify(submitted.response.body)).toBe(201);
    catalogBatchValueChangeRequestResponseSchema.parse(submitted.response.body);
    const item = submitted.response.body.item;
    expect(item.uploadCandidateId).toBe(prepared.candidateId);
    expect(item.candidateId).not.toBe(prepared.candidateId);
    expect(item.targets.map((target) => [target.bindingId, target.decision, target.draftId]))
      .toEqual(prepared.targets.map((target) => [target.bindingId,
        target.bindingId === first.bindingId ? "draft" : "file",
        target.bindingId === first.bindingId ? selected.id : null]));
    expect(item.draftImpact).toHaveLength(3);
    expect(item.draftImpact.find((entry) => entry.role === "sibling"))
      .toMatchObject({ decision: "re-pin", drafts: [{ draftId: siblingDraft.id }] });
    expect(item.draftImpact.find((entry) => entry.selectedDraftId === selected.id))
      .toMatchObject({ decision: "draft" });
    expect(item.draftImpact.some((entry) => entry.drafts.some((draft) => draft.draftId === unselected.id))).toBe(true);
    const queued = await requestJson<{ items: Array<{ id: string }> }>(route(reviewer),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches?status=pending`);
    expect(queued.body.items.some((entry) => entry.id === item.id)).toBe(true);
    expect((await requestJson(route(reviewer), `${path(item.id)}/batch`)).status).toBe(200);
    const diff = await requestJson<{ item: { uploadAfter: string; after: string;
      targets: Array<{ decision: string }> } }>(route(reviewer), `${path(item.id)}/source-diff`);
    expect(diff.status, JSON.stringify(diff.body)).toBe(200);
    catalogValueChangeSourceDiffResponseSchema.parse(diff.body);
    expect(diff.body.item.uploadAfter).toContain("iin_max = <50>");
    expect(diff.body.item.after).toContain("iin_max = <88>");
    expect(diff.body.item.after).toContain("iin_max = <60>");
    expect(diff.body.item.after).toContain("iin_max = <30>");
    expect(diff.body.item.targets.map((entry) => entry.decision)).toContain("draft");
    expect((await requestJson(route(other), `${path(item.id)}/batch`)).status).toBe(404);
    expect((await requestJson(route(other), `${path(item.id)}/source-diff`)).status).toBe(404);
    expect((await requestJson(route(other), `${path(item.id)}/review`, {
      method: "POST", body: JSON.stringify(approval(item)) })).status).toBe(404);
    expect((await requestJson(route(foreign), `${path(item.id)}/batch`)).status).toBe(404);
    const objectsBeforeRetry = await objects(directory);
    const duplicate = await submit(prepared, selected.id, "c906-mixed-http-dts-retry");
    expect(duplicate.response.status).toBe(201);
    expect(duplicate.response.body.item.id).toBe(item.id);
    expect(await objects(directory)).toEqual(objectsBeforeRetry);
    const beforeReview = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objectsBeforeReview = await objects(directory);
    expect((await requestJson(route(reviewer), `${path(item.id)}/review`, {
      method: "POST", body: JSON.stringify({ ...approval(item), decisionProofDigest: "0".repeat(64) })
    })).status).toBe(409);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(beforeReview);
    expect(await objects(directory)).toEqual(objectsBeforeReview);
    const approved = await requestJson(route(reviewer), `${path(item.id)}/review`, {
      method: "POST", body: JSON.stringify(approval(item))
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body).toMatchObject({ item: { status: "approved" } });
    const after = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    expect(after.values).toHaveLength(beforeReview.values.length + 3);
    expect(after.pins).toHaveLength(beforeReview.pins.length + 3);
    expect(after.history).toHaveLength(beforeReview.history.length + 3);
    expect(after.versions).toHaveLength(beforeReview.versions.length + 1);
    expect(after.audits).toHaveLength(beforeReview.audits.length + 1);
    expect(after.drafts).toEqual(beforeReview.drafts);
    const values = (await db.query<{ value: unknown }>(`
      select value.value from parameter_catalog.project_parameter_bindings binding
        join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
       where binding.organization_id=$1 and binding.project_id=$2`, [ORG, PROJECT])).rows;
    expect(values.map((entry) => entry.value).sort()).toEqual([30, 60, 88]);
    expect((await requestJson(route(reviewer), `${path(item.id)}/review`, {
      method: "POST", body: JSON.stringify(approval(item)) })).body).toEqual(approved.body);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(after);
  }, 120_000);

  it("rejects newly inserted drafts and object drift without partial writes", async () => {
    const prepared = await prepare();
    const first = prepared.targets.find((target) => target.targetText === "<50>")!;
    const selected = await draft(first.bindingId);
    const submitted = await submit(prepared, selected.id);
    expect(submitted.response.status).toBe(201);
    const item = submitted.response.body.item;
    const sibling = (await listCatalogBindingRowsForProject(db, admin, { projectId: PROJECT }))
      .find((binding) => !prepared.targets.some((target) => target.bindingId === binding.id))!;
    const inserted = await draft(sibling.id, 99);
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objectsBefore = await objects(directory);
    expect((await requestJson(route(reviewer), `${path(item.id)}/review`, {
      method: "POST", body: JSON.stringify(approval(item)) })).status).toBe(409);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect(await objects(directory)).toEqual(objectsBefore);
    await removeCanonicalValueDraft(db, author, { projectId: PROJECT, draftId: inserted.id });
    const object = (await db.query<{ storage_key: string }>(
      "select storage_key from project_parameter_file_candidates where id=$1", [item.candidateId])).rows[0]!;
    await writeFile(join(directory, object.storage_key), Buffer.from("drift"));
    const drifted = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const driftObjects = await objects(directory);
    expect((await requestJson(route(reviewer), `${path(item.id)}/review`, {
      method: "POST", body: JSON.stringify(approval(item)) })).status).toBe(409);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(drifted);
    expect(await objects(directory)).toEqual(driftObjects);
  }, 120_000);

  it("keeps a pending request retryable after a late audit failure", async () => {
    const prepared = await prepare();
    const first = prepared.targets.find((target) => target.targetText === "<50>")!;
    const selected = await draft(first.bindingId);
    const submitted = await submit(prepared, selected.id);
    expect(submitted.response.status).toBe(201);
    const item = submitted.response.body.item;
    await db.query(`create function public.c906_mixed_fail_audit() returns trigger language plpgsql as $$ begin
      if new.action='value-change-applied' then raise exception 'injected mixed audit failure'; end if;
      return new; end $$`);
    await db.query(`create trigger c906_mixed_fail_audit before insert on audit_events
      for each row execute function public.c906_mixed_fail_audit()`);
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objectBefore = await objects(directory);
    const failed = await requestJson(route(reviewer), `${path(item.id)}/review`, {
      method: "POST", body: JSON.stringify(approval(item))
    });
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect(await objects(directory)).toEqual(objectBefore);
    await db.query("drop trigger c906_mixed_fail_audit on audit_events");
    const retried = await requestJson(route(reviewer), `${path(item.id)}/review`, {
      method: "POST", body: JSON.stringify(approval(item))
    });
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body).toMatchObject({ item: { status: "approved" } });
  }, 120_000);

  it("removes a composed object only after confirmed submission rollback", async () => {
    const prepared = await prepare();
    const first = prepared.targets.find((target) => target.targetText === "<50>")!;
    const selected = await draft(first.bindingId);
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objectBefore = await objects(directory);
    await db.query(`create function public.c906_mixed_fail_submit() returns trigger language plpgsql as $$ begin
      if new.action='value-change-submitted' then raise exception 'injected mixed submit failure'; end if;
      return new; end $$`);
    await db.query(`create trigger c906_mixed_fail_submit before insert on audit_events
      for each row execute function public.c906_mixed_fail_submit()`);
    const failed = await submit(prepared, selected.id, "c906-mixed-http-dts-rollback-submit");
    expect(failed.response.status).toBeGreaterThanOrEqual(400);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(before);
    expect(await objects(directory)).toEqual(objectBefore);
    await db.query("drop trigger c906_mixed_fail_submit on audit_events");
    const retried = await submit(prepared, selected.id, "c906-mixed-http-dts-rollback-submit");
    expect(retried.response.status, JSON.stringify(retried.response.body)).toBe(201);
  }, 120_000);

  it("rejects a changed file version and a reviewer who lost project role", async () => {
    const prepared = await prepare();
    const first = prepared.targets.find((target) => target.targetText === "<50>")!;
    const selected = await draft(first.bindingId);
    const submitted = await submit(prepared, selected.id);
    expect(submitted.response.status).toBe(201);
    const item = submitted.response.body.item;
    await db.query("delete from user_role_bindings where user_id=$1 and project_id=$2", [REVIEWER, PROJECT]);
    const beforeLostRole = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    expect((await requestJson(route(reviewer), `${path(item.id)}/review`, {
      method: "POST", body: JSON.stringify(approval(item)) })).status).toBe(403);
    const afterLostRole = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    expect(afterLostRole.audits).toHaveLength(beforeLostRole.audits.length + 1);
    expect(afterLostRole.audits.filter((event) =>
      !beforeLostRole.audits.some((old) => old.id === event.id))).toEqual([
      expect.objectContaining({ action: "deny", target: item.id })
    ]);
    expect({ ...afterLostRole, audits: beforeLostRole.audits }).toEqual(beforeLostRole);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('c906-mix-reviewer-restored',$1,$2,$3,'software-committer')",
      [REVIEWER, ORG, PROJECT]);
    const newer = await prepare(BASE.replace("<10>", "<11>").replace("<20>", "<61>"),
      "c906-mixed-http-dts-newer-prepare");
    const successor = await requestJson<{ item: { id: string; batchProofDigest: string;
      draftImpactDigest: string } }>(route(),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
        method: "POST", body: JSON.stringify({ candidateId: newer.candidateId,
          expectedProofToken: newer.proofToken, assignedToUserId: REVIEWER,
          reason: "Advance the canonical source", targetDecisions: newer.targets.map((target) => ({
            bindingId: target.bindingId, choice: "file"
          })) })
      });
    expect(successor.status, JSON.stringify(successor.body)).toBe(201);
    const advanced = await requestJson(route(reviewer), `${path(successor.body.item.id)}/review`, {
      method: "POST", body: JSON.stringify({ decision: "approve",
        batchProofDigest: successor.body.item.batchProofDigest,
        draftImpactDigest: successor.body.item.draftImpactDigest })
    });
    expect(advanced.status, JSON.stringify(advanced.body)).toBe(200);
    const beforeDrift = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const objectBeforeDrift = await objects(directory);
    expect((await requestJson(route(reviewer), `${path(item.id)}/review`, {
      method: "POST", body: JSON.stringify(approval(item)) })).status).toBe(409);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT })).toEqual(beforeDrift);
    expect(await objects(directory)).toEqual(objectBeforeDrift);
  }, 120_000);

  it("rejects and withdraws one mixed request without applying its source", async () => {
    const prepared = await prepare();
    const first = prepared.targets.find((target) => target.targetText === "<50>")!;
    const selected = await draft(first.bindingId);
    const rejected = await submit(prepared, selected.id, "c906-mixed-http-dts-reject");
    expect(rejected.response.status).toBe(201);
    const beforeReject = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const result = await requestJson(route(reviewer), `${path(rejected.response.body.item.id)}/review`, {
      method: "POST", body: JSON.stringify({ ...approval(rejected.response.body.item), decision: "reject" })
    });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toMatchObject({ item: { status: "rejected" } });
    const afterReject = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    expect(afterReject.values).toEqual(beforeReject.values);
    expect(afterReject.pins).toEqual(beforeReject.pins);
    expect(afterReject.history).toEqual(beforeReject.history);
    expect(afterReject.versions).toEqual(beforeReject.versions);
    const withdrawn = await submit(prepared, selected.id, "c906-mixed-http-dts-withdraw");
    expect(withdrawn.response.status, JSON.stringify(withdrawn.response.body)).toBe(201);
    const beforeWithdraw = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    const withdrawal = await requestJson(route(), `${path(withdrawn.response.body.item.id)}/withdraw`, {
      method: "POST"
    });
    expect(withdrawal.status, JSON.stringify(withdrawal.body)).toBe(200);
    expect(withdrawal.body).toMatchObject({ item: { status: "withdrawn" } });
    const afterWithdraw = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: PROJECT });
    expect(afterWithdraw.values).toEqual(beforeWithdraw.values);
    expect(afterWithdraw.pins).toEqual(beforeWithdraw.pins);
    expect(afterWithdraw.history).toEqual(beforeWithdraw.history);
    expect(afterWithdraw.versions).toEqual(beforeWithdraw.versions);
  }, 120_000);
});
