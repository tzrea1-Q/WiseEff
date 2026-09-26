import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { makeTestAuthContext } from "../../../testing/authContext";
import { installConfigurationSourceFixture } from "../../../testing/parameterCatalog/configurationSource";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { createRouter } from "../../../shared/http/router";
import { createHttpServer } from "../../../shared/http/server";
import { requestJson } from "../../../test/testClient";
import { catalogBatchValueChangeRequestListResponseSchema, catalogBatchValueChangeRequestResponseSchema, catalogValueChangeReviewResponseSchema, catalogValueChangeSourceDiffResponseSchema } from "../../contracts/dtoSchemas/parameterCatalog";
import { createLocalObjectStore } from "../../logs/objectStore";
import { createTrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { createConfigSet, addConfigSetFile } from "../../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { createCandidate } from "../../parameter-files/candidateService";
import { freezeCanonicalCandidateBatchSnapshotInTransaction, previewCanonicalCandidate } from "../../parameter-files/canonicalFileWorkflow";
import { registerCanonicalJsonSource } from "../../parameter-files/canonicalJsonSource";
import { loadPublishedCatalog } from "../catalogProjectValueSync";
import { registerCatalogProjectValueConsumerRoutes } from "../catalogProjectValueRoutes";
import { createCanonicalValueDraft, listCanonicalValueDraftsForReviewer } from "./service";
import { reviewCanonicalValueChange } from "./changeService";
import { approveCanonicalBatchValueChange, getCanonicalBatchValueChangeForReviewer, submitCanonicalBatchValueChange } from "./batchChangeService";

const ORG = "org-906-c-batch";
const PROJECT = "project-906-c-batch";
const ADMIN = "user-906-c-admin";
const REVIEWER = "user-906-c-reviewer";
const OTHER_REVIEWER = "user-906-c-other-reviewer";
const EDITOR = "user-906-c-editor";
const admin = makeTestAuthContext({
  userId: ADMIN, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }]
});
const reviewer = makeTestAuthContext({
  userId: REVIEWER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: PROJECT }]
});
const otherReviewer = makeTestAuthContext({
  userId: OTHER_REVIEWER, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: PROJECT }]
});
const editor = makeTestAuthContext({
  userId: EDITOR, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit"],
  roles: [{ roleId: "software-user", projectId: PROJECT }]
});

describe("#906 C frozen multi-target request", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let storageDirectory: string;
  let fileId: string;
  let versionId: string;
  let bindings: Array<{ id: string; currentValueId: string }>;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("c906batch");
    db = createPostgresDatabase(database.url);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-c906-batch-"));
    storage = createLocalObjectStore(storageDirectory);
    await db.query("insert into organizations(id,name) values ($1,'C batch')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true),($4,$2,'editor','Editor',true),($5,$2,'other reviewer','Reviewer',true)", [ADMIN, ORG, REVIEWER, EDITOR, OTHER_REVIEWER]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'C batch','C906','initialized')", [PROJECT, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('c906-admin',$1,$2,null,'admin'),('c906-reviewer',$3,$2,$4,'software-committer'),('c906-editor',$5,$2,$4,'software-user')", [ADMIN, ORG, REVIEWER, PROJECT, EDITOR]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('c906-other-reviewer',$1,$2,$3,'software-committer')", [OTHER_REVIEWER, ORG, PROJECT]);
    await installConfigurationSourceFixture(db, admin, { subjectId: "csub_906_c_batch", schemaId: "wiseeff.906.c.batch" });
    const set = await createConfigSet(db, admin, { projectId: PROJECT, name: "C batch" });
    const uploaded = await uploadProjectParameterFile(db, storage, admin, {
      projectId: PROJECT, fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 36.5 }, "other": { "limit": 48 } }\n')
    });
    fileId = uploaded.file.id;
    versionId = uploaded.version.id;
    await addConfigSetFile(db, admin, { configSetId: set.id, fileId, role: "base", sortOrder: 0 });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    const first = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
      projectId: PROJECT, configSetId: set.id, fileId, fileVersionId: versionId,
      configurationSchemaId: "wiseeff.906.c.batch", rootPointer: "",
      mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/settings/limit" }],
      invocation: createUserInvocation(admin), requestId: "c906-register-first",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    const second = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
      projectId: PROJECT, configSetId: set.id, fileId, fileVersionId: versionId,
      configurationSchemaId: "wiseeff.906.c.batch", rootPointer: "/other",
      mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/other/limit" }],
      invocation: createUserInvocation(admin), requestId: "c906-register-second",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    bindings = [first.bindings[0]!, second.bindings[0]!].map((binding) => ({
      id: binding.id, currentValueId: binding.currentValueId
    }));
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  it("fails closed for a stale proof, then freezes one request over two real Bindings", async () => {
    const pin = (await db.query<{ config_revision_id: string }>(`
      select config_revision_id from parameter_catalog.project_value_source_pins
       where binding_id=$1 and project_value_id=$2`,
      [bindings[0]!.id, bindings[0]!.currentValueId])).rows[0]!;
    const olderDraft = await createCanonicalValueDraft(db, editor, {
      projectId: PROJECT, bindingId: bindings[0]!.id,
      sourceTarget: { format: "json", sourceText: "99" }, reason: "other author baseline",
      baseRevisionId: pin.config_revision_id, baseCurrentValueId: bindings[0]!.currentValueId
    }, {
      objectStore: storage, invocation: createUserInvocation(editor),
      requestId: "c906-other-draft", refusalSink: createTrustedRefusalAuditSink(db)
    });
    const candidate = await createCandidate(db, storage, admin, {
      projectId: PROJECT, fileId, fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 50 }, "other": { "limit": 60 } }\n')
    });
    const preview = await previewCanonicalCandidate(db, storage, admin, {
      projectId: PROJECT, candidateId: candidate.id
    });
    expect(preview).toMatchObject({ canSubmit: false, reason: "canonical-batch-writer-unavailable" });
    let expectedProofToken = "stale-proof";
    const submit = () => submitCanonicalBatchValueChange(db, storage, admin, {
      projectId: PROJECT, candidateId: candidate.id,
      expectedProofToken, reason: "one human review for both targets",
      assignedToUserId: REVIEWER,
      targetDecisions: bindings.map((binding) => ({ bindingId: binding.id, choice: "file" as const })),
      invocation: createUserInvocation(admin),
      requestId: "c906-submit", refusalSink: createTrustedRefusalAuditSink(db)
    });
    await expect(submit()).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await db.query(`select count(*)::int as count from public.project_parameter_value_change_requests
      where organization_id=$1 and project_id=$2`, [ORG, PROJECT])).rows[0]!.count).toBe(0);
    const proof = await db.transaction((tx) => freezeCanonicalCandidateBatchSnapshotInTransaction(tx, storage, admin, {
      projectId: PROJECT, candidateId: candidate.id, expectedProofToken: preview.proofToken!
    }));
    expectedProofToken = proof.proofToken;
    const frozen = await submit();
    expect(frozen).toMatchObject({
      status: "pending", candidateId: candidate.id,
      batchProofDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      targets: [
        expect.objectContaining({ ordinal: 0, action: "set" }),
        expect.objectContaining({ ordinal: 1, action: "set" })
      ]
    });
    expect(new Set(frozen.targets.map((target) => target.bindingId))).toEqual(new Set(bindings.map((binding) => binding.id)));
    expect((await db.query(`select binding_id from public.project_parameter_value_change_requests where id=$1`, [frozen.id])).rows[0]!.binding_id).toBeNull();
    expect((await db.query(`select count(*)::int as count from public.project_parameter_value_change_targets where request_id=$1`, [frozen.id])).rows[0]!.count).toBe(2);
    const inboundTargetFks = await db.query<{ conname: string; confdeltype: string; condeferrable: boolean; condeferred: boolean }>(
      `select conname, confdeltype, condeferrable, condeferred from pg_constraint
        where conname in ('binding_history_event_applied_target_fk', 'project_value_source_pin_delete_target_fk')`
    );
    expect(inboundTargetFks.rows).toHaveLength(2);
    expect(inboundTargetFks.rows.every((fk) => fk.confdeltype === "a" && fk.condeferrable && fk.condeferred)).toBe(true);
    expect((await db.query(`select current_version_id from project_parameter_files where id=$1`, [fileId])).rows[0]!.current_version_id).toBe(versionId);
    for (const binding of bindings) {
      expect((await db.query(`select current_value_id from parameter_catalog.project_parameter_bindings where id=$1`, [binding.id])).rows[0]!.current_value_id).toBe(binding.currentValueId);
    }
    const allDrafts = await listCanonicalValueDraftsForReviewer(db, reviewer, {
      projectId: PROJECT, bindingId: bindings[0]!.id
    });
    expect(allDrafts).toEqual(expect.arrayContaining([expect.objectContaining({ draftId: olderDraft.id, stale: false })]));
    const read = await getCanonicalBatchValueChangeForReviewer(db, reviewer, { projectId: PROJECT, requestId: frozen.id });
    expect(read).toEqual(frozen);
    expect(await getCanonicalBatchValueChangeForReviewer(db, editor, { projectId: PROJECT, requestId: frozen.id }))
      .toBeNull();
    expect((await submit()).id).toBe(frozen.id);
    await expect(reviewCanonicalValueChange(db, reviewer, {
      projectId: PROJECT, requestId: frozen.id, decision: "approve"
    }, {
      objectStore: storage, snapshot: (await loadPublishedCatalog(getRootPostgresPool(db)!))!,
      invocation: createUserInvocation(reviewer), traceId: "c906-batch-review",
      refusalSink: createTrustedRefusalAuditSink(db)
    })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "canonical-batch-source-commit-unavailable" } });
    expect((await db.query(`select status from public.project_parameter_value_change_requests where id=$1`, [frozen.id])).rows[0]!.status).toBe("pending");

    await expect(db.query(`update public.project_parameter_value_change_targets
       set source_pin_id=$2 where request_id=$1 and ordinal=0`, [frozen.id, frozen.targets[1]!.sourcePinId]))
      .rejects.toMatchObject({ code: "55000" });
    for (const [field, id] of [["batch_target_count", "pvcr_906_bad_count"],
      ["batch_proof_digest", "pvcr_906_bad_proof"]] as const) {
      await expect(db.query(`insert into public.project_parameter_value_change_requests
        select (jsonb_populate_record(null::public.project_parameter_value_change_requests,
          to_jsonb(request) || jsonb_build_object('id', $2::text, 'status', 'rejected', $3::text, null))).*
          from public.project_parameter_value_change_requests request where request.id=$1`,
      [frozen.id, id, field])).rejects.toMatchObject({
        code: "23514", constraint: "project_parameter_value_change_requests_kind_ck"
      });
    }
    for (const [field, id] of [["batch_draft_impact", "pvcr_906_bad_impact"],
      ["batch_draft_impact_digest", "pvcr_906_bad_impact_digest"]] as const) {
      await expect(db.query(`insert into public.project_parameter_value_change_requests
        select (jsonb_populate_record(null::public.project_parameter_value_change_requests,
          to_jsonb(request) || jsonb_build_object('id', $2::text, 'status', 'rejected', $3::text, null))).*
          from public.project_parameter_value_change_requests request where request.id=$1`,
      [frozen.id, id, field])).rejects.toMatchObject({
        code: "23514", constraint: "project_parameter_value_change_requests_draft_impact_ck"
      });
    }

    await expect(db.query(`delete from public.project_parameter_value_change_targets where request_id=$1`, [frozen.id]))
      .rejects.toMatchObject({ code: "55000" });
    await db.transaction(async (tx) => {
      const targetIds = (await tx.query<{ id: string }>(
        `select id from public.project_parameter_value_change_targets where request_id=$1`, [frozen.id]
      )).rows.map((row) => row.id);
      const removedTargets = await tx.query<{ removed: number }>(
        `select parameter_catalog.dispose_plane_residue($1, $2, 'id', $3::text[]) as removed`,
        ["c906-test-archive", "public.project_parameter_value_change_targets", targetIds]
      );
      expect(removedTargets.rows[0]?.removed).toBe(2);
      const removedRequest = await tx.query<{ removed: number }>(
        `select parameter_catalog.dispose_plane_residue($1, $2, 'id', $3::text[]) as removed`,
        ["c906-test-archive", "public.project_parameter_value_change_requests", [frozen.id]]
      );
      expect(removedRequest.rows[0]?.removed).toBe(1);
    });
  }, 120_000);

  it("approves a real frozen two-target request once and replays the same proof", async () => {
    const candidate = await createCandidate(db, storage, admin, {
      projectId: PROJECT, fileId, fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 75 }, "other": { "limit": 85 } }\n')
    });
    const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: PROJECT, candidateId: candidate.id });
    const proof = await db.transaction((tx) => freezeCanonicalCandidateBatchSnapshotInTransaction(tx, storage, admin, {
      projectId: PROJECT, candidateId: candidate.id, expectedProofToken: preview.proofToken!
    }));
    const request = await submitCanonicalBatchValueChange(db, storage, admin, {
      projectId: PROJECT, candidateId: candidate.id, expectedProofToken: proof.proofToken,
      reason: "Approve both current source targets together", assignedToUserId: REVIEWER,
      targetDecisions: bindings.map((binding) => ({ bindingId: binding.id, choice: "file" as const })),
      invocation: createUserInvocation(admin), requestId: "c906-real-batch-submit",
      refusalSink: createTrustedRefusalAuditSink(db)
    });
    expect(request.targets).toHaveLength(2);
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Published Catalog fixture is unavailable");
    const approve = (auth = reviewer, batchProofDigest = proof.batchProofDigest) => db.transaction((tx) =>
      approveCanonicalBatchValueChange(tx, storage, auth, catalog, {
        projectId: PROJECT, requestId: request.id, batchProofDigest,
        draftImpactDigest: request.draftImpactDigest ?? undefined,
        invocation: createUserInvocation(auth), traceId: "c906-real-batch-review",
        refusalSink: createTrustedRefusalAuditSink(db)
      }));
    await expect(approve(reviewer, "0".repeat(64))).rejects.toMatchObject({
      code: "CONFLICT", details: { reason: "canonical-batch-proof-mismatch" }
    });
    await expect(approve(editor)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const foreign = makeTestAuthContext({
      userId: REVIEWER, organizationId: "org-906-foreign",
      permissions: ["parameter:view", "parameter:edit", "parameter:review"],
      roles: [{ roleId: "software-committer", projectId: PROJECT }]
    });
    await expect(approve(foreign)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId]
    )).rows[0]!.current_version_id).toBe(versionId);

    const applied = await approve();
    expect(applied).toMatchObject({
      id: request.id, status: "approved", batchProofDigest: proof.batchProofDigest,
      targets: [
        expect.objectContaining({ ordinal: 0, appliedValueId: expect.any(String), appliedHistoryEventId: expect.any(String) }),
        expect.objectContaining({ ordinal: 1, appliedValueId: expect.any(String), appliedHistoryEventId: expect.any(String) })
      ]
    });
    const activated = (await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId]
    )).rows[0]!.current_version_id;
    expect(activated).not.toBe(versionId);
    expect(await approve()).toEqual(applied);
    expect((await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId]
    )).rows[0]!.current_version_id).toBe(activated);
    for (const target of applied.targets) {
      expect((await db.query<{ current_value_id: string }>(
        "select current_value_id from parameter_catalog.project_parameter_bindings where id=$1", [target.bindingId]
      )).rows[0]!.current_value_id).toBe(target.appliedValueId);
    }
    const oldDrafts = await listCanonicalValueDraftsForReviewer(db, reviewer, {
      projectId: PROJECT, bindingId: bindings[0]!.id
    });
    expect(oldDrafts).toEqual(expect.arrayContaining([expect.objectContaining({ stale: true })]));
  }, 120_000);

  it("rejects an older frozen source after another complete batch advances the file", async () => {
    const router = createRouter();
    registerCatalogProjectValueConsumerRoutes(router, {
      db, objectStore: storage, getCurrentAuthContext: (request) => request.headers.authorization === "Bearer reviewer" ? reviewer : admin
    });
    const http = createHttpServer(router);
    const stage = async (bytes: string, traceId: string) => {
      const candidate = await createCandidate(db, storage, admin, {
        projectId: PROJECT, fileId, fileName: "settings.json", bytes: Buffer.from(bytes)
      });
      const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: PROJECT, candidateId: candidate.id });
      const submitted = await requestJson<{ item: { id: string; batchProofDigest: string } }>(http,
        `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
          method: "POST", body: JSON.stringify({ candidateId: candidate.id,
            expectedProofToken: preview.proofToken, reason: "Review an exact two-target source candidate",
            assignedToUserId: REVIEWER }), headers: { "x-request-id": traceId }
        });
      expect(submitted.status).toBe(201);
      return { request: submitted.body.item, proof: { batchProofDigest: submitted.body.item.batchProofDigest } };
    };
    const older = await stage('{ "settings": { "limit": 90 }, "other": { "limit": 95 } }\n', "c906-stale-older");
    const newer = await stage('{ "settings": { "limit": 100 }, "other": { "limit": 105 } }\n', "c906-stale-newer");
    expect(older.proof.batchProofDigest).not.toBe(newer.proof.batchProofDigest);
    const approve = (item: typeof older) => requestJson<{ item: { status: string } }>(http,
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${item.request.id}/review`, {
        method: "POST", headers: { authorization: "Bearer reviewer" },
        body: JSON.stringify({ decision: "approve", batchProofDigest: item.proof.batchProofDigest })
      });
    expect((await approve(newer)).body.item.status).toBe("approved");
    const version = (await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId]
    )).rows[0]!.current_version_id;
    const tips = (await db.query<{ id: string; current_value_id: string }>(`
      select id,current_value_id from parameter_catalog.project_parameter_bindings
       where organization_id=$1 and project_id=$2 order by id`, [ORG, PROJECT])).rows;
    expect((await approve(older)).status).toBe(409);
    expect((await approve(older)).status).toBe(409);
    expect((await db.query<{ status: string }>(
      "select status from project_parameter_value_change_requests where id=$1", [older.request.id]
    )).rows[0]!.status).toBe("pending");
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from project_parameter_value_change_targets
       where request_id=$1 and applied_value_id is not null`, [older.request.id])).rows[0]!.count).toBe(0);
    expect((await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId]
    )).rows[0]!.current_version_id).toBe(version);
    expect((await db.query<{ id: string; current_value_id: string }>(`
      select id,current_value_id from parameter_catalog.project_parameter_bindings
       where organization_id=$1 and project_id=$2 order by id`, [ORG, PROJECT])).rows).toEqual(tips);
  }, 120_000);

  it("serves the frozen proof and approves both targets through the protected HTTP review route", async () => {
    const candidate = await createCandidate(db, storage, admin, {
      projectId: PROJECT, fileId, fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 110 }, "other": { "limit": 115 } }\n')
    });
    const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: PROJECT, candidateId: candidate.id });
    const proof = await db.transaction((tx) => freezeCanonicalCandidateBatchSnapshotInTransaction(tx, storage, admin, {
      projectId: PROJECT, candidateId: candidate.id, expectedProofToken: preview.proofToken!
    }));
    const request = await submitCanonicalBatchValueChange(db, storage, admin, {
      projectId: PROJECT, candidateId: candidate.id, expectedProofToken: proof.proofToken,
      reason: "One protected review of both source targets", assignedToUserId: REVIEWER,
      invocation: createUserInvocation(admin), requestId: "c906-http-batch-submit",
      refusalSink: createTrustedRefusalAuditSink(db)
    });
    const route = (auth = reviewer, withObjectStore = true) => {
      const router = createRouter();
      registerCatalogProjectValueConsumerRoutes(router, {
        db, objectStore: withObjectStore ? storage : undefined, getCurrentAuthContext: () => auth
      });
      return createHttpServer(router);
    };
    const base = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${request.id}`;
    const frozen = await requestJson<{ item: { id: string; batchProofDigest: string; targets: Array<{ bindingId: string; ordinal: number }> } }>(
      route(), `${base}/batch`
    );
    expect(frozen.status).toBe(200);
    catalogBatchValueChangeRequestResponseSchema.parse(frozen.body);
    expect(frozen.body.item).toMatchObject({ id: request.id, batchProofDigest: proof.batchProofDigest });
    expect(frozen.body.item.targets.map((target) => target.ordinal)).toEqual([0, 1]);
    const diff = await requestJson<{ item: { batchProofDigest: string; targets: Array<{ bindingId: string; ordinal: number }> } }>(
      route(), `${base}/source-diff`
    );
    expect(diff.status).toBe(200);
    catalogValueChangeSourceDiffResponseSchema.parse(diff.body);
    expect(diff.body.item.batchProofDigest).toBe(proof.batchProofDigest);
    expect(diff.body.item.targets.map((target) => target.bindingId)).toEqual(
      frozen.body.item.targets.map((target) => target.bindingId)
    );
    expect((await requestJson(route(editor), `${base}/batch`)).status).toBe(404);
    const foreign = makeTestAuthContext({
      userId: REVIEWER, organizationId: "org-906-foreign",
      permissions: ["parameter:view", "parameter:edit", "parameter:review"],
      roles: [{ roleId: "software-committer", projectId: PROJECT }]
    });
    expect((await requestJson(route(foreign), `${base}/batch`)).status).toBe(404);
    expect((await requestJson(route(reviewer, false), `${base}/source-diff`)).status).toBe(500);
    expect((await requestJson(route(editor, false), `${base}/source-diff`)).status).toBe(404);
    expect((await requestJson(route(foreign, false), `${base}/source-diff`)).status).toBe(404);
    const reviewBody = (batchProofDigest?: string, decision = "approve") => ({
      method: "POST", body: JSON.stringify({ decision, ...(batchProofDigest ? { batchProofDigest } : {}) })
    });
    const deniedAudits = () => db.query<{ count: number }>(`
      select count(*)::int as count from audit_events
       where organization_id=$1 and project_id=$2 and target_id=$3
         and kind='parameter-source-permission-denied' and action='deny'`,
      [ORG, PROJECT, request.id]);
    const deniedBefore = (await deniedAudits()).rows[0]!.count;
    expect((await requestJson(route(editor), `${base}/review`, reviewBody(proof.batchProofDigest))).status).toBe(404);
    expect((await deniedAudits()).rows[0]!.count).toBe(deniedBefore + 1);
    expect((await requestJson(route(foreign), `${base}/review`, reviewBody(proof.batchProofDigest))).status).toBe(404);
    expect((await requestJson(route(), `${base}/review`, reviewBody())).status).toBe(400);
    const bad = await requestJson<{ error: { code: string; details: { reason: string } } }>(
      route(), `${base}/review`, reviewBody("0".repeat(64))
    );
    expect(bad.status).toBe(409);
    expect(bad.body.error.details.reason).toBe("canonical-batch-proof-mismatch");
    const approve = () => requestJson<{ item: { id: string; status: string; batchProofDigest: string; targets: Array<{ ordinal: number; appliedValueId: string }> } }>(
      route(), `${base}/review`, reviewBody(proof.batchProofDigest)
    );
    const applied = await approve();
    expect(applied.status).toBe(200);
    catalogValueChangeReviewResponseSchema.parse(applied.body);
    expect(applied.body.item).toMatchObject({ id: request.id, status: "approved", batchProofDigest: proof.batchProofDigest });
    expect(applied.body.item.targets.map((target) => target.ordinal)).toEqual([0, 1]);
    expect(applied.body.item.targets.every((target) => Boolean(target.appliedValueId))).toBe(true);
    expect((await approve()).body.item).toEqual(applied.body.item);
  }, 120_000);

  it("submits an unfrozen two-Binding candidate over HTTP, discovers only assigned review, and rejects idempotently", async () => {
    const candidate = await createCandidate(db, storage, admin, {
      projectId: PROJECT, fileId, fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 120 }, "other": { "limit": 125 } }\n')
    });
    const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: PROJECT, candidateId: candidate.id });
    const route = (auth = reviewer, withObjectStore = true) => {
      const router = createRouter();
      registerCatalogProjectValueConsumerRoutes(router, {
        db, objectStore: withObjectStore ? storage : undefined, getCurrentAuthContext: () => auth
      });
      return createHttpServer(router);
    };
    const collection = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`;
    const submitBody = { candidateId: candidate.id, expectedProofToken: preview.proofToken,
      reason: "Review both targets together", assignedToUserId: REVIEWER };
    expect((await requestJson(route(admin, false), collection, { method: "POST",
      body: JSON.stringify(submitBody) })).status).toBe(500);
    expect((await requestJson(route(editor, false), collection, { method: "POST",
      body: JSON.stringify(submitBody) })).status).toBe(403);
    expect((await requestJson(route(admin), collection, { method: "POST",
      body: JSON.stringify({ ...submitBody, assignedToUserId: ADMIN }) })).status).toBe(400);
    const submit = () => requestJson<{ item: { id: string; status: string; batchProofDigest: string; targets: Array<{ bindingId: string }> } }>(
      route(admin), collection, { method: "POST", body: JSON.stringify(submitBody) }
    );
    const created = await submit();
    expect(created.status).toBe(201);
    catalogBatchValueChangeRequestResponseSchema.parse(created.body);
    expect(created.body.item.targets).toHaveLength(2);
    const replay = await submit();
    expect(replay.status).toBe(201);
    expect(replay.body.item.id).toBe(created.body.item.id);
    expect((await requestJson(route(admin), collection, { method: "POST",
      body: JSON.stringify({ ...submitBody, reason: "Different request" }) })).status).toBe(409);
    expect((await requestJson(route(editor), collection, { method: "POST",
      body: JSON.stringify(submitBody) })).status).toBe(403);
    const foreign = makeTestAuthContext({ userId: ADMIN, organizationId: "org-906-foreign",
      permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
      roles: [{ roleId: "admin", projectId: null }] });
    expect((await requestJson(route(foreign, false), collection, { method: "POST",
      body: JSON.stringify(submitBody) })).status).toBe(404);
    const requestPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${created.body.item.id}`;
    const queue = await requestJson<{ items: Array<{ id: string }> }>(route(), `${collection}?status=pending`);
    expect(queue.status).toBe(200);
    catalogBatchValueChangeRequestListResponseSchema.parse(queue.body);
    expect(queue.body.items.map((item) => item.id)).toContain(created.body.item.id);
    expect((await requestJson(route(admin), `${collection}?mine=true&status=pending`)).body.items)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.item.id })]));
    expect((await requestJson(route(otherReviewer), `${collection}?status=pending`)).body.items)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.item.id })]));
    expect((await requestJson(route(otherReviewer), `${requestPath}/batch`)).status).toBe(404);
    expect((await requestJson(route(otherReviewer, false), `${requestPath}/source-diff`)).status).toBe(404);
    expect((await requestJson(route(foreign), `${requestPath}/batch`)).status).toBe(404);
    expect((await requestJson(route(reviewer, false), `${requestPath}/source-diff`)).status).toBe(500);
    const review = (auth: typeof reviewer, decision: "approve" | "reject", digest = created.body.item.batchProofDigest) =>
      requestJson(route(auth), `${requestPath}/review`, { method: "POST",
        body: JSON.stringify({ decision, batchProofDigest: digest }) });
    const deniedAudits = () => db.query<{ count: number }>(`select count(*)::int as count from audit_events
      where organization_id=$1 and project_id=$2 and target_id=$3
        and kind='parameter-source-permission-denied' and action='deny'`, [ORG, PROJECT, created.body.item.id]);
    const deniedBefore = (await deniedAudits()).rows[0]!.count;
    expect((await review(otherReviewer, "approve")).status).toBe(404);
    expect((await review(otherReviewer, "reject")).status).toBe(404);
    expect((await deniedAudits()).rows[0]!.count).toBe(deniedBefore + 2);
    expect((await requestJson(route(foreign), `${requestPath}/review`, { method: "POST",
      body: JSON.stringify({ decision: "reject", batchProofDigest: created.body.item.batchProofDigest }) })).status).toBe(404);
    expect((await review(reviewer, "reject", "0".repeat(64))).status).toBe(409);
    const beforeVersion = (await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId]
    )).rows[0]!.current_version_id;
    const rejected = await review(reviewer, "reject");
    expect(rejected.status).toBe(200);
    expect((rejected.body as { item: { status: string } }).item.status).toBe("rejected");
    expect((await db.query<{ count: number }>(`select count(*)::int as count from audit_events
      where organization_id=$1 and project_id=$2 and target_id=$3
        and action='value-change-reviewed' and metadata->>'decision'='reject'`,
      [ORG, PROJECT, created.body.item.id])).rows[0]!.count).toBe(1);
    expect((await review(reviewer, "reject")).body).toEqual(rejected.body);
    expect((await requestJson(route(), `${collection}?status=pending`)).body.items)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.item.id })]));
    expect((await requestJson(route(), `${collection}?status=rejected`)).body.items)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.item.id })]));
    expect((await review(reviewer, "approve")).status).toBe(409);
    expect((await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId]
    )).rows[0]!.current_version_id).toBe(beforeVersion);
  }, 120_000);

  it("rolls back every target through HTTP when the second source-pin write fails, then permits retry", async () => {
    const candidate = await createCandidate(db, storage, admin, {
      projectId: PROJECT, fileId, fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 130 }, "other": { "limit": 135 } }\n')
    });
    const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: PROJECT, candidateId: candidate.id });
    const router = createRouter();
    registerCatalogProjectValueConsumerRoutes(router, {
      db, objectStore: storage,
      getCurrentAuthContext: (request) => request.headers.authorization === "Bearer reviewer" ? reviewer : admin
    });
    const http = createHttpServer(router);
    const submitted = await requestJson<{ item: { id: string; batchProofDigest: string } }>(http,
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
        method: "POST", body: JSON.stringify({ candidateId: candidate.id,
          expectedProofToken: preview.proofToken, reason: "Commit both or neither",
          assignedToUserId: REVIEWER })
      });
    expect(submitted.status).toBe(201);
    const requestId = submitted.body.item.id;
    const beforeVersion = (await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId]
    )).rows[0]!.current_version_id;
    const beforeTips = (await db.query<{ id: string; current_value_id: string }>(`
      select id,current_value_id from parameter_catalog.project_parameter_bindings
       where organization_id=$1 and project_id=$2 order by id`, [ORG, PROJECT])).rows;
    const review = () => requestJson<{ item: { status: string } }>(http,
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${requestId}/review`, {
        method: "POST", headers: { authorization: "Bearer reviewer" },
        body: JSON.stringify({ decision: "approve", batchProofDigest: submitted.body.item.batchProofDigest })
      });
    const pool = getRootPostgresPool(db)!;
    const originalConnect = pool.connect.bind(pool);
    let pinInserts = 0;
    const wrapClient = (client: object) => new Proxy(client, { get(target, property) {
        if (property === "query") return (...args: unknown[]) => {
          if (typeof args[0] === "string"
            && args[0].includes("insert into parameter_catalog.project_value_source_pins") && ++pinInserts === 2) {
            throw new Error("injected second batch pin write failure");
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
      expect((await review()).status).toBe(500);
    } finally {
      pool.connect = originalConnect;
    }
    expect(pinInserts).toBe(2);
    expect((await db.query<{ status: string }>(
      "select status from project_parameter_value_change_requests where id=$1", [requestId]
    )).rows[0]!.status).toBe("pending");
    expect((await db.query<{ count: number }>(`select count(*)::int as count
      from project_parameter_value_change_targets where request_id=$1 and applied_value_id is not null`,
    [requestId])).rows[0]!.count).toBe(0);
    expect((await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId]
    )).rows[0]!.current_version_id).toBe(beforeVersion);
    expect((await db.query<{ id: string; current_value_id: string }>(`
      select id,current_value_id from parameter_catalog.project_parameter_bindings
       where organization_id=$1 and project_id=$2 order by id`, [ORG, PROJECT])).rows).toEqual(beforeTips);
    expect((await review()).body.item.status).toBe("approved");
  }, 120_000);

  it("lets the submitter withdraw and resubmit when the assigned reviewer loses the current role", async () => {
    const candidate = await createCandidate(db, storage, admin, {
      projectId: PROJECT, fileId, fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 140 }, "other": { "limit": 145 } }\n')
    });
    const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: PROJECT, candidateId: candidate.id });
    const route = (auth = admin) => {
      const router = createRouter();
      registerCatalogProjectValueConsumerRoutes(router, {
        db, objectStore: storage, getCurrentAuthContext: () => auth
      });
      return createHttpServer(router);
    };
    const collection = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`;
    const body = { candidateId: candidate.id, expectedProofToken: preview.proofToken,
      reason: "Recover after reviewer revocation", assignedToUserId: OTHER_REVIEWER };
    const first = await requestJson<{ item: { id: string; batchProofDigest: string } }>(route(), collection,
      { method: "POST", body: JSON.stringify(body) });
    expect(first.status).toBe(201);
    await db.query("delete from user_role_bindings where id='c906-other-reviewer'");
    try {
      expect((await requestJson(route(otherReviewer), `${collection}?status=pending`)).status).toBe(403);
      const detail = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${first.body.item.id}`;
      expect((await requestJson(route(otherReviewer), `${detail}/source-diff`)).status).toBe(403);
      expect((await requestJson(route(otherReviewer), `${detail}/review`, { method: "POST",
        body: JSON.stringify({ decision: "reject", batchProofDigest: first.body.item.batchProofDigest })
      })).status).toBe(403);
      const path = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${first.body.item.id}/withdraw`;
      expect((await requestJson(route(otherReviewer), path, { method: "POST" })).status).toBe(403);
      const withdrawn = await requestJson<{ item: { id: string; status: string } }>(route(), path, { method: "POST" });
      expect(withdrawn.status).toBe(200);
      expect(withdrawn.body.item.status).toBe("withdrawn");
      expect((await requestJson(route(), path, { method: "POST" })).body.item).toEqual(withdrawn.body.item);
      expect((await db.query<{ count: number }>(`select count(*)::int as count from audit_events
        where organization_id=$1 and project_id=$2 and target_id=$3 and action='value-change-withdrawn'`,
      [ORG, PROJECT, first.body.item.id])).rows[0]!.count).toBe(1);
      const second = await requestJson<{ item: { id: string; status: string; batchProofDigest: string } }>(route(), collection,
        { method: "POST", body: JSON.stringify({ ...body, assignedToUserId: REVIEWER }) });
      expect(second.status).toBe(201);
      expect(second.body.item.id).not.toBe(first.body.item.id);
      expect(second.body.item.status).toBe("pending");
      expect((await requestJson(route(reviewer),
        `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${second.body.item.id}/review`, {
          method: "POST", body: JSON.stringify({ decision: "reject",
            batchProofDigest: second.body.item.batchProofDigest })
        })).status).toBe(200);
    } finally {
      await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('c906-other-reviewer',$1,$2,$3,'software-committer')", [OTHER_REVIEWER, ORG, PROJECT]);
    }
  }, 120_000);

  it("returns one approved result to simultaneous HTTP retries", async () => {
    const candidate = await createCandidate(db, storage, admin, {
      projectId: PROJECT, fileId, fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 150 }, "other": { "limit": 155 } }\n')
    });
    const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: PROJECT, candidateId: candidate.id });
    const route = (auth = admin) => {
      const router = createRouter();
      registerCatalogProjectValueConsumerRoutes(router, {
        db, objectStore: storage, getCurrentAuthContext: () => auth
      });
      return createHttpServer(router);
    };
    const submitted = await requestJson<{ item: { id: string; batchProofDigest: string } }>(route(),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/batches`, {
        method: "POST", body: JSON.stringify({ candidateId: candidate.id,
          expectedProofToken: preview.proofToken, reason: "Concurrent retry",
          assignedToUserId: REVIEWER })
      });
    expect(submitted.status).toBe(201);
    const review = () => requestJson<{ item: { status: string; appliedAuditRef: string } }>(route(reviewer),
      `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.id}/review`, {
        method: "POST", body: JSON.stringify({ decision: "approve",
          batchProofDigest: submitted.body.item.batchProofDigest })
      });
    const [first, second] = await Promise.all([review(), review()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.item).toEqual(second.body.item);
    expect(first.body.item.status).toBe("approved");
  }, 120_000);
});
