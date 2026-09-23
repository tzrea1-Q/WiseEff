import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createLocalObjectStore } from "../logs/objectStore";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import { installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { createConfigSet, addConfigSetFile, removeConfigSetFile } from "./configSetService";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { uploadProjectParameterFile } from "./service";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { asValueClient, loadPublishedCatalog, listCatalogBindingRowsForProject, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { loadCanonicalSourceSnapshot, readPinnedDtsSourceBatchChanges } from "./canonicalSource";
import { loadOwnedProjectValueSourcePin, loadSourceBindingCohortReadOnly } from "../parameter-bindings/values";
import { createCandidate } from "./candidateService";
import {
  getCanonicalSourceWorkflow,
  freezeCanonicalCandidateBatchSnapshotInTransaction,
  prepareCanonicalCandidateBatchInTransaction,
  previewCanonicalCandidate,
  rollbackCanonicalSource,
  submitCanonicalCandidate
} from "./canonicalFileWorkflow";
import { reviewCanonicalValueChange } from "../parameter-bindings/drafts/changeService";
import { createCanonicalValueDraft } from "../parameter-bindings/drafts/service";
import { submitCanonicalBatchValueChange } from "../parameter-bindings/drafts/batchChangeService";
import { commitCanonicalSourceBatchRevision } from "./canonicalSourceBatchCommit";
import { readCanonicalBatchSourceDiff } from "./canonicalSourceDiff";
import type { ConfigRevisionManifest } from "../parameter-topology/types";

const ORG = "org-906-workflow";
const JSON_PROJECT = "project-906-json";
const DTS_PROJECT = "project-906-dts";
const ADMIN = "user-906-admin";
const REVIEWER = "user-906-reviewer";
const OTHER = "user-906-other";
const SUBJECT = "csub_906_limits";
const MODEL = "wiseeff.906.limits";
const DEFINITION = "pdef_acme_power_iin_max";

const admin = makeTestAuthContext({
  userId: ADMIN,
  organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }]
});

const jsonReviewer = makeTestAuthContext({
  userId: REVIEWER,
  organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: JSON_PROJECT }]
});

const dtsReviewer = makeTestAuthContext({
  userId: REVIEWER,
  organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId: DTS_PROJECT }]
});

const otherEditor = makeTestAuthContext({
  userId: OTHER,
  organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit"],
  roles: [{ roleId: "software-user", projectId: JSON_PROJECT }]
});

const foreignAdmin = makeTestAuthContext({
  userId: "user-906-foreign",
  organizationId: "org-906-foreign",
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }]
});

async function review(
  db: ReturnType<typeof createPostgresDatabase>,
  auth: typeof jsonReviewer,
  projectId: string,
  requestId: string,
  storage: ReturnType<typeof createLocalObjectStore>
) {
  const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
  if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
  return reviewCanonicalValueChange(
    db,
    auth,
    { projectId, requestId, decision: "approve" },
    {
      objectStore: storage,
      snapshot,
      invocation: createUserInvocation(auth),
      traceId: `review:${requestId}`,
      refusalSink: createTrustedRefusalAuditSink(db)
    }
  );
}

describe("#906 canonical JSON candidate workflow", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let storageDirectory: string;
  let fileId: string;
  let versionId: string;
  let configSetId: string;
  let bindings: Array<{ id: string; currentValueId: string }>;
  let pendingBatch: { requestId: string; proofDigest: string; baseVersionId: string; valueTips: Array<{ id: string; current_value_id: string }> };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("issue906-json-workflow");
    db = createPostgresDatabase(database.url);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-906-json-workflow-"));
    storage = createLocalObjectStore(storageDirectory);
    await db.query("insert into organizations(id,name) values ($1,'#906 workflow')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true),($4,$2,'other','User',true)", [ADMIN, ORG, REVIEWER, OTHER]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'JSON workflow','J906','initialized'),($3,$2,'DTS workflow','D906','initialized')", [JSON_PROJECT, ORG, DTS_PROJECT]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('role-906-admin',$1,$2,null,'admin'),('role-906-json-reviewer',$3,$2,$4,'software-committer'),('role-906-dts-reviewer',$3,$2,$5,'software-committer'),('role-906-other',$6,$2,$4,'software-user')", [ADMIN, ORG, REVIEWER, JSON_PROJECT, DTS_PROJECT, OTHER]);

    await installConfigurationSourceFixture(db, admin, { subjectId: SUBJECT, schemaId: MODEL });
    const set = await createConfigSet(db, admin, { projectId: JSON_PROJECT, name: "JSON workflow" });
    configSetId = set.id;
    const uploaded = await uploadProjectParameterFile(db, storage, admin, {
      projectId: JSON_PROJECT,
      fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 36.5, "keep": true }, "other": { "limit": 48 } }\n')
    });
    fileId = uploaded.file.id;
    versionId = uploaded.version.id;
    await addConfigSetFile(db, admin, { configSetId, fileId, role: "base", sortOrder: 0 });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    const first = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
      projectId: JSON_PROJECT,
      configSetId,
      fileId,
      fileVersionId: versionId,
      configurationSchemaId: MODEL,
      rootPointer: "",
      mappings: [{ definitionId: DEFINITION, pointer: "/settings/limit" }],
      invocation: createUserInvocation(admin),
      requestId: "906-json-register-settings",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    const second = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
      projectId: JSON_PROJECT,
      configSetId,
      fileId,
      fileVersionId: versionId,
      configurationSchemaId: MODEL,
      rootPointer: "/other",
      mappings: [{ definitionId: DEFINITION, pointer: "/other/limit" }],
      invocation: createUserInvocation(admin),
      requestId: "906-json-register-other",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    bindings = [
      { id: first.bindings[0]!.id, currentValueId: first.bindings[0]!.currentValueId },
      { id: second.bindings[0]!.id, currentValueId: second.bindings[0]!.currentValueId }
    ];
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  it("proves canonical source membership, rejects multi-binding/non-target bytes and preserves another user's draft", async () => {
    const workflow = await getCanonicalSourceWorkflow(db, admin, { projectId: JSON_PROJECT, fileId });
    expect(workflow).toMatchObject({ canonical: true, configSetId, bindingCount: 2 });

    const conflictingPin = await loadOwnedProjectValueSourcePin(db, {
      organizationId: ORG,
      projectId: JSON_PROJECT,
      bindingId: bindings[0]!.id,
      projectValueId: bindings[0]!.currentValueId
    });
    if (!conflictingPin) throw new Error("JSON pin missing");
    await createCanonicalValueDraft(db, otherEditor, {
      projectId: JSON_PROJECT,
      bindingId: bindings[0]!.id,
      sourceTarget: { format: "json", sourceText: "99" },
      reason: "reserve another user's source draft",
      baseRevisionId: conflictingPin.configRevisionId,
      baseCurrentValueId: conflictingPin.projectValueId
    }, {
      objectStore: storage,
      invocation: createUserInvocation(otherEditor),
      requestId: "906-json-other-draft",
      refusalSink: createTrustedRefusalAuditSink(db)
    });

    const changedBoth = await createCandidate(db, storage, admin, {
      projectId: JSON_PROJECT,
      fileId,
      fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 50, "keep": true }, "other": { "limit": 60 } }\n')
    });
    const beforeMultiPreview = {
      cohort: await loadSourceBindingCohortReadOnly(db, {
        organizationId: ORG,
        projectId: JSON_PROJECT,
        configSetId
      }),
      file: (await db.query<{ current_version_id: string | null }>(
        "select current_version_id from project_parameter_files where id=$1",
        [fileId]
      )).rows[0],
      versions: (await db.query<{ count: number }>(
        "select count(*)::int as count from project_parameter_file_versions where file_id=$1",
        [fileId]
      )).rows[0]!.count,
      drafts: (await db.query<{ count: number }>(
        "select count(*)::int as count from project_parameter_value_drafts where organization_id=$1 and project_id=$2",
        [ORG, JSON_PROJECT]
      )).rows[0]!.count,
      requests: (await db.query<{ count: number }>(
        "select count(*)::int as count from project_parameter_value_change_requests where organization_id=$1 and project_id=$2",
        [ORG, JSON_PROJECT]
      )).rows[0]!.count
    };
    const multiPreview = await previewCanonicalCandidate(db, storage, admin, { projectId: JSON_PROJECT, candidateId: changedBoth.id });
    const repeatedMultiPreview = await previewCanonicalCandidate(db, storage, admin, { projectId: JSON_PROJECT, candidateId: changedBoth.id });
    const preparedBatch = await db.transaction((tx) => prepareCanonicalCandidateBatchInTransaction(tx, storage, admin, {
      projectId: JSON_PROJECT,
      candidateId: changedBoth.id,
      expectedProofToken: multiPreview.proofToken!
    }));
    const repeatedPreparedBatch = await db.transaction((tx) => prepareCanonicalCandidateBatchInTransaction(tx, storage, admin, {
      projectId: JSON_PROJECT,
      candidateId: changedBoth.id,
      expectedProofToken: multiPreview.proofToken!
    }));

    expect(repeatedMultiPreview).toEqual(multiPreview);
    expect(repeatedPreparedBatch).toEqual(preparedBatch);
    expect(preparedBatch).toMatchObject({
      kind: "canonical-source-batch",
      organizationId: ORG,
      projectId: JSON_PROJECT,
      candidateId: changedBoth.id,
      fileId,
      format: "json",
      baseVersionId: versionId,
      configSetId,
      proofToken: multiPreview.proofToken,
      cohortProofToken: multiPreview.cohortProofToken,
      batchProofDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      targets: expect.arrayContaining([
        expect.objectContaining({ bindingId: bindings[0]!.id, targetText: "50", action: "set" }),
        expect.objectContaining({ bindingId: bindings[1]!.id, targetText: "60", action: "set" })
      ])
    });
    expect(preparedBatch.members).toHaveLength(1);
    expect(preparedBatch.cohort).toHaveLength(2);
    expect(preparedBatch.targets.map((target) => target.bindingId)).toEqual(
      [...preparedBatch.targets.map((target) => target.bindingId)].sort()
    );
    await expect(db.transaction((tx) => prepareCanonicalCandidateBatchInTransaction(tx, storage, otherEditor, {
      projectId: JSON_PROJECT,
      candidateId: changedBoth.id,
      expectedProofToken: multiPreview.proofToken!
    }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(db.transaction((tx) => prepareCanonicalCandidateBatchInTransaction(tx, storage, foreignAdmin, {
      projectId: JSON_PROJECT,
      candidateId: changedBoth.id,
      expectedProofToken: multiPreview.proofToken!
    }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(multiPreview).toMatchObject({
      kind: "canonical",
      canSubmit: false,
      reason: "canonical-batch-writer-unavailable",
      candidateId: changedBoth.id,
      fileId,
      format: "json",
      baseVersionId: versionId,
      configSetId,
      cohortProofToken: expect.any(String),
      proofToken: expect.any(String),
      bindings: [
        {
          bindingId: expect.any(String),
          definitionId: DEFINITION,
          baseCurrentValueId: expect.any(String),
          configRevisionId: expect.any(String),
          sourcePinId: expect.any(String),
          locator: expect.any(String),
          baseDigest: expect.any(String),
          proposedDigest: expect.any(String),
          action: "set"
        },
        {
          bindingId: expect.any(String),
          definitionId: DEFINITION,
          baseCurrentValueId: expect.any(String),
          configRevisionId: expect.any(String),
          sourcePinId: expect.any(String),
          locator: expect.any(String),
          baseDigest: expect.any(String),
          proposedDigest: expect.any(String),
          action: "set"
        }
      ]
    });
    expect(multiPreview.bindings).toHaveLength(2);
    expect(multiPreview.baseDigest).toBe(multiPreview.bindings![0]!.baseDigest);
    expect(multiPreview.proposedDigest).toBe(multiPreview.bindings![0]!.proposedDigest);
    expect(multiPreview.before).toContain('"limit": 36.5');
    expect(multiPreview.after).toContain('"limit": 50');
    expect(multiPreview.bindings?.map((binding) => [binding.beforeText, binding.afterText])).toEqual(
      expect.arrayContaining([["36.5", "50"], ["48", "60"]])
    );
    expect(multiPreview.bindings!.map((binding) => binding.bindingId)).toEqual(
      [...multiPreview.bindings!.map((binding) => binding.bindingId)].sort()
    );
    expect(multiPreview.bindings![0]!.baseDigest).toBe(multiPreview.bindings![1]!.baseDigest);
    expect(multiPreview.bindings![0]!.proposedDigest).toBe(multiPreview.bindings![1]!.proposedDigest);
    expect([...multiPreview.bindings!.map((binding) => binding.locator)].sort()).toEqual([
      '{"kind":"json-pointer","pointer":"/settings/limit"}',
      '{"kind":"json-pointer","pointer":"/other/limit"}'
    ].sort());
    await expect(submitCanonicalCandidate(db, storage, admin, {
      projectId: JSON_PROJECT,
      candidateId: changedBoth.id,
      expectedCurrentVersionId: versionId,
      expectedProofToken: multiPreview.proofToken!,
      reason: "batch writer remains unavailable",
      requestId: "906-json-multi-submit-refused",
      refusalSink: createTrustedRefusalAuditSink(db)
    })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "canonical-batch-writer-unavailable" } });

    const afterMultiPreview = {
      cohort: await loadSourceBindingCohortReadOnly(db, {
        organizationId: ORG,
        projectId: JSON_PROJECT,
        configSetId
      }),
      file: (await db.query<{ current_version_id: string | null }>(
        "select current_version_id from project_parameter_files where id=$1",
        [fileId]
      )).rows[0],
      versions: (await db.query<{ count: number }>(
        "select count(*)::int as count from project_parameter_file_versions where file_id=$1",
        [fileId]
      )).rows[0]!.count,
      drafts: (await db.query<{ count: number }>(
        "select count(*)::int as count from project_parameter_value_drafts where organization_id=$1 and project_id=$2",
        [ORG, JSON_PROJECT]
      )).rows[0]!.count,
      requests: (await db.query<{ count: number }>(
        "select count(*)::int as count from project_parameter_value_change_requests where organization_id=$1 and project_id=$2",
        [ORG, JSON_PROJECT]
      )).rows[0]!.count
    };
    expect(afterMultiPreview).toEqual(beforeMultiPreview);

    const frozen = await db.transaction((tx) => freezeCanonicalCandidateBatchSnapshotInTransaction(tx, storage, admin, {
      projectId: JSON_PROJECT,
      candidateId: changedBoth.id,
      expectedProofToken: multiPreview.proofToken!
    }));
    expect(frozen).toEqual(preparedBatch);
    expect(await db.transaction((tx) => freezeCanonicalCandidateBatchSnapshotInTransaction(tx, storage, admin, {
      projectId: JSON_PROJECT,
      candidateId: changedBoth.id,
      expectedProofToken: multiPreview.proofToken!
    }))).toEqual(frozen);
    const snapshotRow = (await db.query<{
      base_digest: string; proposed_digest: string; diff_digest: string;
      frozen_member_manifest: unknown; frozen_binding_manifest: unknown;
    }>(`select base_digest,proposed_digest,diff_digest,frozen_member_manifest,frozen_binding_manifest
      from project_parameter_file_candidates where id=$1`, [changedBoth.id])).rows[0]!;
    expect(snapshotRow).toEqual({
      base_digest: frozen.baseDigest,
      proposed_digest: frozen.proposedDigest,
      diff_digest: frozen.batchProofDigest,
      frozen_member_manifest: frozen.members,
      frozen_binding_manifest: frozen.cohort
    });
    await expect(db.transaction((tx) => freezeCanonicalCandidateBatchSnapshotInTransaction(tx, storage, admin, {
      projectId: JSON_PROJECT,
      candidateId: changedBoth.id,
      expectedProofToken: "stale-proof"
    }))).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "source-proof-stale" } });
    const rollbackCandidate = await createCandidate(db, storage, admin, {
      projectId: JSON_PROJECT, fileId, fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 50, "keep": true }, "other": { "limit": 60 } }\n')
    });
    const rollbackPreview = await previewCanonicalCandidate(db, storage, admin, {
      projectId: JSON_PROJECT, candidateId: rollbackCandidate.id
    });
    await expect(db.transaction(async (tx) => {
      await freezeCanonicalCandidateBatchSnapshotInTransaction(tx, storage, admin, {
        projectId: JSON_PROJECT, candidateId: rollbackCandidate.id,
        expectedProofToken: rollbackPreview.proofToken!
      });
      throw new Error("simulate confirmed rollback after snapshot");
    })).rejects.toThrow("simulate confirmed rollback after snapshot");
    expect((await db.query<{ base_digest: string | null }>(
      "select base_digest from project_parameter_file_candidates where id=$1", [rollbackCandidate.id]
    )).rows[0]!.base_digest).toBeNull();

    const changedNonTarget = await createCandidate(db, storage, admin, {
      projectId: JSON_PROJECT,
      fileId,
      fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 36.5, "keep": false }, "other": { "limit": 48 } }\n')
    });
    const nonTargetPreview = await previewCanonicalCandidate(db, storage, admin, { projectId: JSON_PROJECT, candidateId: changedNonTarget.id });
    expect(nonTargetPreview).toMatchObject({ kind: "canonical", canSubmit: false, reason: "candidate-changed-unbound-or-non-target-bytes" });
    expect(nonTargetPreview.bindings).toBeUndefined();

    const changedReservedBinding = await createCandidate(db, storage, admin, {
      projectId: JSON_PROJECT,
      fileId,
      fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 50, "keep": true }, "other": { "limit": 48 } }\n')
    });
    const reservedPreview = await previewCanonicalCandidate(db, storage, admin, { projectId: JSON_PROJECT, candidateId: changedReservedBinding.id });
    expect(reservedPreview).toMatchObject({ kind: "canonical", canSubmit: true, bindingId: bindings[0]!.id });
    await expect(submitCanonicalCandidate(db, storage, otherEditor, {
      projectId: JSON_PROJECT,
      candidateId: reservedPreview.candidateId,
      expectedCurrentVersionId: versionId,
      expectedProofToken: reservedPreview.proofToken!,
      reason: "non-admin cannot submit canonical source",
      requestId: "906-json-forbidden-submit",
      refusalSink: createTrustedRefusalAuditSink(db)
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(previewCanonicalCandidate(db, storage, foreignAdmin, { projectId: JSON_PROJECT, candidateId: reservedPreview.candidateId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(submitCanonicalCandidate(db, storage, admin, {
      projectId: JSON_PROJECT,
      candidateId: reservedPreview.candidateId,
      expectedCurrentVersionId: versionId,
      expectedProofToken: reservedPreview.proofToken!,
      reason: "reserved binding must reject a different author's draft",
      requestId: "906-json-reserved-submit",
      refusalSink: createTrustedRefusalAuditSink(db)
    })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "existing-canonical-draft" } });

    const draftCount = await db.query<{ count: number }>("select count(*)::int as count from project_parameter_value_drafts where organization_id=$1 and project_id=$2", [ORG, JSON_PROJECT]);
    expect(draftCount.rows[0]!.count).toBe(1);

    const staleCandidate = await createCandidate(db, storage, admin, {
      projectId: JSON_PROJECT,
      fileId,
      fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 36.5, "keep": true }, "other": { "limit": 61 } }\n')
    });
    const stalePreview = await previewCanonicalCandidate(db, storage, admin, { projectId: JSON_PROJECT, candidateId: staleCandidate.id });
    const repinSnapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!repinSnapshot) throw new Error("Published Catalog fixture is unavailable");
    await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, repinSnapshot, {
      projectId: JSON_PROJECT,
      configSetId,
      fileId,
      fileVersionId: versionId,
      configurationSchemaId: MODEL,
      rootPointer: "/settings",
      mappings: [{ definitionId: DEFINITION, pointer: "/settings/limit" }],
      invocation: createUserInvocation(admin),
      requestId: "906-json-repin-cohort",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    await expect(submitCanonicalCandidate(db, storage, admin, {
      projectId: JSON_PROJECT,
      candidateId: staleCandidate.id,
      expectedCurrentVersionId: versionId,
      expectedProofToken: stalePreview.proofToken!,
      reason: "reject source cohort repin drift",
      requestId: "906-json-repin-stale",
      refusalSink: createTrustedRefusalAuditSink(db)
    })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "source-proof-stale" } });
    await expect(db.transaction((tx) => prepareCanonicalCandidateBatchInTransaction(tx, storage, admin, {
      projectId: JSON_PROJECT,
      candidateId: changedBoth.id,
      expectedProofToken: multiPreview.proofToken!
    }))).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "source-proof-stale" } });
    const draftCountAfterDrift = await db.query<{ count: number }>("select count(*)::int as count from project_parameter_value_drafts where organization_id=$1 and project_id=$2", [ORG, JSON_PROJECT]);
    expect(draftCountAfterDrift.rows[0]!.count).toBe(1);
  }, 120_000);

  it("submits and commits one JSON locator through the existing review owner, then replays", async () => {
    const candidate = await createCandidate(db, storage, admin, {
      projectId: JSON_PROJECT,
      fileId,
      fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 36.5, "keep": true }, "other": { "limit": 60 } }\n')
    });
    const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: JSON_PROJECT, candidateId: candidate.id });
    expect(preview).toMatchObject({ kind: "canonical", canSubmit: true, bindingId: bindings[1]!.id, format: "json" });
    expect(preview.before).toContain('"limit": 48');
    expect(preview.after).toContain('"limit": 60');
    const submitted = await submitCanonicalCandidate(db, storage, admin, {
      projectId: JSON_PROJECT,
      candidateId: candidate.id,
      expectedCurrentVersionId: versionId,
      expectedProofToken: preview.proofToken!,
      reason: "review one JSON source locator",
      requestId: "906-json-submit",
      refusalSink: createTrustedRefusalAuditSink(db)
    });
    expect(submitted).toMatchObject({ status: "pending", replayed: false });
    const pendingReplay = await submitCanonicalCandidate(db, storage, admin, {
      projectId: JSON_PROJECT,
      candidateId: candidate.id,
      expectedCurrentVersionId: versionId,
      expectedProofToken: preview.proofToken!,
      reason: "replay pending JSON source request",
      requestId: "906-json-submit-pending-retry",
      refusalSink: createTrustedRefusalAuditSink(db)
    });
    expect(pendingReplay).toMatchObject({ requestId: submitted.requestId, status: "pending", replayed: true });
    const applied = await review(db, jsonReviewer, JSON_PROJECT, submitted.requestId, storage);
    expect(applied.status).toBe("approved");
    const replay = await submitCanonicalCandidate(db, storage, admin, {
      projectId: JSON_PROJECT,
      candidateId: candidate.id,
      expectedCurrentVersionId: versionId,
      expectedProofToken: preview.proofToken!,
      reason: "retry exact JSON source request",
      requestId: "906-json-submit-retry",
      refusalSink: createTrustedRefusalAuditSink(db)
    });
    expect(replay).toMatchObject({ requestId: submitted.requestId, status: "approved", replayed: true });
    const current = await db.query<{ current_version_id: string | null }>("select current_version_id from project_parameter_files where id=$1", [fileId]);
    expect(current.rows[0]!.current_version_id).not.toBe(versionId);
    const currentVersion = await db.query<{ storage_key: string }>("select storage_key from project_parameter_file_versions where id=$1", [current.rows[0]!.current_version_id]);
    expect((await storage.get(currentVersion.rows[0]!.storage_key)).toString()).toContain('"limit": 60');

    let rollbackWorkflow = await getCanonicalSourceWorkflow(db, admin, { projectId: JSON_PROJECT, fileId });
    expect(rollbackWorkflow.proofToken).toBeTruthy();
    const rollbackRepinSnapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!rollbackRepinSnapshot) throw new Error("Published Catalog fixture is unavailable");
    await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, rollbackRepinSnapshot, {
      projectId: JSON_PROJECT,
      configSetId,
      fileId,
      fileVersionId: current.rows[0]!.current_version_id!,
      configurationSchemaId: MODEL,
      rootPointer: "/settings/limit",
      mappings: [{ definitionId: DEFINITION, pointer: "/settings/limit" }],
      invocation: createUserInvocation(admin),
      requestId: "906-json-rollback-repin",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    const staleRollbackWorkflow = rollbackWorkflow;
    await expect(rollbackCanonicalSource(db, storage, admin, {
      projectId: JSON_PROJECT,
      fileId,
      versionId,
      expectedCurrentVersionId: current.rows[0]!.current_version_id!,
      expectedProofToken: staleRollbackWorkflow.proofToken!,
      reason: "reject rollback source repin drift",
      requestId: "906-json-rollback-repin-stale",
      refusalSink: createTrustedRefusalAuditSink(db)
    })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "source-proof-stale" } });
    rollbackWorkflow = await getCanonicalSourceWorkflow(db, admin, { projectId: JSON_PROJECT, fileId });
    expect(rollbackWorkflow.proofToken).not.toBe(staleRollbackWorkflow.proofToken);
    const rollback = await rollbackCanonicalSource(db, storage, admin, {
      projectId: JSON_PROJECT,
      fileId,
      versionId,
      expectedCurrentVersionId: current.rows[0]!.current_version_id!,
      expectedProofToken: rollbackWorkflow.proofToken!,
      reason: "rollback one JSON canonical source version",
      requestId: "906-json-rollback",
      refusalSink: createTrustedRefusalAuditSink(db)
    });
    expect(rollback).toMatchObject({ status: "pending", replayed: false });
    const rollbackPendingReplay = await rollbackCanonicalSource(db, storage, admin, {
      projectId: JSON_PROJECT,
      fileId,
      versionId,
      expectedCurrentVersionId: current.rows[0]!.current_version_id!,
      expectedProofToken: rollbackWorkflow.proofToken!,
      reason: "retry pending JSON rollback",
      requestId: "906-json-rollback-pending-retry",
      refusalSink: createTrustedRefusalAuditSink(db)
    });
    expect(rollbackPendingReplay).toMatchObject({ requestId: rollback.requestId, status: "pending", replayed: true });
    const rollbackApplied = await review(db, jsonReviewer, JSON_PROJECT, rollback.requestId, storage);
    expect(rollbackApplied.status).toBe("approved");
    const rollbackApprovedReplay = await rollbackCanonicalSource(db, storage, admin, {
      projectId: JSON_PROJECT,
      fileId,
      versionId,
      expectedCurrentVersionId: current.rows[0]!.current_version_id!,
      expectedProofToken: rollbackWorkflow.proofToken!,
      reason: "retry approved JSON rollback",
      requestId: "906-json-rollback-approved-retry",
      refusalSink: createTrustedRefusalAuditSink(db)
    });
    expect(rollbackApprovedReplay).toMatchObject({ requestId: rollback.requestId, status: "approved", replayed: true });
  }, 120_000);

  it("cleans the prepared object when review submission fails after preparation", async () => {
    const candidate = await createCandidate(db, storage, admin, {
      projectId: JSON_PROJECT,
      fileId,
      fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 36.5, "keep": true }, "other": { "limit": 62 } }\n')
    });
    const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: JSON_PROJECT, candidateId: candidate.id });
    expect(preview).toMatchObject({ kind: "canonical", canSubmit: true, format: "json" });
    const orgDirectory = join(storageDirectory, ORG);
    const beforeObjects = new Set(await readdir(orgDirectory));
    await db.query("delete from user_role_bindings where id=$1", ["role-906-json-reviewer"]);
    const activeFile = await db.query<{ current_version_id: string | null }>(
      "select current_version_id from project_parameter_files where id=$1",
      [fileId]
    );

    await expect(submitCanonicalCandidate(db, storage, admin, {
      projectId: JSON_PROJECT,
      candidateId: candidate.id,
      expectedCurrentVersionId: activeFile.rows[0]!.current_version_id!,
      expectedProofToken: preview.proofToken!,
      reason: "reviewer removal must not leave a prepared object",
      requestId: "906-json-submit-failure-cleanup",
      refusalSink: createTrustedRefusalAuditSink(db)
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const afterObjects = new Set(await readdir(orgDirectory));
    expect([...afterObjects].filter((name) => !beforeObjects.has(name))).toEqual([]);
    const draft = await db.query<{ count: number }>(
      "select count(*)::int as count from project_parameter_value_drafts where organization_id=$1 and project_id=$2 and binding_id=$3",
      [ORG, JSON_PROJECT, preview.bindingId]
    );
    expect(draft.rows[0]!.count).toBe(0);
    const request = await db.query<{ count: number }>(
      "select count(*)::int as count from project_parameter_value_change_requests where organization_id=$1 and project_id=$2 and candidate_id=$3",
      [ORG, JSON_PROJECT, candidate.id]
    );
    expect(request.rows[0]!.count).toBe(0);
  }, 120_000);

  it("serializes concurrent submissions for one canonical binding", async () => {
    await db.query(
      "insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ($1,$2,$3,$4,$5)",
      ["role-906-json-reviewer", REVIEWER, ORG, JSON_PROJECT, "software-committer"]
    );
    const current = await db.query<{ current_version_id: string | null }>(
      "select current_version_id from project_parameter_files where id=$1",
      [fileId]
    );
    const candidateA = await createCandidate(db, storage, admin, {
      projectId: JSON_PROJECT,
      fileId,
      fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 36.5, "keep": true }, "other": { "limit": 63 } }\n')
    });
    const candidateB = await createCandidate(db, storage, admin, {
      projectId: JSON_PROJECT,
      fileId,
      fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 36.5, "keep": true }, "other": { "limit": 64 } }\n')
    });
    const [previewA, previewB] = await Promise.all([
      previewCanonicalCandidate(db, storage, admin, { projectId: JSON_PROJECT, candidateId: candidateA.id }),
      previewCanonicalCandidate(db, storage, admin, { projectId: JSON_PROJECT, candidateId: candidateB.id })
    ]);
    expect(previewA.canSubmit).toBe(true);
    expect(previewB.canSubmit).toBe(true);
    const results = await Promise.allSettled([
      submitCanonicalCandidate(db, storage, admin, {
        projectId: JSON_PROJECT,
        candidateId: candidateA.id,
        expectedCurrentVersionId: current.rows[0]!.current_version_id!,
        expectedProofToken: previewA.proofToken!,
        reason: "serialize concurrent source submit A",
        requestId: "906-json-concurrent-a",
        refusalSink: createTrustedRefusalAuditSink(db)
      }),
      submitCanonicalCandidate(db, storage, admin, {
        projectId: JSON_PROJECT,
        candidateId: candidateB.id,
        expectedCurrentVersionId: current.rows[0]!.current_version_id!,
        expectedProofToken: previewB.proofToken!,
        reason: "serialize concurrent source submit B",
        requestId: "906-json-concurrent-b",
        refusalSink: createTrustedRefusalAuditSink(db)
      })
    ]);
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<{ requestId: string; status: "pending" | "approved" | "rejected" | "withdrawn"; replayed: boolean }> => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(fulfilled[0]!.value.status).toBe("pending");
    await review(db, jsonReviewer, JSON_PROJECT, fulfilled[0]!.value.requestId, storage);
  }, 120_000);

  it("freezes a real candidate snapshot for C's single multi-target request", async () => {
    const current = (await db.query<{ current_version_id: string; storage_key: string }>(`
      select file.current_version_id,version.storage_key from project_parameter_files file
      join project_parameter_file_versions version on version.id=file.current_version_id
      where file.id=$1`, [fileId])).rows[0]!;
    const valueTips = (await db.query<{ id: string; current_value_id: string }>(`
      select id,current_value_id from parameter_catalog.project_parameter_bindings
      where organization_id=$1 and project_id=$2 order by id`, [ORG, JSON_PROJECT])).rows;
    const before = (await storage.getBounded!(current.storage_key, 1024 * 1024)).toString();
    const after = before
      .replace(/("settings": \{ "limit": )\d+(?:\.\d+)?/, (_match, prefix: string) => `${prefix}50`)
      .replace(/("other": \{ "limit": )\d+(?:\.\d+)?/, (_match, prefix: string) => `${prefix}70`);
    expect(after).not.toBe(before);
    const candidate = await createCandidate(db, storage, admin, {
      projectId: JSON_PROJECT, fileId, fileName: "settings.json", bytes: Buffer.from(after)
    });
    const preview = await previewCanonicalCandidate(db, storage, admin, {
      projectId: JSON_PROJECT, candidateId: candidate.id
    });
    expect(preview.bindings!.length).toBeGreaterThanOrEqual(2);
    const proof = await db.transaction((tx) => freezeCanonicalCandidateBatchSnapshotInTransaction(tx, storage, admin, {
      projectId: JSON_PROJECT, candidateId: candidate.id, expectedProofToken: preview.proofToken!
    }));
    const request = await submitCanonicalBatchValueChange(db, storage, admin, {
      projectId: JSON_PROJECT, candidateId: candidate.id, expectedProofToken: proof.proofToken,
      reason: "Review two exact source targets together", assignedToUserId: REVIEWER,
      invocation: createUserInvocation(admin), requestId: "906-json-real-batch-submit",
      refusalSink: createTrustedRefusalAuditSink(db)
    });
    expect(request).toMatchObject({ status: "pending", batchProofDigest: proof.batchProofDigest });
    expect(request.targets).toHaveLength(preview.bindings!.length);
    const frozenDiff = await readCanonicalBatchSourceDiff(db, storage, jsonReviewer, {
      projectId: JSON_PROJECT, requestId: request.id
    });
    expect(frozenDiff).toMatchObject({
      requestId: request.id, kind: "batch", batchProofDigest: proof.batchProofDigest,
      before, after, baseDigest: proof.baseDigest, proposedDigest: proof.proposedDigest,
      targets: expect.arrayContaining(request.targets.map((target) => expect.objectContaining({
        bindingId: target.bindingId, action: target.action
      })))
    });
    expect(frozenDiff.targets).toHaveLength(request.targets.length);
    expect(frozenDiff.targets.map((target) => target.afterText)).toEqual(
      expect.arrayContaining(["50", "70"])
    );
    expect(frozenDiff.targets.every((target) => target.beforeText !== target.afterText)).toBe(true);
    await expect(readCanonicalBatchSourceDiff(db, {
      ...storage, getBounded: async () => Buffer.from("tampered")
    }, jsonReviewer, { projectId: JSON_PROJECT, requestId: request.id }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(readCanonicalBatchSourceDiff(db, storage, foreignAdmin, {
      projectId: JSON_PROJECT, requestId: request.id
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Published Catalog fixture is unavailable");
    await expect(db.transaction((tx) => commitCanonicalSourceBatchRevision(tx, storage, otherEditor, catalog, {
      projectId: JSON_PROJECT, requestId: request.id,
      invocation: createUserInvocation(otherEditor), traceId: "906-json-batch-forbidden",
      refusalSink: createTrustedRefusalAuditSink(db)
    }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId]
    )).rows[0]!.current_version_id).toBe(current.current_version_id);
    expect((await db.query<{ id: string; current_value_id: string }>(`
      select id,current_value_id from parameter_catalog.project_parameter_bindings
      where organization_id=$1 and project_id=$2 order by id`, [ORG, JSON_PROJECT])).rows).toEqual(valueTips);
    pendingBatch = {
      requestId: request.id, proofDigest: proof.batchProofDigest,
      baseVersionId: current.current_version_id, valueTips
    };
  }, 120_000);

  it("rolls back every batch effect when a later source-pin write fails", async () => {
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Published Catalog fixture is unavailable");
    const versionsBefore = (await db.query<{ count: number }>(
      "select count(*)::int as count from project_parameter_file_versions where file_id=$1", [fileId]
    )).rows[0]!.count;
    let pinInserts = 0;
    await expect(db.transaction((tx) => commitCanonicalSourceBatchRevision({
      ...tx,
      query: async <Row,>(statement: string, values?: unknown[]) => {
        if (statement.includes("insert into parameter_catalog.project_value_source_pins") && ++pinInserts === 2) {
          throw new Error("injected second batch pin write failure");
        }
        return tx.query<Row>(statement, values);
      }
    }, storage, jsonReviewer, catalog, {
      projectId: JSON_PROJECT, requestId: pendingBatch.requestId,
      invocation: createUserInvocation(jsonReviewer), traceId: "906-json-batch-fault",
      refusalSink: createTrustedRefusalAuditSink(db)
    }))).rejects.toThrow("injected second batch pin write failure");
    expect(pinInserts).toBe(2);
    expect((await db.query<{ count: number }>(
      "select count(*)::int as count from project_parameter_file_versions where file_id=$1", [fileId]
    )).rows[0]!.count).toBe(versionsBefore);
    expect((await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId]
    )).rows[0]!.current_version_id).toBe(pendingBatch.baseVersionId);
    expect((await db.query<{ id: string; current_value_id: string }>(`
      select id,current_value_id from parameter_catalog.project_parameter_bindings
      where organization_id=$1 and project_id=$2 order by id`, [ORG, JSON_PROJECT])).rows).toEqual(pendingBatch.valueTips);
    expect((await db.query<{ status: string }>(
      "select status from project_parameter_value_change_requests where id=$1", [pendingBatch.requestId]
    )).rows[0]!.status).toBe("pending");
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from project_parameter_value_change_targets
      where request_id=$1 and applied_value_id is not null`, [pendingBatch.requestId])).rows[0]!.count).toBe(0);
  }, 120_000);

  it("commits all JSON batch targets as one source revision", async () => {
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalog) throw new Error("Published Catalog fixture is unavailable");
    let applied;
    try {
      applied = await db.transaction((tx) => commitCanonicalSourceBatchRevision(tx, storage, jsonReviewer, catalog, {
        projectId: JSON_PROJECT, requestId: pendingBatch.requestId,
        invocation: createUserInvocation(jsonReviewer), traceId: "906-json-real-batch-approve",
        refusalSink: createTrustedRefusalAuditSink(db)
      }));
    } catch (error) {
      // C #923's 0165 currently compares the frozen base revision with the new
      // applied revision. Keep this positive test red, but prove rollback is whole.
      expect((await db.query<{ current_version_id: string }>(
        "select current_version_id from project_parameter_files where id=$1", [fileId]
      )).rows[0]!.current_version_id).toBe(pendingBatch.baseVersionId);
      expect((await db.query<{ id: string; current_value_id: string }>(`
        select id,current_value_id from parameter_catalog.project_parameter_bindings
        where organization_id=$1 and project_id=$2 order by id`, [ORG, JSON_PROJECT])).rows).toEqual(pendingBatch.valueTips);
      expect((await db.query<{ status: string }>(
        "select status from project_parameter_value_change_requests where id=$1", [pendingBatch.requestId]
      )).rows[0]!.status).toBe("pending");
      expect((await db.query<{ count: number }>(`
        select count(*)::int as count from project_parameter_value_change_targets
        where request_id=$1 and applied_value_id is not null`, [pendingBatch.requestId])).rows[0]!.count).toBe(0);
      throw error;
    }
    expect(applied).toMatchObject({ requestId: pendingBatch.requestId, status: "approved", batchProofDigest: pendingBatch.proofDigest });
    expect((await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId]
    )).rows[0]!.current_version_id).not.toBe(pendingBatch.baseVersionId);
    const movedTips = (await db.query<{ id: string; current_value_id: string }>(`
      select id,current_value_id from parameter_catalog.project_parameter_bindings
      where organization_id=$1 and project_id=$2 order by id`, [ORG, JSON_PROJECT])).rows;
    expect(movedTips).toHaveLength(pendingBatch.valueTips.length);
    expect(movedTips.every((entry, index) => entry.current_value_id !== pendingBatch.valueTips[index]!.current_value_id)).toBe(true);
  }, 120_000);

  it("requires an exact audited member tombstone and preserves historical source pins", async () => {
    const before = (await db.query<{ id: string; current_value_id: string; pin_id: string; config_revision_id: string; file_version_id: string }>(`
      select binding.id,binding.current_value_id,pin.id as pin_id,
        pin.config_revision_id,pin.file_version_id
      from parameter_catalog.current_project_parameter_bindings binding
      join parameter_catalog.project_parameter_source_occurrences occurrence
        on occurrence.id=binding.source_occurrence_id
      join parameter_catalog.project_value_source_pins pin
        on pin.project_value_id=binding.current_value_id and pin.binding_id=binding.id
      where binding.organization_id=$1 and binding.project_id=$2
        and occurrence.config_set_id=$3 and occurrence.file_id=$4 order by binding.id`,
      [ORG, JSON_PROJECT, configSetId, fileId])).rows;
    expect(before.length).toBeGreaterThan(0);
    expect([...new Set(before.map((row) => row.config_revision_id))]).toEqual([before[0]!.config_revision_id]);
    expect([...new Set(before.map((row) => row.file_version_id))]).toEqual([before[0]!.file_version_id]);
    const revisionId = before[0]!.config_revision_id;
    const currentVersionId = before[0]!.file_version_id;
    const manifest = before.map((row) => ({ bindingId: row.id, valueId: row.current_value_id, sourcePinId: row.pin_id }));
    const historyCount = (await db.query<{ count: number }>(`
      select count(*)::int as count from parameter_catalog.binding_history_events
      where binding_id=any($1::text[])`, [before.map((row) => row.id)])).rows[0]!.count;
    const pinCount = (await db.query<{ count: number }>(`
      select count(*)::int as count from parameter_catalog.project_value_source_pins
      where binding_id=any($1::text[])`, [before.map((row) => row.id)])).rows[0]!.count;
    expect((await db.query<{ allowed: boolean }>(`
      select has_table_privilege('parameter_governance_writer_role',
        'parameter_catalog.project_source_member_tombstones','INSERT') as allowed`
    )).rows[0]!.allowed).toBe(false);
    await expect(db.transaction(async (tx) => {
      await tx.query("set local role parameter_governance_writer_role");
      await tx.query("select id from parameter_catalog.project_source_member_tombstones limit 1");
    })).rejects.toMatchObject({ code: "42501" });
    await expect(removeConfigSetFile(db, admin, { configSetId, fileId }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(db.transaction(async (tx) => {
      await tx.query(`update project_parameter_files set config_set_id=null,
        config_set_role=null,config_set_sort_order=0 where id=$1`, [fileId]);
    })).rejects.toThrow(/Pinned source file identity/);
    expect((await db.query<{ config_set_id: string }>(
      "select config_set_id from project_parameter_files where id=$1", [fileId]
    )).rows[0]!.config_set_id).toBe(configSetId);

    const writeRemoval = async (rollback: boolean, corruptManifest = false) => db.transaction(async (tx) => {
      const tombstoneId = randomUUID();
      const auditId = randomUUID();
      const frozen = corruptManifest ? manifest.slice(1) : manifest;
      await writeAuditEventInTx(asAuditTx(tx), jsonReviewer, { requestId: tombstoneId }, {
        id: auditId, app: "parameters", kind: "parameter-topology-governance",
        action: "source-member-removed", severity: "Medium", projectId: JSON_PROJECT,
        targetType: "project-parameter-file", targetId: fileId,
        metadata: { tombstoneId, configSetId, configRevisionId: revisionId,
          fileVersionId: currentVersionId, bindings: frozen }
      });
      await tx.query(`insert into parameter_catalog.project_source_member_tombstones
        (id,organization_id,project_id,config_set_id,file_id,config_revision_id,
         file_version_id,binding_manifest,audit_event_id)
        values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
        [tombstoneId, ORG, JSON_PROJECT, configSetId, fileId,
          revisionId, currentVersionId, JSON.stringify(frozen), auditId]);
      await tx.query(`update project_parameter_files set config_set_id=null,
        config_set_role=null,config_set_sort_order=0 where id=$1 and config_set_id=$2`, [fileId, configSetId]);
      expect((await tx.query<{ count: number }>(`
        select count(*)::int as count from parameter_catalog.current_project_parameter_bindings
        where id=any($1::text[])`, [before.map((row) => row.id)])).rows[0]!.count).toBe(0);
      if (rollback) throw new Error("injected-member-removal-rollback");
      return { tombstoneId, auditId };
    });
    await expect(writeRemoval(true)).rejects.toThrow("injected-member-removal-rollback");
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from parameter_catalog.project_source_member_tombstones
      where file_id=$1`, [fileId])).rows[0]!.count).toBe(0);
    expect((await db.query<{ config_set_id: string }>(
      "select config_set_id from project_parameter_files where id=$1", [fileId]
    )).rows[0]!.config_set_id).toBe(configSetId);
    await expect(writeRemoval(false, true)).rejects.toThrow(/exact source cohort/);
    expect((await db.query<{ config_set_id: string }>(
      "select config_set_id from project_parameter_files where id=$1", [fileId]
    )).rows[0]!.config_set_id).toBe(configSetId);

    const committed = await writeRemoval(false);
    expect((await db.query<{ id: string; current_value_id: string }>(`
      select id,current_value_id from parameter_catalog.project_parameter_bindings
      where id=any($1::text[]) order by id`, [before.map((row) => row.id)])).rows)
      .toEqual(before.map((row) => ({ id: row.id, current_value_id: row.current_value_id })));
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from parameter_catalog.project_value_source_pins
      where binding_id=any($1::text[])`, [before.map((row) => row.id)])).rows[0]!.count).toBe(pinCount);
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from parameter_catalog.binding_history_events
      where binding_id=any($1::text[])`, [before.map((row) => row.id)])).rows[0]!.count).toBe(historyCount);
    expect((await db.query<{ id: string }>(`
      select id from audit_events where id=$1`, [committed.auditId])).rows).toHaveLength(1);
    await expect(db.transaction(async (tx) => {
      await tx.query(`update project_parameter_files set config_set_id=$2,
        config_set_role='config',config_set_sort_order=0 where id=$1`, [fileId, configSetId]);
    })).rejects.toThrow(/Pinned source file identity/);
  }, 120_000);
});

describe("#906 canonical DTS candidate workflow", () => {
  const source = `/dts-v1/;\n/ {\n  charger: device@0 {\n    compatible = "acme,power";\n    iin_max = <36>;\n  };\n  backup: device@1 {\n    compatible = "acme,power";\n    iin_max = <36>;\n  };\n};\n`;
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let storageDirectory: string;
  let fileId: string;
  let versionId: string;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("issue906-dts-workflow");
    db = createPostgresDatabase(database.url);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-906-dts-workflow-"));
    storage = createLocalObjectStore(storageDirectory);
    await db.query("insert into organizations(id,name) values ($1,'#906 DTS')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true)", [ADMIN, ORG, REVIEWER]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'DTS workflow','D906','initialized')", [DTS_PROJECT, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('role-906-dts-admin',$1,$2,null,'admin'),('role-906-dts-reviewer',$3,$2,$4,'software-committer')", [ADMIN, ORG, REVIEWER, DTS_PROJECT]);
    await installDriverSourceFixture(db, admin, {
      subjectId: "csub_acme_power",
      compatible: "acme,power",
      businessName: "#906 DTS",
      driverName: "Acme power",
      idempotencyKey: "906-dts-registration",
      reason: "Issue 906 DTS workflow"
    });
    const set = await createConfigSet(db, admin, { projectId: DTS_PROJECT, name: "DTS workflow" });
    const uploaded = await uploadProjectParameterFile(db, storage, admin, { projectId: DTS_PROJECT, fileName: "board.dts", bytes: Buffer.from(source) });
    fileId = uploaded.file.id;
    versionId = uploaded.version.id;
    await addConfigSetFile(db, admin, { configSetId: set.id, fileId, role: "base", sortOrder: 0 });
    const manifest: ConfigRevisionManifest = {
      organizationId: ORG,
      projectId: DTS_PROJECT,
      configSetId: set.id,
      entryFile: "board.dts",
      includeSearchPaths: ["."],
      overlayOrder: [],
      members: [{ fileId, fileVersionId: versionId, fileName: "board.dts", sourceName: "board.dts", role: "base", sortOrder: 0, content: source }]
    };
    const revision = await ingestConfigRevision(db, manifest, admin, { legacyProjection: "skip" });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), snapshot, {
      organizationId: ORG,
      projectId: DTS_PROJECT,
      configSetId: set.id,
      configRevisionId: revision.id
    }));
    const rows = await listCatalogBindingRowsForProject(db, admin, { projectId: DTS_PROJECT });
    expect(rows).toHaveLength(2);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  it("freezes two exact DTS targets without creating a batch request", async () => {
    const candidate = await createCandidate(db, storage, admin, {
      projectId: DTS_PROJECT,
      fileId,
      fileName: "board.dts",
      bytes: Buffer.from(source.replaceAll("iin_max = <36>", "iin_max = <77>"))
    });
    const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: DTS_PROJECT, candidateId: candidate.id });
    expect(preview).toMatchObject({ kind: "canonical", canSubmit: false, reason: "canonical-batch-writer-unavailable", format: "dts" });
    expect(preview.bindings).toHaveLength(2);
    expect(preview.bindings?.map((binding) => [binding.beforeText, binding.afterText])).toEqual([
      ["<36>", "<77>"], ["<36>", "<77>"]
    ]);
    const prepared = await db.transaction((tx) => prepareCanonicalCandidateBatchInTransaction(tx, storage, admin, {
      projectId: DTS_PROJECT,
      candidateId: candidate.id,
      expectedProofToken: preview.proofToken!
    }));
    expect(prepared).toMatchObject({ kind: "canonical-source-batch", format: "dts", targets: [
      expect.objectContaining({ action: "set", targetText: "<77>" }),
      expect.objectContaining({ action: "set", targetText: "<77>" })
    ] });
    expect(await db.transaction((tx) => freezeCanonicalCandidateBatchSnapshotInTransaction(tx, storage, admin, {
      projectId: DTS_PROJECT, candidateId: candidate.id, expectedProofToken: preview.proofToken!
    }))).toEqual(prepared);
    expect(new Set(prepared.targets.map((target) => target.bindingId)).size).toBe(2);
    const currentBindings = await listCatalogBindingRowsForProject(db, admin, { projectId: DTS_PROJECT });
    const sourceSnapshot = await loadCanonicalSourceSnapshot(db, storage, {
      organizationId: ORG,
      projectId: DTS_PROJECT,
      bindingId: currentBindings[0]!.id,
      projectValueId: currentBindings[0]!.currentValueId!
    });
    await expect(readPinnedDtsSourceBatchChanges(db,
      [sourceSnapshot.manifest, sourceSnapshot.manifest], source,
      source.replace("iin_max = <36>", "iin_max = <77>")))
      .rejects.toMatchObject({ code: "CONFLICT" });
    const deletedBoth = await createCandidate(db, storage, admin, {
      projectId: DTS_PROJECT,
      fileId,
      fileName: "board.dts",
      bytes: Buffer.from(source.replaceAll("iin_max = <36>;", "/delete-property/ iin_max;"))
    });
    const deletePreview = await previewCanonicalCandidate(db, storage, admin, {
      projectId: DTS_PROJECT, candidateId: deletedBoth.id
    });
    expect(deletePreview).toMatchObject({ kind: "canonical", canSubmit: false, reason: "canonical-batch-writer-unavailable" });
    expect(deletePreview.bindings).toHaveLength(2);
    expect(deletePreview.bindings?.map((binding) => binding.action)).toEqual(["delete", "delete"]);
    expect(deletePreview.bindings?.map((binding) => [binding.beforeText, binding.afterText])).toEqual([
      ["<36>", undefined], ["<36>", undefined]
    ]);
    const deleteProof = await db.transaction((tx) => prepareCanonicalCandidateBatchInTransaction(tx, storage, admin, {
      projectId: DTS_PROJECT, candidateId: deletedBoth.id, expectedProofToken: deletePreview.proofToken!
    }));
    expect(deleteProof.targets.map((target) => target.action)).toEqual(["delete", "delete"]);
    expect(await db.transaction((tx) => freezeCanonicalCandidateBatchSnapshotInTransaction(tx, storage, admin, {
      projectId: DTS_PROJECT, candidateId: deletedBoth.id, expectedProofToken: deletePreview.proofToken!
    }))).toEqual(deleteProof);
    const changedOutsideTargets = await createCandidate(db, storage, admin, {
      projectId: DTS_PROJECT,
      fileId,
      fileName: "board.dts",
      bytes: Buffer.from(source.replaceAll("iin_max = <36>", "iin_max = <77>")
        .replace('compatible = "acme,power"', 'compatible = "other,power"'))
    });
    expect(await previewCanonicalCandidate(db, storage, admin, {
      projectId: DTS_PROJECT, candidateId: changedOutsideTargets.id
    })).toMatchObject({ kind: "canonical", canSubmit: false });
    await expect(submitCanonicalCandidate(db, storage, admin, {
      projectId: DTS_PROJECT,
      candidateId: candidate.id,
      expectedCurrentVersionId: versionId,
      expectedProofToken: preview.proofToken!,
      reason: "batch request schema unavailable",
      requestId: "906-dts-batch-refused",
      refusalSink: createTrustedRefusalAuditSink(db)
    })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "canonical-batch-writer-unavailable" } });
    const state = await db.query<{ current_version_id: string; request_count: number }>(
      `select file.current_version_id,
              (select count(*)::int from project_parameter_value_change_requests where candidate_id=$2) as request_count
         from project_parameter_files file where file.id=$1`, [fileId, candidate.id]);
    expect(state.rows[0]).toEqual({ current_version_id: versionId, request_count: 0 });
  }, 120_000);

  it("submits and commits one DTS pinned property and rejects non-target bytes", async () => {
    const nonTargetCandidate = await createCandidate(db, storage, admin, {
      projectId: DTS_PROJECT,
      fileId,
      fileName: "board.dts",
      bytes: Buffer.from(source.replace('compatible = "acme,power"', 'compatible = "other,power"').replace("iin_max = <36>", "iin_max = <77>"))
    });
    const nonTargetPreview = await previewCanonicalCandidate(db, storage, admin, { projectId: DTS_PROJECT, candidateId: nonTargetCandidate.id });
    expect(nonTargetPreview).toMatchObject({ kind: "canonical", canSubmit: false });

    const candidate = await createCandidate(db, storage, admin, {
      projectId: DTS_PROJECT,
      fileId,
      fileName: "board.dts",
      bytes: Buffer.from(source.replace("iin_max = <36>", "iin_max = <77>"))
    });
    const preview = await previewCanonicalCandidate(db, storage, admin, { projectId: DTS_PROJECT, candidateId: candidate.id });
    const repeatPreview = await previewCanonicalCandidate(db, storage, admin, { projectId: DTS_PROJECT, candidateId: candidate.id });
    if (repeatPreview.proofToken !== preview.proofToken) throw new Error(`DTS preview proof changed between identical reads: ${preview.proofToken} ${repeatPreview.proofToken}`);
    expect(preview).toMatchObject({ kind: "canonical", canSubmit: true, format: "dts" });
    expect(preview.bindings).toHaveLength(1);
    expect(preview.before).toContain("iin_max = <36>");
    expect(preview.after).toContain("iin_max = <77>");
    const submitted = await submitCanonicalCandidate(db, storage, admin, {
      projectId: DTS_PROJECT,
      candidateId: candidate.id,
      expectedCurrentVersionId: versionId,
      expectedProofToken: preview.proofToken!,
      reason: "review one DTS source property",
      requestId: "906-dts-submit",
      refusalSink: createTrustedRefusalAuditSink(db)
    });
    expect(submitted.status).toBe("pending");
    const applied = await review(db, dtsReviewer, DTS_PROJECT, submitted.requestId, storage);
    expect(applied.status).toBe("approved");
    const replay = await submitCanonicalCandidate(db, storage, admin, {
      projectId: DTS_PROJECT,
      candidateId: candidate.id,
      expectedCurrentVersionId: versionId,
      expectedProofToken: preview.proofToken!,
      reason: "retry exact DTS source request",
      requestId: "906-dts-submit-retry",
      refusalSink: createTrustedRefusalAuditSink(db)
    });
    expect(replay).toMatchObject({ requestId: submitted.requestId, status: "approved", replayed: true });
  }, 120_000);
});
