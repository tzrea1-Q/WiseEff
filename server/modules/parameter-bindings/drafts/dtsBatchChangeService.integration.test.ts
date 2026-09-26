import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { createRouter } from "../../../shared/http/router";
import { createHttpServer } from "../../../shared/http/server";
import { requestJson } from "../../../test/testClient";
import { catalogBatchValueChangeRequestResponseSchema, catalogValueChangeSourceDiffResponseSchema } from "../../contracts/dtoSchemas/parameterCatalog";
import { installDriverSourceFixture } from "../../../testing/parameterCatalog/driverSource";
import { createLocalObjectStore } from "../../logs/objectStore";
import { createTrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { parseDtsValue } from "../../dts";
import { ingestConfigRevision } from "../../parameter-topology/ingestService";
import { asValueClient, loadPublishedCatalog, listCatalogBindingRowsForProject, syncPublishedCatalogProjectValuesInTransaction } from "../catalogProjectValueSync";
import { loadLegacyBindingIdentity } from "../binding/migrationAdapter";
import { createConfigSet, addConfigSetFile } from "../../parameter-files/configSetService";
import { createCandidate } from "../../parameter-files/candidateService";
import { previewCanonicalCandidate } from "../../parameter-files/canonicalFileWorkflow";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { registerCatalogProjectValueConsumerRoutes } from "../catalogProjectValueRoutes";
import { createCanonicalValueDraft } from "./service";
import type { ConfigRevisionManifest } from "../../parameter-topology/types";

const ORG = "org-906-c-dts-batch";
const PROJECT = "project-906-c-dts-batch";
const ADMIN = "user-906-c-dts-admin";
const REVIEWER = "user-906-c-dts-reviewer";
const OTHER_REVIEWER = "user-906-c-dts-other-reviewer";
const source = `/dts-v1/;\n/ {\n  charger: device@0 { compatible = "acme,power"; iin_max = <36>; };\n  backup: device@1 { compatible = "acme,power"; iin_max = <36>; };\n  spare: device@2 { compatible = "acme,power"; iin_max = <36>; };\n};\n`;
const admin = makeTestAuthContext({ userId: ADMIN, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });
const reviewer = makeTestAuthContext({ userId: REVIEWER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: PROJECT }] });
const otherReviewer = makeTestAuthContext({ userId: OTHER_REVIEWER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: PROJECT }] });

describe("#906 C canonical DTS batch HTTP review", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let storageDirectory: string;
  let fileId: string;
  let bindingIds: string[];

  beforeEach(async () => {
    lane = await createEphemeralTestDatabase("issue906-c-dts-batch");
    db = createPostgresDatabase(lane.url);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-906-c-dts-batch-"));
    storage = createLocalObjectStore(storageDirectory);
    await db.query("insert into organizations(id,name) values ($1,'#906 C DTS batch')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true),($4,$2,'other reviewer','Reviewer',true)", [ADMIN, ORG, REVIEWER, OTHER_REVIEWER]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'DTS batch','C906D','initialized')", [PROJECT, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('role-906-c-dts-admin',$1,$2,null,'admin'),('role-906-c-dts-reviewer',$3,$2,$4,'software-committer')", [ADMIN, ORG, REVIEWER, PROJECT]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('role-906-c-dts-other-reviewer',$1,$2,$3,'software-committer')", [OTHER_REVIEWER, ORG, PROJECT]);
    await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power",
      businessName: "#906 C DTS batch", driverName: "Acme power", idempotencyKey: "906-c-dts-batch-fixture", reason: "Issue 906 C DTS batch" });
    const set = await createConfigSet(db, admin, { projectId: PROJECT, name: "DTS batch" });
    const uploaded = await uploadProjectParameterFile(db, storage, admin, { projectId: PROJECT, fileName: "board.dts", bytes: Buffer.from(source) });
    fileId = uploaded.file.id;
    await addConfigSetFile(db, admin, { configSetId: set.id, fileId, role: "base", sortOrder: 0 });
    const manifest: ConfigRevisionManifest = { organizationId: ORG, projectId: PROJECT, configSetId: set.id,
      entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [],
      members: [{ fileId, fileVersionId: uploaded.version.id, fileName: "board.dts", sourceName: "board.dts", role: "base", sortOrder: 0, content: source }] };
    const revision = await ingestConfigRevision(db, manifest, admin, { legacyProjection: "skip" });
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Published Catalog fixture is unavailable");
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog,
      { organizationId: ORG, projectId: PROJECT, configSetId: set.id, configRevisionId: revision.id }));
    const bindings = await listCatalogBindingRowsForProject(db, admin, { projectId: PROJECT });
    expect(bindings).toHaveLength(3);
    bindingIds = bindings.map((binding) => binding.id).sort();
    expect(await Promise.all(bindingIds.map((id) => loadLegacyBindingIdentity(getRootPostgresPool(db)!, id))))
      .toEqual([null, null, null]);
  }, 120_000);

  afterEach(async () => {
    await db?.close();
    await lane?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  function route(auth = admin) {
    const router = createRouter();
    registerCatalogProjectValueConsumerRoutes(router, { db, objectStore: storage, getCurrentAuthContext: () => auth });
    return createHttpServer(router);
  }

  async function stage(bytes: Buffer, assignedToUserId = REVIEWER) {
    const candidate = await createCandidate(db, storage, admin, { projectId: PROJECT, fileId, fileName: "board.dts", bytes });
    const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: PROJECT, candidateId: candidate.id });
    const body = { candidateId: candidate.id, expectedProofToken: preview.proofToken,
      reason: "Review exact DTS batch", assignedToUserId };
    const submitted = await requestJson<{ item: { id: string; batchProofDigest: string;
      targets: Array<{ action: "set" | "delete"; targetText: string | null }> } }>(route(),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`,
      { method: "POST", body: JSON.stringify(body) });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    return { candidate, preview, body, request: submitted.body.item,
      path: `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.id}` };
  }

  const twoSets = (text: string) => Buffer.from(source.replace("iin_max = <36>", `iin_max = ${text}`)
    .replace("iin_max = <36>", `iin_max = ${text}`));

  async function state(requestId: string) {
    const file = (await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId])).rows[0]!.current_version_id;
    const versions = (await db.query<{ id: string }>(
      "select id from project_parameter_file_versions where file_id=$1 order by id", [fileId])).rows;
    const tips = (await db.query<{ id: string; current_value_id: string }>(`
      select id,current_value_id from parameter_catalog.project_parameter_bindings
       where organization_id=$1 and project_id=$2 order by id`, [ORG, PROJECT])).rows;
    const values = (await db.query<{ id: string }>(`
      select value.id from parameter_catalog.project_parameter_values value
      join parameter_catalog.project_parameter_bindings binding on binding.id=value.binding_id
       where binding.organization_id=$1 and binding.project_id=$2 order by value.id`, [ORG, PROJECT])).rows;
    const pins = (await db.query<{ id: string }>(`
      select id from parameter_catalog.project_value_source_pins
       where organization_id=$1 and project_id=$2 order by id`, [ORG, PROJECT])).rows;
    const history = (await db.query<{ id: string }>(`
      select history.id from parameter_catalog.binding_history_events history
      join parameter_catalog.project_parameter_bindings binding on binding.id=history.binding_id
       where binding.organization_id=$1 and binding.project_id=$2 order by history.id`, [ORG, PROJECT])).rows;
    const appliedAudits = (await db.query<{ id: string }>(`
      select id from audit_events where organization_id=$1 and project_id=$2
        and action='value-change-applied' order by id`, [ORG, PROJECT])).rows;
    const request = (await db.query<{ status: string }>(`
      select status from project_parameter_value_change_requests where id=$1`, [requestId])).rows[0]!.status;
    const targets = (await db.query<{ ordinal: number; applied_value_id: string | null }>(`
      select ordinal,applied_value_id from project_parameter_value_change_targets
       where request_id=$1 order by ordinal`, [requestId])).rows;
    return { file, versions, tips, values, pins, history, appliedAudits, request, targets };
  }

  const review = (path: string, digest: string, decision: "approve" | "reject" = "approve", auth = reviewer) =>
    requestJson<{ item: { status: string } }>(route(auth), `${path}/review`, {
      method: "POST", body: JSON.stringify({ decision, batchProofDigest: digest })
    });

  it("submits two canonical-only DTS Binding targets as one HTTP request", async () => {
    const bytes = Buffer.from(source.replace("iin_max = <36>", "iin_max = <77>").replace("iin_max = <36>", "iin_max = <77>"));
    const candidate = await createCandidate(db, storage, admin, { projectId: PROJECT, fileId, fileName: "board.dts", bytes });
    const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: PROJECT, candidateId: candidate.id });
    expect(preview).toMatchObject({ kind: "canonical", format: "dts" });
    const collection = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`;
    const submitBody = { candidateId: candidate.id, expectedProofToken: preview.proofToken,
      reason: "Review exact DTS batch", assignedToUserId: reviewer.user.id };
    const submit = () => requestJson<{ item: { id: string; batchProofDigest: string } }>(route(), collection,
      { method: "POST", body: JSON.stringify(submitBody) });
    const submitted = await submit();
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    catalogBatchValueChangeRequestResponseSchema.parse(submitted.body);
    expect((await submit()).body.item.id).toBe(submitted.body.item.id);
    const queue = await requestJson<{ items: Array<{ id: string }> }>(route(reviewer), `${collection}?status=pending`);
    expect(queue.status).toBe(200);
    expect(queue.body.items.map((item) => item.id)).toContain(submitted.body.item.id);
    const detailPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.id}`;
    const detail = await requestJson<{ item: { id: string; targets: Array<{ ordinal: number }> } }>(route(reviewer), `${detailPath}/batch`);
    expect(detail.status).toBe(200);
    expect(detail.body.item.targets.map((target) => target.ordinal)).toEqual([0, 1]);
    const diff = await requestJson<{ item: { format: string; batchProofDigest: string;
      targets: Array<{ ordinal: number; afterText?: string }> } }>(route(reviewer), `${detailPath}/source-diff`);
    expect(diff.status, JSON.stringify(diff.body)).toBe(200);
    catalogValueChangeSourceDiffResponseSchema.parse(diff.body);
    expect(diff.body.item.format).toBe("dts");
    expect(diff.body.item.batchProofDigest).toBe(submitted.body.item.batchProofDigest);
    expect(diff.body.item.targets.map((target) => [target.ordinal, target.afterText])).toEqual([[0, "<77>"], [1, "<77>"]]);
    const beforeVersion = (await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId])).rows[0]!.current_version_id;
    const approve = () => requestJson<{ item: { status: string; targets: Array<{ appliedValueId: string }> } }>(
      route(reviewer), `${detailPath}/review`, { method: "POST", body: JSON.stringify({
        decision: "approve", batchProofDigest: submitted.body.item.batchProofDigest
      }) });
    const approved = await approve();
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.item.status).toBe("approved");
    expect((await approve()).body).toEqual(approved.body);
    const applied = await db.query<{
      ordinal: number; target_value: unknown; target_text: string | null;
      applied_value_id: string; current_value_id: string; applied_history_event_id: string;
      history_request_id: string; applied_source_pin_id: string; pin_value_id: string;
      applied_file_version_id: string; pin_file_version_id: string; current_version_id: string;
      value_config_revision_id: string; pin_config_revision_id: string;
    }>(`select target.ordinal,target.target_value,target.target_text,target.applied_value_id,
              binding.current_value_id,target.applied_history_event_id,
              history.applied_request_id as history_request_id,target.applied_source_pin_id,
              pin.project_value_id as pin_value_id,target.applied_file_version_id,
              pin.file_version_id as pin_file_version_id,file.current_version_id,
              value.config_revision_id as value_config_revision_id,
              pin.config_revision_id as pin_config_revision_id
         from project_parameter_value_change_targets target
         join parameter_catalog.project_parameter_bindings binding on binding.id=target.binding_id
         join parameter_catalog.project_parameter_values value on value.id=target.applied_value_id
         join parameter_catalog.project_value_source_pins pin on pin.id=target.applied_source_pin_id
         join parameter_catalog.binding_history_events history on history.id=target.applied_history_event_id
         join project_parameter_files file on file.id=$2
        where target.request_id=$1 order by target.ordinal`, [submitted.body.item.id, fileId]);
    expect(applied.rows).toHaveLength(2);
    expect(applied.rows.map((target) => [target.ordinal, target.target_text, target.target_value]))
      .toEqual([[0, "<77>", parseDtsValue("iin_max", "<77>").value],
        [1, "<77>", parseDtsValue("iin_max", "<77>").value]]);
    expect(applied.rows.every((target) => target.applied_value_id === target.current_value_id
      && target.applied_value_id === target.pin_value_id
      && target.history_request_id === submitted.body.item.id
      && target.applied_file_version_id === target.pin_file_version_id
      && target.applied_file_version_id === target.current_version_id
      && target.value_config_revision_id === target.pin_config_revision_id)).toBe(true);
    expect(applied.rows[0]!.current_version_id).not.toBe(beforeVersion);
    expect(await Promise.all(bindingIds.map((id) => loadLegacyBindingIdentity(getRootPostgresPool(db)!, id))))
      .toEqual([null, null, null]);
  }, 120_000);

  it("freezes a DTS set and delete with exact target text, then applies one tombstone transaction", async () => {
    const bytes = Buffer.from(source.replace("iin_max = <36>", "iin_max = <77>")
      .replace("iin_max = <36>;", "/delete-property/ iin_max;"));
    const staged = await stage(bytes);
    expect(staged.request.targets.map((target) => [target.action, target.targetText]).sort())
      .toEqual([["delete", null], ["set", "<77>"]]);
    const stored = await db.query<{ action: string; target_value: unknown; target_text: string | null }>(`
      select action,target_value,target_text from project_parameter_value_change_targets
      where request_id=$1 order by ordinal`, [staged.request.id]);
    expect(stored.rows.sort((left, right) => left.action.localeCompare(right.action))).toEqual([
      { action: "delete", target_value: "", target_text: null },
      { action: "set", target_value: parseDtsValue("iin_max", "<77>").value, target_text: "<77>" }
    ]);
    const diff = await requestJson<{ item: { targets: Array<{ action: string; afterText?: string }> } }>(
      route(reviewer), `${staged.path}/source-diff`);
    expect(diff.status, JSON.stringify(diff.body)).toBe(200);
    expect(diff.body.item.targets.map((target) => [target.action, target.afterText]).sort())
      .toEqual([["delete", undefined], ["set", "<77>"]]);
    const review = await requestJson<{ item: { status: string } }>(route(reviewer), `${staged.path}/review`, {
      method: "POST", body: JSON.stringify({ decision: "approve", batchProofDigest: staged.request.batchProofDigest })
    });
    expect(review.status, JSON.stringify(review.body)).toBe(200);
    expect(review.body.item.status).toBe("approved");
    const results = await db.query<{ action: string; value_state: string; pin_state: string;
      delete_request_id: string | null; base_source_pin_id: string | null; source_pin_id: string;
      file_version_id: string; current_version_id: string }>(`
      select target.action,value.value_state,pin.value_state as pin_state,
             pin.delete_request_id,pin.base_source_pin_id,target.source_pin_id,
             pin.file_version_id,file.current_version_id
        from project_parameter_value_change_targets target
        join parameter_catalog.project_parameter_values value on value.id=target.applied_value_id
        join parameter_catalog.project_value_source_pins pin on pin.id=target.applied_source_pin_id
        join project_parameter_files file on file.id=$2
       where target.request_id=$1 order by target.ordinal`, [staged.request.id, fileId]);
    expect(results.rows).toHaveLength(2);
    expect(results.rows.map((row) => [row.action, row.value_state, row.pin_state]).sort())
      .toEqual([["delete", "deleted", "deleted"], ["set", "present", "present"]]);
    const tombstone = results.rows.find((row) => row.action === "delete")!;
    expect(tombstone.delete_request_id).toBe(staged.request.id);
    expect(tombstone.base_source_pin_id).toBe(tombstone.source_pin_id);
    expect(results.rows.every((row) => row.file_version_id === row.current_version_id)).toBe(true);
  }, 120_000);

  it("hides nonassigned and foreign requests, rejects bad proof, and rejects once without source writes", async () => {
    const staged = await stage(twoSets("<88>"));
    const before = await state(staged.request.id);
    const foreign = makeTestAuthContext({ userId: REVIEWER, organizationId: "org-906-c-dts-foreign",
      permissions: ["parameter:view", "parameter:edit", "parameter:review"],
      roles: [{ roleId: "software-committer", projectId: PROJECT }] });
    for (const auth of [otherReviewer, foreign]) {
      expect((await requestJson(route(auth), `${staged.path}/batch`)).status).toBe(404);
      expect((await requestJson(route(auth), `${staged.path}/source-diff`)).status).toBe(404);
      expect((await review(staged.path, staged.request.batchProofDigest, "approve", auth)).status).toBe(404);
    }
    const denied = await db.query<{ count: number }>(`
      select count(*)::int as count from audit_events where organization_id=$1 and project_id=$2
        and target_id=$3 and kind='parameter-source-permission-denied'`, [ORG, PROJECT, staged.request.id]);
    expect(denied.rows[0]!.count).toBeGreaterThan(0);
    expect((await review(staged.path, "0".repeat(64))).status).toBe(409);
    expect(await state(staged.request.id)).toEqual(before);
    const rejected = await review(staged.path, staged.request.batchProofDigest, "reject");
    expect(rejected.status).toBe(200);
    expect(rejected.body.item.status).toBe("rejected");
    expect((await review(staged.path, staged.request.batchProofDigest, "reject")).body).toEqual(rejected.body);
    expect((await review(staged.path, staged.request.batchProofDigest)).status).toBe(409);
    expect(await state(staged.request.id)).toEqual({ ...before, request: "rejected" });
  }, 120_000);

  it("blocks a revoked assignee, lets the submitter withdraw, and resubmits for another reviewer", async () => {
    const staged = await stage(twoSets("<89>"));
    const before = await state(staged.request.id);
    await db.query("delete from user_role_bindings where id='role-906-c-dts-reviewer'");
    expect((await requestJson(route(reviewer), `${staged.path}/batch`)).status).toBe(403);
    expect((await requestJson(route(reviewer), `${staged.path}/source-diff`)).status).toBe(403);
    expect((await review(staged.path, staged.request.batchProofDigest, "reject")).status).toBe(403);
    expect(await state(staged.request.id)).toEqual(before);
    const withdraw = () => requestJson<{ item: { id: string; status: string } }>(route(), `${staged.path}/withdraw`,
      { method: "POST" });
    const withdrawn = await withdraw();
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.item.status).toBe("withdrawn");
    expect((await withdraw()).body).toEqual(withdrawn.body);
    expect(await state(staged.request.id)).toEqual({ ...before, request: "withdrawn" });
    const next = await requestJson<{ item: { id: string; batchProofDigest: string } }>(route(),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
        method: "POST", body: JSON.stringify({ ...staged.body, assignedToUserId: OTHER_REVIEWER })
      });
    expect(next.status, JSON.stringify(next.body)).toBe(201);
    expect(next.body.item.id).not.toBe(staged.request.id);
    expect((await review(`/api/v2/projects/${PROJECT}/parameter-value-change-requests/${next.body.item.id}`,
      next.body.item.batchProofDigest, "reject", otherReviewer)).status).toBe(200);
  }, 120_000);

  it("refuses a frozen DTS request after another whole batch advances its source", async () => {
    const older = await stage(twoSets("<80>"));
    const newer = await stage(twoSets("<90>"));
    expect(older.request.batchProofDigest).not.toBe(newer.request.batchProofDigest);
    expect((await review(newer.path, newer.request.batchProofDigest)).status).toBe(200);
    const before = await state(older.request.id);
    expect((await review(older.path, older.request.batchProofDigest)).status).toBe(409);
    expect((await review(older.path, older.request.batchProofDigest)).status).toBe(409);
    expect(await state(older.request.id)).toEqual(before);
  }, 120_000);

  it("rolls back a second DTS source-pin failure and retries the same frozen request", async () => {
    const staged = await stage(twoSets("<91>"));
    const before = await state(staged.request.id);
    const pool = getRootPostgresPool(db)!;
    const originalConnect = pool.connect.bind(pool);
    let pinInserts = 0;
    const wrapClient = (client: object) => new Proxy(client, { get(target, property) {
      if (property === "query") return (...args: unknown[]) => {
        if (typeof args[0] === "string"
          && args[0].includes("insert into parameter_catalog.project_value_source_pins") && ++pinInserts === 2) {
          throw new Error("injected second DTS pin write failure");
        }
        return Reflect.apply(Reflect.get(target, property), target, args);
      };
      if (property === "release") return Reflect.get(target, property).bind(target);
      return Reflect.get(target, property);
    } });
    pool.connect = ((callback?: unknown) => {
      if (typeof callback === "function") return Reflect.apply(originalConnect, pool, [
        (error: unknown, client: object | undefined, release: unknown) =>
          Reflect.apply(callback, undefined, [error, client ? wrapClient(client) : client, release])
      ]);
      return originalConnect().then(wrapClient);
    }) as typeof pool.connect;
    try {
      expect((await review(staged.path, staged.request.batchProofDigest)).status).toBe(500);
    } finally {
      pool.connect = originalConnect;
    }
    expect(pinInserts).toBe(2);
    expect(await state(staged.request.id)).toEqual(before);
    const retried = await review(staged.path, staged.request.batchProofDigest);
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body.item.status).toBe("approved");
  }, 120_000);

  it("rejects a selected DTS draft from a different candidate without inventing a request", async () => {
    const pin = (await db.query<{ config_revision_id: string; project_value_id: string }>(`
      select config_revision_id,project_value_id from parameter_catalog.project_value_source_pins
       where binding_id=$1 order by id limit 1`, [bindingIds[0]])).rows[0]!;
    const draft = await createCanonicalValueDraft(db, admin, {
      projectId: PROJECT, bindingId: bindingIds[0]!,
      targetValue: parseDtsValue("iin_max", "<92>").value,
      reason: "Own DTS draft with a different candidate", baseRevisionId: pin.config_revision_id,
      baseCurrentValueId: pin.project_value_id
    }, { objectStore: storage, invocation: createUserInvocation(admin), requestId: "c906-dts-draft",
      refusalSink: createTrustedRefusalAuditSink(db) });
    const candidate = await createCandidate(db, storage, admin, {
      projectId: PROJECT, fileId, fileName: "board.dts", bytes: twoSets("<92>")
    });
    const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: PROJECT, candidateId: candidate.id });
    const submitted = await requestJson(route(),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
        method: "POST", body: JSON.stringify({ candidateId: candidate.id,
          expectedProofToken: preview.proofToken, reason: "Review exact DTS batch",
          assignedToUserId: REVIEWER, selectedDrafts: [{ bindingId: bindingIds[0], draftId: draft.id }] })
      });
    expect(submitted.status).toBe(409);
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from project_parameter_value_change_requests
       where candidate_id=$1`, [candidate.id])).rows[0]!.count).toBe(0);
    expect((await db.query<{ id: string }>(`
      select id from project_parameter_value_drafts where id=$1`, [draft.id])).rows[0]!.id).toBe(draft.id);
  }, 120_000);
});
