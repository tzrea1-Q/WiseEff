import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { makeTestAuthContext } from "../../../testing/authContext";
import { installConfigurationSourceFixture } from "../../../testing/parameterCatalog/configurationSource";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { createLocalObjectStore } from "../../logs/objectStore";
import { createTrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { createConfigSet, addConfigSetFile } from "../../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { createCandidate } from "../../parameter-files/candidateService";
import { prepareCanonicalCandidateBatchInTransaction, previewCanonicalCandidate } from "../../parameter-files/canonicalFileWorkflow";
import { registerCanonicalJsonSource } from "../../parameter-files/canonicalJsonSource";
import { loadPublishedCatalog } from "../catalogProjectValueSync";
import { createCanonicalValueDraft, listCanonicalValueDraftsForReviewer } from "./service";
import { reviewCanonicalValueChange } from "./changeService";
import { getCanonicalBatchValueChangeForReviewer, submitCanonicalBatchValueChange } from "./batchChangeService";

const ORG = "org-906-c-batch";
const PROJECT = "project-906-c-batch";
const ADMIN = "user-906-c-admin";
const REVIEWER = "user-906-c-reviewer";
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
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true),($4,$2,'editor','Editor',true)", [ADMIN, ORG, REVIEWER, EDITOR]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'C batch','C906','initialized')", [PROJECT, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('c906-admin',$1,$2,null,'admin'),('c906-reviewer',$3,$2,$4,'software-committer'),('c906-editor',$5,$2,$4,'software-user')", [ADMIN, ORG, REVIEWER, PROJECT, EDITOR]);
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

  it("fails closed without D's persisted snapshot, then freezes a test-prefrozen request over two real Bindings", async () => {
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
    const submit = () => submitCanonicalBatchValueChange(db, storage, admin, {
      projectId: PROJECT, candidateId: candidate.id,
      expectedProofToken: preview.proofToken!, reason: "one human review for both targets",
      assignedToUserId: REVIEWER, invocation: createUserInvocation(admin),
      requestId: "c906-submit", refusalSink: createTrustedRefusalAuditSink(db)
    });
    await expect(submit()).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await db.query(`select count(*)::int as count from public.project_parameter_value_change_requests
      where organization_id=$1 and project_id=$2`, [ORG, PROJECT])).rows[0]!.count).toBe(0);
    // Synthetic boundary fixture only: D currently exposes a read-only proof,
    // not the candidate snapshot writer required before a real batch submit.
    const proof = await db.transaction((tx) => prepareCanonicalCandidateBatchInTransaction(tx, storage, admin, {
      projectId: PROJECT, candidateId: candidate.id, expectedProofToken: preview.proofToken!
    }));
    await db.query(`update public.project_parameter_file_candidates
      set base_digest=$2, proposed_digest=$3, diff_digest=$4,
          frozen_member_manifest=$5::jsonb, frozen_binding_manifest=$6::jsonb
      where id=$1`, [candidate.id, proof.baseDigest, proof.proposedDigest, proof.batchProofDigest,
      JSON.stringify(proof.members), JSON.stringify(proof.cohort)]);
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
    await expect(getCanonicalBatchValueChangeForReviewer(db, editor, { projectId: PROJECT, requestId: frozen.id }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(submit()).rejects.toMatchObject({ code: "CONFLICT" });
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
});
